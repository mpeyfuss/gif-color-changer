import {
  TRANSPARENT,
  TRANSPARENT_KEYWORDS,
  type ColorMapping,
  type DistanceMode,
  type Palette,
  type Rgb,
  type TargetColor,
  type TargetPalette,
} from "./types";

const HEX_COLOR = /^[0-9a-f]{6}$/i;

/** Quote a string the way Python's `repr` does, to keep error messages identical. */
function repr(value: string): string {
  return value.includes("'") && !value.includes('"') ? `"${value}"` : `'${value}'`;
}

export function hexToRgb(hexColor: string): Rgb {
  const hex = hexColor.trim().replace(/^#+/, "");
  if (!HEX_COLOR.test(hex)) {
    throw new Error(`Expected a 6-digit hex color, got: ${repr(hex)}`);
  }
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/**
 * Parse a replacement color, which may be the `transparent`/`none` keyword
 * (fully clear) instead of a hex color.
 */
export function parseTargetColor(rawColor: string): TargetColor {
  const keyword = rawColor.trim().toLowerCase();
  if ((TRANSPARENT_KEYWORDS as readonly string[]).includes(keyword)) {
    return TRANSPARENT;
  }
  return hexToRgb(rawColor);
}

export function parseColorMapping(rawMapping: string): ColorMapping {
  const separator = rawMapping.indexOf("=");
  const fromColor = separator === -1 ? "" : rawMapping.slice(0, separator);
  const toColor = separator === -1 ? "" : rawMapping.slice(separator + 1);
  if (!fromColor || !toColor) {
    throw new Error(
      `Expected color mapping in FROM=TO format, got: ${repr(rawMapping)}`,
    );
  }
  return [hexToRgb(fromColor), parseTargetColor(toColor)];
}

export function parsePalette(rawPalette: string): Rgb[];
export function parsePalette(
  rawPalette: string,
  allowTransparent: true,
): TargetColor[];
export function parsePalette(
  rawPalette: string,
  allowTransparent = false,
): TargetColor[] {
  const colors = rawPalette.split(",").map((color) => color.trim());
  if (colors.some((color) => !color)) {
    throw new Error(
      `Expected comma-separated hex colors, got: ${repr(rawPalette)}`,
    );
  }
  const parse = allowTransparent ? parseTargetColor : hexToRgb;
  return colors.map(parse);
}

export function validatePaletteMapping(
  sourcePalette: Palette,
  targetPalette: TargetPalette,
): void {
  if (sourcePalette.length === 0) {
    throw new Error("Expected source palette to contain at least one color");
  }
  if (targetPalette.length === 0) {
    throw new Error("Expected target palette to contain at least one color");
  }
  if (sourcePalette.length !== targetPalette.length) {
    throw new Error(
      "Expected source and target palettes to contain the same number of colors",
    );
  }
}

export function validateDistanceMode(
  distance: string,
): asserts distance is DistanceMode {
  if (distance !== "rgb" && distance !== "weighted-rgb") {
    throw new Error("Expected distance to be 'rgb' or 'weighted-rgb'");
  }
}

/** Format a color the way the CLI summary prints it, e.g. `(255, 0, 0)`. */
export function formatColor(color: TargetColor): string {
  return color === TRANSPARENT ? TRANSPARENT : `(${color.join(", ")})`;
}

/**
 * One summary line per mapping or palette bucket, e.g.
 * `(255, 255, 255) -> (255, 0, 0): changed 12 pixel(s)`.
 */
export function summaryLines(
  pairs: readonly (readonly [Rgb, TargetColor])[],
  counts: readonly number[],
  verb: "changed" | "assigned",
): string[] {
  return pairs.map(
    ([from, to], index) =>
      `${formatColor(from)} -> ${formatColor(to)}: ${verb} ${counts[index]} pixel(s)`,
  );
}
