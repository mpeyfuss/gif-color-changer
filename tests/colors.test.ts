import { expect, test } from "bun:test";

import {
  TRANSPARENT,
  formatColor,
  hexToRgb,
  parseColorMapping,
  parsePalette,
  parseTargetColor,
  validateDistanceMode,
  validatePaletteMapping,
} from "../src";

test("parseColorMapping", () => {
  expect(parseColorMapping("#FFFFFF=#FF0000")).toEqual([
    [255, 255, 255],
    [255, 0, 0],
  ]);
});

test("parseColorMapping rejects missing sides", () => {
  expect(() => parseColorMapping("#FFFFFF")).toThrow(
    "Expected color mapping in FROM=TO format, got: '#FFFFFF'",
  );
  expect(() => parseColorMapping("=#FFFFFF")).toThrow("FROM=TO");
  expect(() => parseColorMapping("#FFFFFF=")).toThrow("FROM=TO");
});

test("hexToRgb accepts optional # and whitespace, rejects bad hex", () => {
  expect(hexToRgb(" 808080 ")).toEqual([128, 128, 128]);
  expect(() => hexToRgb("#FFF")).toThrow("Expected a 6-digit hex color, got: 'FFF'");
  expect(() => hexToRgb("#00000G")).toThrow("Expected a 6-digit hex color, got: '00000G'");
});

test("parseTargetColor accepts transparent keywords", () => {
  expect(parseTargetColor("transparent")).toBe(TRANSPARENT);
  expect(parseTargetColor(" NONE ")).toBe(TRANSPARENT);
  expect(parseTargetColor("#FF0000")).toEqual([255, 0, 0]);
});

test("parseColorMapping accepts transparent target", () => {
  expect(parseColorMapping("#FFFFFF=transparent")).toEqual([[255, 255, 255], TRANSPARENT]);
});

test("parsePalette allows transparent only when enabled", () => {
  expect(parsePalette("#000000,transparent", true)).toEqual([[0, 0, 0], TRANSPARENT]);
  expect(() => parsePalette("#000000,transparent")).toThrow();
});

test("parsePalette accepts comma-separated hex colors", () => {
  expect(parsePalette("#000000,808080, #FFFFFF ")).toEqual([
    [0, 0, 0],
    [128, 128, 128],
    [255, 255, 255],
  ]);
});

test("parsePalette rejects empty entries and invalid hex", () => {
  expect(() => parsePalette("#000000,,#FFFFFF")).toThrow(
    "Expected comma-separated hex colors, got: '#000000,,#FFFFFF'",
  );
  expect(() => parsePalette("#00000G")).toThrow();
});

test("validatePaletteMapping rejects empty or unequal palettes", () => {
  expect(() => validatePaletteMapping([], [[255, 255, 255]])).toThrow();
  expect(() => validatePaletteMapping([[0, 0, 0]], [])).toThrow();
  expect(() =>
    validatePaletteMapping([[0, 0, 0]], [
      [255, 255, 255],
      [0, 0, 0],
    ]),
  ).toThrow("Expected source and target palettes to contain the same number of colors");
});

test("validateDistanceMode rejects unknown modes", () => {
  expect(() => validateDistanceMode("lab")).toThrow(
    "Expected distance to be 'rgb' or 'weighted-rgb'",
  );
  expect(() => validateDistanceMode("weighted-rgb")).not.toThrow();
});

test("formatColor matches the Python summary format", () => {
  expect(formatColor([255, 0, 10])).toBe("(255, 0, 10)");
  expect(formatColor(TRANSPARENT)).toBe("transparent");
});
