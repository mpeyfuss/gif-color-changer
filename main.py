"""
Replace all pixels of one or more colors with other colors in a GIF.

Usage:
    python main.py input.gif output.gif --map "#FFFFFF=#FF0000" --map "#000000=#00FF00"
"""

import argparse
import numpy as np
from PIL import Image, ImageSequence


RgbColor = tuple[int, int, int]
ColorMapping = tuple[RgbColor, RgbColor]


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
    input_path: str,
    output_path: str,
    color_mappings: list[ColorMapping],
    tolerance: int,
):
    with Image.open(input_path) as im:
        frames = [f.copy() for f in ImageSequence.Iterator(im)]
        durations = [f.info.get("duration", 100) for f in frames]
        loop = im.info.get("loop", 0)

    print(f"Processing {len(frames)} frame(s)...")
    new_frames = []
    total_changed_counts = [0] * len(color_mappings)

    for frame in frames:
        new_frame, changed_counts = replace_colors(frame, color_mappings, tolerance)
        new_frames.append(new_frame)

        for index, changed_count in enumerate(changed_counts):
            total_changed_counts[index] += changed_count

    for (from_rgb, to_rgb), changed_count in zip(color_mappings, total_changed_counts):
        print(f"{from_rgb} -> {to_rgb}: changed {changed_count} pixel(s)")

    new_frames[0].save(
        output_path,
        save_all=True,
        append_images=new_frames[1:],
        duration=durations,
        loop=loop,
        disposal=2,
    )
    print(f"Saved: {output_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Path to input GIF")
    parser.add_argument("output", help="Path to output GIF")
    parser.add_argument(
        "--map",
        dest="color_mappings",
        action="append",
        required=True,
        help="Color mapping in FROM=TO format, e.g. '#FFFFFF=#FF0000'. Can be repeated.",
    )
    parser.add_argument(
        "--tolerance",
        type=int,
        default=10,
        help="How close a pixel must be to the source color (0-255). Default: 10",
    )
    args = parser.parse_args()

    try:
        color_mappings = [
            parse_color_mapping(mapping) for mapping in args.color_mappings
        ]
    except ValueError as exc:
        parser.error(str(exc))

    recolor_gif(
        args.input,
        args.output,
        color_mappings,
        args.tolerance,
    )


if __name__ == "__main__":
    main()
