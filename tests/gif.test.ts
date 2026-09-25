import { expect, test } from "bun:test";

import { readGif, writeGif } from "../src";
import { frameOf, gifOf, pixelsOf } from "./helpers";

const fixtures = new URL("./fixtures/", import.meta.url);
const manifest = await Bun.file(new URL("manifest.json", fixtures)).json();

async function fixtureGif(name: string) {
  return readGif(await Bun.file(new URL(name, fixtures)).bytes());
}

test("decodes GIFs saved by Pillow exactly as Pillow does", async () => {
  for (const name of ["anim.gif", "still.gif"]) {
    const expected = manifest.gifs[name];
    const gif = await fixtureGif(name);

    expect(gif.width).toBe(expected.width);
    expect(gif.height).toBe(expected.height);
    expect(gif.durations).toEqual(expected.durations);
    expect(gif.loop).toBe(expected.loop ?? 0);
    expect(gif.frames.map((frame) => Buffer.from(frame.data).toString("hex"))).toEqual(
      expected.frames,
    );
  }
});

test("round-trips frames with few colors exactly, including transparency", () => {
  const frames = [
    frameOf(2, 2, [
      [255, 0, 0, 255],
      [0, 0, 0, 0],
      [0, 255, 0, 255],
      [1, 2, 3, 255],
    ]),
    frameOf(2, 2, [
      [0, 0, 0, 0],
      [9, 9, 9, 255],
      [1, 1, 1, 255],
      [0, 0, 0, 255],
    ]),
  ];

  const decoded = readGif(writeGif(gifOf(frames, [70, 120], 3)));

  expect(decoded.durations).toEqual([70, 120]);
  expect(decoded.loop).toBe(3);
  decoded.frames.forEach((frame, index) => {
    pixelsOf(frames[index]!).forEach((original, p) => {
      const actual = pixelsOf(frame)[p]!;
      expect(actual[3] === 0).toBe(original[3] === 0);
      if (original[3] !== 0) expect(actual).toEqual(original);
    });
  });
});

test("only fully transparent pixels stay transparent, like Pillow", () => {
  const frame = frameOf(3, 1, [
    [10, 10, 10, 0],
    [20, 20, 20, 1],
    [30, 30, 30, 128],
  ]);

  const decoded = pixelsOf(readGif(writeGif(gifOf([frame], [100]))).frames[0]!);

  expect(decoded[0]![3]).toBe(0);
  expect(decoded[1]).toEqual([20, 20, 20, 255]);
  expect(decoded[2]).toEqual([30, 30, 30, 255]);
});

test("keeps a fully opaque 256-color frame lossless", () => {
  const pixels = Array.from({ length: 256 }, (_, i) => [i, 255 - i, (i * 7) % 256, 255] as const);
  const frame = frameOf(16, 16, pixels);

  const decoded = readGif(writeGif(gifOf([frame], [100])));

  expect(pixelsOf(decoded.frames[0]!)).toEqual(pixelsOf(frame));
});

test("quantizes busy frames without leaking transparency", () => {
  const width = 64;
  const height = 64;
  const pixels = Array.from({ length: width * height }, (_, i) =>
    [i % 256, (i / 16) | 0, (i * 3) % 251, i % 7 === 0 ? 0 : 255] as const,
  );
  const frame = frameOf(width, height, pixels);

  const decoded = pixelsOf(readGif(writeGif(gifOf([frame], [100]))).frames[0]!);

  pixels.forEach((original, p) => {
    expect(decoded[p]![3] === 0).toBe(original[3] === 0);
  });
});

test("loops forever when loop is zero", () => {
  const still = gifOf([frameOf(1, 1, [[0, 0, 0, 255]])], [100], 0);

  expect(readGif(writeGif(still)).loop).toBe(0);
});

test("clears each frame so transparency doesn't show earlier frames", () => {
  const frames = [
    frameOf(1, 1, [[255, 0, 0, 255]]),
    frameOf(1, 1, [[0, 0, 0, 0]]),
  ];

  const decoded = readGif(writeGif(gifOf(frames, [100, 100])));

  expect(pixelsOf(decoded.frames[1]!)[0]![3]).toBe(0);
});

test("rejects non-GIF input", () => {
  expect(() => readGif(new TextEncoder().encode("not a gif"))).toThrow("Couldn't read this GIF");
});
