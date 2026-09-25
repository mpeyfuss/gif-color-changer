import { applyPalette, GIFEncoder, quantize, type PaletteColor } from "gifenc";
import { decode, decodeFrames } from "modern-gif";

import type { DecodedGif, RgbaFrame } from "./types";

/**
 * GIF transparency is 1-bit: pixels with alpha below this are written as the
 * transparent palette index, everything else as fully opaque. Like Pillow,
 * only fully transparent pixels become transparent.
 */
export const ALPHA_THRESHOLD = 1;
/** Frame delay used when a frame doesn't specify one. */
export const DEFAULT_DURATION_MS = 100;
// Every frame covers the full canvas, so clearing it before the next one keeps
// transparent pixels transparent instead of showing the previous frame.
const DISPOSE_TO_BACKGROUND = 2;

/** Decode a GIF into fully composited RGBA frames. */
export function readGif(bytes: Uint8Array): DecodedGif {
  // modern-gif only reads the bytes, so any backing buffer will do.
  const source = bytes as Uint8Array<ArrayBuffer>;
  try {
    const gif = decode(source);
    const decoded = decodeFrames(source, { gif });
    if (decoded.length === 0) throw new Error("GIF contains no frames");

    return {
      width: gif.width,
      height: gif.height,
      frames: decoded.map(({ data, width, height }) => ({ data, width, height })),
      durations: gif.frames.map((frame) =>
        frame.graphicControl ? frame.delay : DEFAULT_DURATION_MS,
      ),
      loop: gif.loopCount ?? 0,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Couldn't read this GIF: ${reason}`);
  }
}

/**
 * Encode frames as an animated GIF. Frames with at most 255 distinct opaque
 * colors (256 if fully opaque) get an exact palette; busier frames are
 * quantized.
 */
export function writeGif(
  gif: Pick<DecodedGif, "width" | "height" | "frames" | "durations" | "loop">,
): Uint8Array {
  const encoder = GIFEncoder();

  gif.frames.forEach((frame, index) => {
    const { palette, indexes, transparentIndex } = indexFrame(frame);
    encoder.writeFrame(indexes, gif.width, gif.height, {
      palette,
      delay: gif.durations[index] ?? DEFAULT_DURATION_MS,
      repeat: gif.loop,
      transparent: transparentIndex !== -1,
      transparentIndex,
      dispose: DISPOSE_TO_BACKGROUND,
    });
  });

  encoder.finish();
  return encoder.bytes();
}

interface IndexedFrame {
  palette: PaletteColor[];
  indexes: Uint8Array;
  /** Palette index of fully transparent pixels, or -1 if there are none. */
  transparentIndex: number;
}

function indexFrame({ data }: RgbaFrame): IndexedFrame {
  const pixelCount = data.length / 4;
  let hasTransparency = false;
  for (let p = 0; p < pixelCount; p++) {
    if (data[p * 4 + 3]! < ALPHA_THRESHOLD) {
      hasTransparency = true;
      break;
    }
  }
  const maxColors = hasTransparency ? 255 : 256;

  const { palette, indexes } =
    exactPalette(data, maxColors) ?? quantizedPalette(data, maxColors);

  let transparentIndex = -1;
  if (hasTransparency) {
    transparentIndex = palette.length;
    palette.push([0, 0, 0]);
    for (let p = 0; p < pixelCount; p++) {
      if (data[p * 4 + 3]! < ALPHA_THRESHOLD) indexes[p] = transparentIndex;
    }
  }
  // A color table needs at least two entries.
  while (palette.length < 2) palette.push([0, 0, 0]);

  return { palette, indexes, transparentIndex };
}

/**
 * Build a lossless palette, or `null` if the frame has too many colors.
 * Transparent pixels are left at index 0 for the caller to fill in.
 */
function exactPalette(
  data: Uint8ClampedArray,
  maxColors: number,
): Omit<IndexedFrame, "transparentIndex"> | null {
  const lookup = new Map<number, number>();
  const palette: PaletteColor[] = [];
  const indexes = new Uint8Array(data.length / 4);

  for (let p = 0; p < indexes.length; p++) {
    const i = p * 4;
    if (data[i + 3]! < ALPHA_THRESHOLD) continue;

    const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
    let index = lookup.get(key);
    if (index === undefined) {
      if (lookup.size === maxColors) return null;
      index = lookup.size;
      lookup.set(key, index);
      palette.push([data[i]!, data[i + 1]!, data[i + 2]!]);
    }
    indexes[p] = index;
  }

  return { palette, indexes };
}

/** Quantize the opaque pixels of a frame down to `maxColors`. */
function quantizedPalette(
  data: Uint8ClampedArray,
  maxColors: number,
): Omit<IndexedFrame, "transparentIndex"> {
  // Only opaque pixels take part, so the hidden RGB of transparent pixels
  // can't steal palette entries.
  const opaque: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! >= ALPHA_THRESHOLD) {
      opaque.push(data[i]!, data[i + 1]!, data[i + 2]!, 255);
    }
  }
  const palette = quantize(new Uint8Array(opaque), maxColors);
  return { palette, indexes: applyPalette(data, palette) };
}
