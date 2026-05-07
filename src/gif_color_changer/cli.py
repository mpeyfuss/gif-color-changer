"""
Replace all pixels of one or more colors with other colors in a GIF.

Usage:
    gifcc input.gif output.gif --map "#FFFFFF=#FF0000" --map "#000000=#00FF00"
"""

import argparse

from PIL import Image

from gif_color_changer.core import parse_color_mapping, recolor_gif


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

    print("Processing frame(s)...")

    with Image.open(args.input) as image:
        recolored = recolor_gif(image, color_mappings, args.tolerance)

    for (from_rgb, to_rgb), changed_count in zip(
        color_mappings, recolored.changed_counts
    ):
        print(f"{from_rgb} -> {to_rgb}: changed {changed_count} pixel(s)")

    recolored.frames[0].save(
        args.output,
        save_all=True,
        append_images=recolored.frames[1:],
        duration=recolored.durations,
        loop=recolored.loop,
        disposal=2,
    )
    print(f"Saved: {args.output}")
