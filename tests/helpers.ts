import type { DecodedGif, RgbaFrame } from "../src";

export type Pixel = readonly [number, number, number, number];

export function frameOf(width: number, height: number, pixels: readonly Pixel[]): RgbaFrame {
  if (pixels.length !== width * height) throw new Error("pixel count mismatch");
  return { data: new Uint8ClampedArray(pixels.flat()), width, height };
}

export function filledFrame(width: number, height: number, pixel: Pixel): RgbaFrame {
  return frameOf(width, height, Array(width * height).fill(pixel));
}

export function pixelsOf(frame: RgbaFrame): number[][] {
  const pixels = [];
  for (let i = 0; i < frame.data.length; i += 4) {
    pixels.push(Array.from(frame.data.subarray(i, i + 4)));
  }
  return pixels;
}

export function gifOf(frames: RgbaFrame[], durations: number[], loop = 0): DecodedGif {
  return { width: frames[0]!.width, height: frames[0]!.height, frames, durations, loop };
}
