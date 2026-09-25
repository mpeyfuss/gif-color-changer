import { f32, rint } from "./numeric";
import {
  TRANSPARENT,
  type ColorMapping,
  type DecodedGif,
  type FrameResult,
  type RecoloredGif,
  type RgbaFrame,
} from "./types";

/**
 * Replace RGB colors while preserving the original alpha channel.
 *
 * Every mapping is matched against the frame's *original* colors, and a pixel
 * is only changed by the first mapping that matches it. A pixel matches when
 * its largest per-channel difference from the source color is within
 * `tolerance`. With `softness`, pixels in the outer `softness` band of the
 * tolerance range are blended toward the replacement instead of replaced.
 */
export function replaceColors(
  frame: RgbaFrame,
  colorMappings: readonly ColorMapping[],
  tolerance: number,
  softness = 0,
): FrameResult {
  const pixels = new Uint8ClampedArray(frame.data);
  const changedCounts = new Array<number>(colorMappings.length).fill(0);

  const soft = softness > 0 && tolerance > 0;
  const softStart = Math.max(tolerance - softness, 0);
  const softRange = tolerance - softStart;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;

    for (let index = 0; index < colorMappings.length; index++) {
      const [fromRgb, toRgb] = colorMappings[index]!;
      const colorDistance = Math.max(
        Math.abs(r - fromRgb[0]),
        Math.abs(g - fromRgb[1]),
        Math.abs(b - fromRgb[2]),
      );
      if (colorDistance > tolerance) continue;

      const blendWeight =
        soft && colorDistance > softStart
          ? f32((tolerance - colorDistance) / softRange)
          : 1;

      if (toRgb === TRANSPARENT) {
        // Fade matched pixels toward fully transparent. With softness, the
        // alpha drops proportionally near the tolerance edge; the RGB is
        // left untouched since it is on its way to being invisible.
        pixels[i + 3] = soft
          ? rint(f32(pixels[i + 3]! * f32(1 - blendWeight)))
          : 0;
      } else if (soft) {
        pixels[i] = blend(r, toRgb[0], blendWeight);
        pixels[i + 1] = blend(g, toRgb[1], blendWeight);
        pixels[i + 2] = blend(b, toRgb[2], blendWeight);
      } else {
        pixels[i] = toRgb[0];
        pixels[i + 1] = toRgb[1];
        pixels[i + 2] = toRgb[2];
      }

      changedCounts[index]!++;
      break;
    }
  }

  return {
    frame: { data: pixels, width: frame.width, height: frame.height },
    counts: changedCounts,
  };
}

/** `source + (target - source) * weight` in float32, as numpy computes it. */
function blend(source: number, target: number, weight: number): number {
  return rint(f32(source + f32(f32(target - source) * weight)));
}

export function recolorGif(
  gif: DecodedGif,
  colorMappings: readonly ColorMapping[],
  tolerance: number,
  softness = 0,
): RecoloredGif {
  const totalChangedCounts = new Array<number>(colorMappings.length).fill(0);
  const frames = gif.frames.map((frame) => {
    const result = replaceColors(frame, colorMappings, tolerance, softness);
    result.counts.forEach((count, index) => {
      totalChangedCounts[index]! += count;
    });
    return result.frame;
  });

  return { ...gif, frames, changedCounts: totalChangedCounts };
}
