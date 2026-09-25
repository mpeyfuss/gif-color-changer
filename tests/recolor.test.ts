import { expect, test } from "bun:test";

import { TRANSPARENT, recolorGif, replaceColors } from "../src";
import { filledFrame, frameOf, gifOf, pixelsOf } from "./helpers";

test("replaceColors maps visible pixels once and preserves alpha", () => {
  const frame = frameOf(4, 1, [
    [255, 255, 255, 255],
    [250, 250, 250, 255],
    [0, 0, 0, 0],
    [0, 0, 0, 255],
  ]);

  const { frame: recolored, counts } = replaceColors(
    frame,
    [
      [[255, 255, 255], [0, 0, 0]],
      [[0, 0, 0], [255, 0, 0]],
    ],
    10,
  );

  expect(counts).toEqual([2, 2]);
  expect(pixelsOf(recolored)).toEqual([
    [0, 0, 0, 255],
    [0, 0, 0, 255],
    [255, 0, 0, 0],
    [255, 0, 0, 255],
  ]);
});

test("replaceColors does not mutate its input", () => {
  const frame = filledFrame(1, 1, [255, 255, 255, 255]);

  replaceColors(frame, [[[255, 255, 255], [0, 0, 0]]], 0);

  expect(pixelsOf(frame)).toEqual([[255, 255, 255, 255]]);
});

test("replaceColors softens pixels near tolerance edge", () => {
  const frame = frameOf(3, 1, [
    [255, 255, 255, 255],
    [250, 250, 250, 255],
    [244, 244, 244, 255],
  ]);

  const { frame: recolored, counts } = replaceColors(
    frame,
    [[[255, 255, 255], [0, 0, 0]]],
    10,
    10,
  );

  expect(counts).toEqual([2]);
  expect(pixelsOf(recolored)).toEqual([
    [0, 0, 0, 255],
    [125, 125, 125, 255],
    [244, 244, 244, 255],
  ]);
});

test("replaceColors makes matched pixels transparent", () => {
  const frame = frameOf(3, 1, [
    [255, 255, 255, 255],
    [250, 250, 250, 255],
    [0, 0, 0, 255],
  ]);

  const { frame: recolored, counts } = replaceColors(
    frame,
    [[[255, 255, 255], TRANSPARENT]],
    10,
  );

  expect(counts).toEqual([2]);
  expect(pixelsOf(recolored)).toEqual([
    [255, 255, 255, 0],
    [250, 250, 250, 0],
    [0, 0, 0, 255],
  ]);
});

test("replaceColors fades alpha toward transparent with softness", () => {
  const frame = frameOf(3, 1, [
    [255, 255, 255, 255],
    [250, 250, 250, 255],
    [244, 244, 244, 255],
  ]);

  const { frame: recolored, counts } = replaceColors(
    frame,
    [[[255, 255, 255], TRANSPARENT]],
    10,
    10,
  );

  expect(counts).toEqual([2]);
  // Exact match goes fully transparent; the edge pixel fades proportionally.
  expect(pixelsOf(recolored)).toEqual([
    [255, 255, 255, 0],
    [250, 250, 250, 128],
    [244, 244, 244, 255],
  ]);
});

test("recolorGif returns frames, metadata and counts", () => {
  const gif = gifOf([filledFrame(1, 1, [255, 255, 255, 255])], [75], 1);

  const recolored = recolorGif(gif, [[[255, 255, 255], [255, 0, 0]]], 0);

  expect(recolored.durations).toEqual([75]);
  expect(recolored.loop).toBe(1);
  expect(recolored.changedCounts).toEqual([1]);
  expect(pixelsOf(recolored.frames[0]!)).toEqual([[255, 0, 0, 255]]);
});

test("recolorGif sums counts across frames", () => {
  const white = filledFrame(2, 1, [255, 255, 255, 255]);
  const gif = gifOf([white, white, filledFrame(2, 1, [0, 0, 0, 255])], [10, 10, 10]);

  const recolored = recolorGif(gif, [[[255, 255, 255], [255, 0, 0]]], 0);

  expect(recolored.changedCounts).toEqual([4]);
  expect(recolored.frames).toHaveLength(3);
});
