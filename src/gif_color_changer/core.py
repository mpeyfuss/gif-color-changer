from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageSequence


RgbColor = tuple[int, int, int]
ColorMapping = tuple[RgbColor, RgbColor]


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
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))


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

    return hex_to_rgb(from_color), hex_to_rgb(to_color)


def replace_colors(
    frame: Image.Image, color_mappings: list[ColorMapping], tolerance: int
):
    """Replace pixels matching source colors with their paired target colors."""
    frame = frame.convert("RGBA")
    pixels = np.array(frame)  # pixels[y][x] = [R,G,B,A]
    original_rgb = pixels[:, :, :3].astype(np.int16)
    alpha_mask = pixels[:, :, 3] > 0
    changed_mask = np.zeros(alpha_mask.shape, dtype=bool)
    changed_counts = [0] * len(color_mappings)

    for index, (from_rgb, to_rgb) in enumerate(color_mappings):
        from_rgb_array = np.array(from_rgb, dtype=np.int16)
        color_mask = np.all(np.abs(original_rgb - from_rgb_array) <= tolerance, axis=2)
        mask = alpha_mask & ~changed_mask & color_mask

        pixels[mask, :3] = to_rgb
        changed_mask |= mask
        changed_counts[index] = int(np.count_nonzero(mask))

    return Image.fromarray(pixels, mode="RGBA"), changed_counts


def recolor_gif(
    image: Image.Image,
    color_mappings: list[ColorMapping],
    tolerance: int,
):
    frames = [frame.copy() for frame in ImageSequence.Iterator(image)]
    durations = [frame.info.get("duration", 100) for frame in frames]
    loop = image.info.get("loop", 0)
    new_frames = []
    total_changed_counts = [0] * len(color_mappings)

    for frame in frames:
        new_frame, changed_counts = replace_colors(frame, color_mappings, tolerance)
        new_frames.append(new_frame)

        for index, changed_count in enumerate(changed_counts):
            total_changed_counts[index] += changed_count

    return RecoloredGif(
        frames=new_frames,
        durations=durations,
        loop=loop,
        changed_counts=total_changed_counts,
    )
