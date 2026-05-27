"""
Replace colors across every frame of a GIF.

Usage:
    gifcc input.gif output.gif --map "#FFFFFF=#FF0000" --map "#000000=#00FF00"
    gifcc input.gif output.gif --source-palette "#000000,#FFFFFF" --target-palette "#222222,#EEEEEE"
"""

import argparse

from PIL import Image

from gif_color_changer.core import (
    parse_color_mapping,
    parse_palette,
    recolor_gif,
    rewrite_gif_palette,
    validate_distance_mode,
    validate_palette_mapping,
)


DEFAULT_TOLERANCE = 50
DEFAULT_SOFTNESS = 25


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Path to input GIF")
    parser.add_argument("output", help="Path to output GIF")
    parser.add_argument(
        "--map",
        dest="color_mappings",
        action="append",
        help="Color mapping in FROM=TO format, e.g. '#FFFFFF=#FF0000'. Can be repeated.",
    )
    parser.add_argument(
        "--source-palette",
        help="Comma-separated source palette colors, e.g. '#000000,#808080,#FFFFFF'.",
    )
    parser.add_argument(
        "--target-palette",
        help="Comma-separated target palette colors, e.g. '#1D3557,#E63946,#F1FAEE'.",
    )
    parser.add_argument(
        "--distance",
        help=(
            "Palette color distance mode: 'rgb' or 'weighted-rgb'. "
            "Default: rgb"
        ),
    )
    parser.add_argument(
        "--cleanup",
        type=int,
        help=(
            "Palette mode only: number of edge-cleanup passes. Each pass "
            "reassigns isolated pixels to the palette bucket that dominates "
            "their neighborhood, while leaving real edges intact. "
            "Default: 0 (off)."
        ),
    )
    parser.add_argument(
        "--tolerance",
        type=int,
        help=(
            "How close a pixel must be to the source color (0-255). "
            f"Default: {DEFAULT_TOLERANCE}"
        ),
    )
    parser.add_argument(
        "--softness",
        type=int,
        help=(
            "Blend pixels near the edge of the tolerance range instead of fully "
            f"replacing them. Default: {DEFAULT_SOFTNESS}"
        ),
    )
    args = parser.parse_args()

    palette_mode = args.source_palette is not None or args.target_palette is not None
    tolerance_mode = args.color_mappings is not None

    if palette_mode and tolerance_mode:
        parser.error("--map cannot be combined with palette mode")

    if not palette_mode and not tolerance_mode:
        parser.error("expected --map or both --source-palette and --target-palette")

    if palette_mode:
        if args.source_palette is None or args.target_palette is None:
            parser.error(
                "palette mode requires both --source-palette and --target-palette"
            )
        if args.tolerance is not None:
            parser.error("--tolerance cannot be used with palette mode")
        if args.softness is not None:
            parser.error("--softness cannot be used with palette mode")

        cleanup = 0 if args.cleanup is None else args.cleanup
        if cleanup < 0:
            parser.error("--cleanup must be 0 or greater")

        try:
            source_palette = parse_palette(args.source_palette)
            target_palette = parse_palette(args.target_palette)
            validate_palette_mapping(source_palette, target_palette)
            distance = "rgb" if args.distance is None else args.distance
            validate_distance_mode(distance)
        except ValueError as exc:
            parser.error(str(exc))

        print("Processing frame(s)...")

        with Image.open(args.input) as image:
            recolored = rewrite_gif_palette(
                image, source_palette, target_palette, distance, cleanup
            )

        for (from_rgb, to_rgb), assigned_count in zip(
            zip(source_palette, target_palette), recolored.changed_counts
        ):
            print(f"{from_rgb} -> {to_rgb}: assigned {assigned_count} pixel(s)")
    else:
        tolerance = DEFAULT_TOLERANCE if args.tolerance is None else args.tolerance
        softness = DEFAULT_SOFTNESS if args.softness is None else args.softness

        if softness < 0:
            parser.error("--softness must be 0 or greater")
        if args.distance is not None:
            parser.error("--distance can only be used with palette mode")
        if args.cleanup is not None:
            parser.error("--cleanup can only be used with palette mode")

        try:
            color_mappings = [
                parse_color_mapping(mapping) for mapping in args.color_mappings
            ]
        except ValueError as exc:
            parser.error(str(exc))

        print("Processing frame(s)...")

        with Image.open(args.input) as image:
            recolored = recolor_gif(image, color_mappings, tolerance, softness)

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
