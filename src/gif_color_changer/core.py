from dataclasses import dataclass
from typing import Literal

import numpy as np
from PIL import Image, ImageSequence


RgbColor = tuple[int, int, int]
# Sentinel for a fully transparent target color. Only valid on the replacement
# side of a mapping/palette; source matching always stays RGB-only.
TRANSPARENT = "transparent"
TRANSPARENT_KEYWORDS = ("transparent", "none")
TargetColor = RgbColor | Literal["transparent"]
ColorMapping = tuple[RgbColor, TargetColor]
Palette = list[RgbColor]
TargetPalette = list[TargetColor]
DistanceMode = Literal["rgb", "weighted-rgb"]
RGB_DISTANCE_WEIGHTS = np.array((0.2126, 0.7152, 0.0722), dtype=np.float32)


@dataclass(frozen=True)
class RecoloredGif:
    frames: list[Image.Image]
    durations: list[int]
    loop: int
    changed_counts: list[int]


def hex_to_rgb(hex_color: str) -> RgbColor:
    hex_color = hex_color.strip().lstrip("#")
    if len(hex_color) != 6:
        raise ValueError(f"Expected a 6-digit hex color, got: {hex_color!r}")

    try:
        return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        raise ValueError(f"Expected a 6-digit hex color, got: {hex_color!r}") from None


def parse_target_color(raw_color: str) -> TargetColor:
    """Parse a replacement color, which may be the ``transparent``/``none``
    keyword (fully clear) instead of a hex color."""
    if raw_color.strip().lower() in TRANSPARENT_KEYWORDS:
        return TRANSPARENT
    return hex_to_rgb(raw_color)


def parse_color_mapping(raw_mapping: str) -> ColorMapping:
    try:
        from_color, to_color = raw_mapping.split("=", 1)
    except ValueError:
        raise ValueError(
            f"Expected color mapping in FROM=TO format, got: {raw_mapping!r}"
        ) from None

    if not from_color or not to_color:
        raise ValueError(
            f"Expected color mapping in FROM=TO format, got: {raw_mapping!r}"
        )

    return hex_to_rgb(from_color), parse_target_color(to_color)


def parse_palette(raw_palette: str, allow_transparent: bool = False) -> TargetPalette:
    colors = [color.strip() for color in raw_palette.split(",")]
    if not colors or any(not color for color in colors):
        raise ValueError(f"Expected comma-separated hex colors, got: {raw_palette!r}")

    parse = parse_target_color if allow_transparent else hex_to_rgb
    return [parse(color) for color in colors]


def validate_palette_mapping(source_palette: Palette, target_palette: Palette):
    if not source_palette:
        raise ValueError("Expected source palette to contain at least one color")

    if not target_palette:
        raise ValueError("Expected target palette to contain at least one color")

    if len(source_palette) != len(target_palette):
        raise ValueError(
            "Expected source and target palettes to contain the same number of colors"
        )


def validate_distance_mode(distance: str):
    if distance not in ("rgb", "weighted-rgb"):
        raise ValueError("Expected distance to be 'rgb' or 'weighted-rgb'")


def replace_colors(
    frame: Image.Image,
    color_mappings: list[ColorMapping],
    tolerance: int,
    softness: int = 0,
):
    """Replace RGB colors while preserving the original alpha channel."""
    frame = frame.convert("RGBA")
    pixels = np.array(frame)  # pixels[y][x] = [R,G,B,A]
    original_rgb = pixels[:, :, :3].astype(np.int16)
    changed_mask = np.zeros(pixels.shape[:2], dtype=bool)
    changed_counts = [0] * len(color_mappings)

    for index, (from_rgb, to_rgb) in enumerate(color_mappings):
        from_rgb_array = np.array(from_rgb, dtype=np.int16)
        channel_distances = np.abs(original_rgb - from_rgb_array)
        color_distance = np.max(channel_distances, axis=2)
        color_mask = color_distance <= tolerance
        mask = ~changed_mask & color_mask

        soft = softness > 0 and tolerance > 0
        if soft:
            soft_start = max(tolerance - softness, 0)
            blend_weights = np.ones(color_distance.shape, dtype=np.float32)
            soft_mask = mask & (color_distance > soft_start)

            if np.any(soft_mask):
                soft_range = tolerance - soft_start
                blend_weights[soft_mask] = (
                    tolerance - color_distance[soft_mask]
                ) / soft_range

        if to_rgb == TRANSPARENT:
            # Fade matched pixels toward fully transparent. With softness, the
            # alpha drops proportionally near the tolerance edge; the RGB is
            # left untouched since it is on its way to being invisible.
            if soft:
                weights = blend_weights[mask]
                original_alpha = pixels[mask, 3].astype(np.float32)
                pixels[mask, 3] = np.rint(original_alpha * (1.0 - weights)).astype(
                    np.uint8
                )
            else:
                pixels[mask, 3] = 0
        elif soft:
            to_rgb_array = np.array(to_rgb, dtype=np.float32)
            source_rgb = original_rgb[mask].astype(np.float32)
            weights = blend_weights[mask, np.newaxis]
            pixels[mask, :3] = np.rint(
                source_rgb + ((to_rgb_array - source_rgb) * weights)
            ).astype(np.uint8)
        else:
            pixels[mask, :3] = to_rgb

        changed_mask |= mask
        changed_counts[index] = int(np.count_nonzero(mask))

    return Image.fromarray(pixels, mode="RGBA"), changed_counts


def _neighbor_counts(mask: np.ndarray) -> np.ndarray:
    """Count, per pixel, how many of its 8 neighbors are set in ``mask``.

    Pixels outside the image are treated as unset, so border pixels simply have
    fewer neighbors available.
    """
    padded = np.pad(mask, 1)
    return (
        padded[:-2, :-2] + padded[:-2, 1:-1] + padded[:-2, 2:]
        + padded[1:-1, :-2] + padded[1:-1, 2:]
        + padded[2:, :-2] + padded[2:, 1:-1] + padded[2:, 2:]
    )


def cleanup_edges(labels: np.ndarray, num_labels: int, passes: int) -> np.ndarray:
    """Smooth a label map by reassigning pixels to the label that surrounds them
    more than their own.

    Each pass reassigns a pixel whenever some *other* label occupies more of its
    8-neighborhood than the pixel's own label does, snapping it to whichever
    neighbor dominates. This absorbs isolated speckles and the thin
    intermediate bands that form along antialiased edges (their own label has
    few neighbors), while pixels inside a solid region or along a real boundary
    keep their label, because their own side still dominates their
    neighborhood. Ties between competing labels resolve to the lower index.
    """
    if passes <= 0:
        return labels

    labels = labels.copy()
    height, width = labels.shape
    for _ in range(passes):
        counts = np.zeros((num_labels, height, width), dtype=np.int16)
        for index in range(num_labels):
            counts[index] = _neighbor_counts((labels == index).astype(np.int16))

        # How many neighbors share the pixel's own label.
        self_count = np.take_along_axis(counts, labels[np.newaxis], axis=0)[0]

        # The strongest competing label, ignoring the pixel's own.
        other_counts = counts.copy()
        np.put_along_axis(other_counts, labels[np.newaxis], -1, axis=0)
        other_label = np.argmax(other_counts, axis=0)
        other_count = np.max(other_counts, axis=0)

        flip = other_count > self_count
        if not np.any(flip):
            break
        labels[flip] = other_label[flip].astype(labels.dtype)

    return labels


def rewrite_palette(
    frame: Image.Image,
    source_palette: Palette,
    target_palette: TargetPalette,
    distance: DistanceMode = "rgb",
    cleanup: int = 0,
):
    """Rewrite RGB colors while preserving the original alpha channel."""
    validate_palette_mapping(source_palette, target_palette)
    validate_distance_mode(distance)

    frame = frame.convert("RGBA")
    pixels = np.array(frame)  # pixels[y][x] = [R,G,B,A]

    if distance == "weighted-rgb":
        original_rgb = pixels[:, :, :3].astype(np.float32)
        source_palette_array = np.array(source_palette, dtype=np.float32)
        nearest_distances = np.full(pixels.shape[:2], np.inf, dtype=np.float32)
    else:
        original_rgb = pixels[:, :, :3].astype(np.int32)
        source_palette_array = np.array(source_palette, dtype=np.int32)
        nearest_distances = np.full(pixels.shape[:2], np.iinfo(np.int32).max)

    nearest_indexes = np.zeros(pixels.shape[:2], dtype=np.intp)

    for index, source_rgb in enumerate(source_palette_array):
        delta = original_rgb - source_rgb
        if distance == "weighted-rgb":
            distances = np.sum((delta * delta) * RGB_DISTANCE_WEIGHTS, axis=2)
        else:
            distances = np.sum(delta * delta, axis=2)
        closer_mask = distances < nearest_distances
        nearest_distances[closer_mask] = distances[closer_mask]
        nearest_indexes[closer_mask] = index

    labels = nearest_indexes
    if cleanup > 0:
        # Treat "transparent" as an extra region so cleanup works on color and
        # opacity together: a pixel adopts the color *and* alpha of whatever
        # surrounds it most. Stray opaque pixels in transparent space become
        # transparent, and transparent holes inside a region fill in. This also
        # stops visible pixels from being recolored toward the hidden RGB of
        # transparent neighbors, which now only ever vote for "transparent".
        transparent_label = len(source_palette)
        opaque = pixels[:, :, 3] > 0
        labels = np.where(opaque, nearest_indexes, transparent_label)
        labels = cleanup_edges(labels, len(source_palette) + 1, cleanup)

        became_transparent = labels == transparent_label
        pixels[became_transparent, 3] = 0
        # Transparent pixels pulled into a region become fully opaque.
        pixels[~opaque & ~became_transparent, 3] = 255

    assignment_counts = [0] * len(source_palette)

    for index, target_color in enumerate(target_palette):
        mask = labels == index
        if target_color == TRANSPARENT:
            pixels[mask, 3] = 0
        else:
            pixels[mask, :3] = target_color
        assignment_counts[index] = int(np.count_nonzero(mask))

    return Image.fromarray(pixels, mode="RGBA"), assignment_counts


def recolor_gif(
    image: Image.Image,
    color_mappings: list[ColorMapping],
    tolerance: int,
    softness: int = 0,
):
    frames = [frame.copy() for frame in ImageSequence.Iterator(image)]
    durations = [frame.info.get("duration", 100) for frame in frames]
    loop = image.info.get("loop", 0)
    new_frames = []
    total_changed_counts = [0] * len(color_mappings)

    for frame in frames:
        new_frame, changed_counts = replace_colors(
            frame, color_mappings, tolerance, softness
        )
        new_frames.append(new_frame)

        for index, changed_count in enumerate(changed_counts):
            total_changed_counts[index] += changed_count

    return RecoloredGif(
        frames=new_frames,
        durations=durations,
        loop=loop,
        changed_counts=total_changed_counts,
    )


def rewrite_gif_palette(
    image: Image.Image,
    source_palette: Palette,
    target_palette: TargetPalette,
    distance: DistanceMode = "rgb",
    cleanup: int = 0,
):
    validate_palette_mapping(source_palette, target_palette)
    validate_distance_mode(distance)

    frames = [frame.copy() for frame in ImageSequence.Iterator(image)]
    durations = [frame.info.get("duration", 100) for frame in frames]
    loop = image.info.get("loop", 0)
    new_frames = []
    total_assignment_counts = [0] * len(source_palette)

    for frame in frames:
        new_frame, assignment_counts = rewrite_palette(
            frame, source_palette, target_palette, distance, cleanup
        )
        new_frames.append(new_frame)

        for index, assignment_count in enumerate(assignment_counts):
            total_assignment_counts[index] += assignment_count

    return RecoloredGif(
        frames=new_frames,
        durations=durations,
        loop=loop,
        changed_counts=total_assignment_counts,
    )
