import { expect, test } from "bun:test";

import { TRANSPARENT, cleanupEdges, rewriteGifPalette, rewritePalette } from "../src";
import { filledFrame, frameOf, gifOf, pixelsOf, type Pixel } from "./helpers";

/** Build a label map from rows, e.g. [[0, 0], [1, 1]]. */
function labelsOf(rows: number[][]) {
  return { labels: Uint16Array.from(rows.flat()), width: rows[0]!.length, height: rows.length };
}

function rowsOf(labels: Uint16Array, width: number): number[][] {
  const rows = [];
  for (let i = 0; i < labels.length; i += width) rows.push(Array.from(labels.subarray(i, i + width)));
  return rows;
}

test("rewritePalette assigns transparent target bucket", () => {
  const frame = frameOf(2, 1, [
    [1, 1, 1, 255],
    [254, 254, 254, 255],
  ]);

  const { frame: recolored, counts } = rewritePalette(
    frame,
    [
      [0, 0, 0],
      [255, 255, 255],
    ],
    [[10, 20, 30], TRANSPARENT],
  );

  expect(counts).toEqual([1, 1]);
  expect(pixelsOf(recolored)).toEqual([
    [10, 20, 30, 255],
    [254, 254, 254, 0],
  ]);
});

test("rewritePalette forces pixels to nearest source palette bucket", () => {
  const frame = frameOf(4, 1, [
    [1, 1, 1, 255],
    [254, 254, 254, 255],
    [128, 128, 128, 255],
    [7, 8, 9, 0],
  ]);

  const { frame: recolored, counts } = rewritePalette(
    frame,
    [
      [0, 0, 0],
      [255, 255, 255],
    ],
    [
      [10, 20, 30],
      [200, 210, 220],
    ],
  );

  expect(counts).toEqual([2, 2]);
  expect(pixelsOf(recolored)).toEqual([
    [10, 20, 30, 255],
    [200, 210, 220, 255],
    [200, 210, 220, 255],
    [10, 20, 30, 0],
  ]);
});

test("rewritePalette breaks distance ties by first source color", () => {
  const { frame: recolored, counts } = rewritePalette(
    filledFrame(1, 1, [5, 0, 0, 255]),
    [
      [0, 0, 0],
      [10, 0, 0],
    ],
    [
      [255, 0, 0],
      [0, 255, 0],
    ],
  );

  expect(counts).toEqual([1, 0]);
  expect(pixelsOf(recolored)).toEqual([[255, 0, 0, 255]]);
});

test("rewritePalette supports weighted-rgb distance", () => {
  const frame = filledFrame(1, 1, [0, 0, 0, 255]);
  const source = [
    [0, 0, 100],
    [0, 50, 0],
  ] as const;
  const target = [
    [255, 0, 0],
    [0, 0, 255],
  ] as const;

  const rgb = rewritePalette(frame, source, target);
  const weighted = rewritePalette(frame, source, target, "weighted-rgb");

  expect(rgb.counts).toEqual([0, 1]);
  expect(weighted.counts).toEqual([1, 0]);
  expect(pixelsOf(rgb.frame)).toEqual([[0, 0, 255, 255]]);
  expect(pixelsOf(weighted.frame)).toEqual([[255, 0, 0, 255]]);
});

test("rewritePalette validates its palettes and distance", () => {
  const frame = filledFrame(1, 1, [0, 0, 0, 255]);
  expect(() => rewritePalette(frame, [[0, 0, 0]], [])).toThrow();
  // @ts-expect-error: unknown distance mode
  expect(() => rewritePalette(frame, [[0, 0, 0]], [[0, 0, 0]], "lab")).toThrow();
});

test("cleanupEdges absorbs isolated speckle into neighbor majority", () => {
  const { labels, width, height } = labelsOf([
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]);

  const cleaned = cleanupEdges(labels, width, height, 2, 1);

  expect(Array.from(cleaned).every((label) => label === 0)).toBe(true);
});

test("cleanupEdges preserves a straight edge", () => {
  // Left half bucket 0, right half bucket 1. Each edge pixel's own side still
  // dominates its neighborhood, so the boundary is left intact.
  const rows = Array.from({ length: 4 }, () => [0, 0, 1, 1]);
  const { labels, width, height } = labelsOf(rows);

  const cleaned = cleanupEdges(labels, width, height, 2, 3);

  expect(rowsOf(cleaned, width)).toEqual(rows);
});

test("cleanupEdges dissolves a thin intermediate band along an edge", () => {
  // A 1-pixel-wide bucket-2 band sits between a bucket-0 region (cols 0-1) and
  // a bucket-1 region (cols 3-4) -- the antialiased-edge case. Every band
  // pixel is outnumbered by the regions on either side, so the band dissolves
  // into them and no bucket-2 pixel survives. The two regions are preserved.
  const { labels, width, height } = labelsOf(Array.from({ length: 5 }, () => [0, 0, 2, 1, 1]));

  const cleaned = rowsOf(cleanupEdges(labels, width, height, 3, 1), width);

  expect(cleaned.flat()).not.toContain(2);
  for (const row of cleaned) {
    expect(row.slice(0, 2)).toEqual([0, 0]);
    expect(row.slice(3)).toEqual([1, 1]);
  }
});

test("cleanupEdges is a no-op when passes is zero", () => {
  const { labels, width, height } = labelsOf([
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]);

  const cleaned = cleanupEdges(labels, width, height, 2, 0);

  expect(Array.from(cleaned)).toEqual(Array.from(labels));
  expect(cleaned).not.toBe(labels);
});

test("rewritePalette cleanup erases stray opaque pixel into transparency", () => {
  const pixels = Array.from({ length: 9 }, (): Pixel => [0, 0, 128, 0]);
  pixels[4] = [0, 0, 128, 255]; // one stray opaque pixel
  const palette = [
    [255, 255, 0],
    [0, 0, 128],
  ] as const;

  const { frame: recolored } = rewritePalette(frameOf(3, 3, pixels), palette, palette, "rgb", 1);

  // Surrounded by transparency, the stray pixel takes on that transparency.
  expect(pixelsOf(recolored).every((pixel) => pixel[3] === 0)).toBe(true);
});

test("rewritePalette cleanup fills transparent hole inside a region", () => {
  const pixels = Array.from({ length: 9 }, (): Pixel => [255, 255, 0, 255]);
  pixels[4] = [0, 0, 128, 0]; // one transparent hole in the middle
  const palette = [
    [255, 255, 0],
    [0, 0, 128],
  ] as const;

  const { frame: recolored } = rewritePalette(frameOf(3, 3, pixels), palette, palette, "rgb", 1);

  // Surrounded by the region, the hole fills in with its color and opacity.
  expect(pixelsOf(recolored)).toEqual(Array(9).fill([255, 255, 0, 255]));
});

test("rewritePalette cleanup recolors isolated pixel to neighbor color", () => {
  const pixels = Array.from({ length: 9 }, (): Pixel => [0, 0, 0, 255]);
  pixels[4] = [255, 255, 255, 255]; // lone white pixel in a field of black

  const { frame: recolored, counts } = rewritePalette(
    frameOf(3, 3, pixels),
    [
      [0, 0, 0],
      [255, 255, 255],
    ],
    [
      [10, 20, 30],
      [200, 210, 220],
    ],
    "rgb",
    1,
  );

  // The lone white pixel is reassigned to the surrounding black bucket.
  expect(counts).toEqual([9, 0]);
  expect(pixelsOf(recolored)).toEqual(Array(9).fill([10, 20, 30, 255]));
});

test("rewriteGifPalette returns frames, metadata and counts", () => {
  const frame = frameOf(2, 1, [
    [0, 0, 0, 255],
    [255, 255, 255, 255],
  ]);

  const recolored = rewriteGifPalette(
    gifOf([frame], [75], 1),
    [
      [0, 0, 0],
      [255, 255, 255],
    ],
    [
      [255, 0, 0],
      [0, 0, 255],
    ],
  );

  expect(recolored.durations).toEqual([75]);
  expect(recolored.loop).toBe(1);
  expect(recolored.changedCounts).toEqual([1, 1]);
  expect(pixelsOf(recolored.frames[0]!)).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
});
