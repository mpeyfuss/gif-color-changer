import { validateDistanceMode, validatePaletteMapping } from "./colors";
import { f32 } from "./numeric";
import {
  TRANSPARENT,
  type DecodedGif,
  type DistanceMode,
  type FrameResult,
  type Palette,
  type RecoloredGif,
  type RgbaFrame,
  type TargetPalette,
} from "./types";

// Rec. 709 luminance weights for `weighted-rgb` distance, as float32.
const RGB_DISTANCE_WEIGHTS = [f32(0.2126), f32(0.7152), f32(0.0722)] as const;

/** Offsets of the 8 neighbors around a pixel, as [dx, dy] pairs. */
const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
] as const;

/**
 * Smooth a label map by reassigning pixels to the label that surrounds them
 * more than their own.
 *
 * Each pass reassigns a pixel whenever some *other* label occupies more of its
 * 8-neighborhood than the pixel's own label does, snapping it to whichever
 * neighbor dominates. This absorbs isolated speckles and the thin
 * intermediate bands that form along antialiased edges (their own label has
 * few neighbors), while pixels inside a solid region or along a real boundary
 * keep their label, because their own side still dominates their
 * neighborhood. Ties between competing labels resolve to the lower index.
 * Pixels outside the image count as no label, so border pixels simply have
 * fewer neighbors.
 */
export function cleanupEdges(
  labels: Uint16Array,
  width: number,
  height: number,
  numLabels: number,
  passes: number,
): Uint16Array {
  let current = labels.slice();
  if (passes <= 0) return current;

  const counts = new Uint8Array(numLabels);
  const neighborLabels = new Uint16Array(NEIGHBORS.length);

  for (let pass = 0; pass < passes; pass++) {
    const next = current.slice();
    let flipped = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let neighborCount = 0;
        for (const [dx, dy] of NEIGHBORS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const label = current[ny * width + nx]!;
          neighborLabels[neighborCount++] = label;
          counts[label]!++;
        }

        const own = current[y * width + x]!;
        const ownCount = counts[own]!;
        // Only labels present in the neighborhood can outnumber the pixel's
        // own, so the strongest competitor is found among them.
        let bestLabel = -1;
        let bestCount = 0;
        for (let n = 0; n < neighborCount; n++) {
          const label = neighborLabels[n]!;
          if (label === own) continue;
          const count = counts[label]!;
          if (count > bestCount || (count === bestCount && label < bestLabel)) {
            bestLabel = label;
            bestCount = count;
          }
        }
        for (let n = 0; n < neighborCount; n++) counts[neighborLabels[n]!] = 0;

        if (bestLabel !== -1 && bestCount > ownCount) {
          next[y * width + x] = bestLabel;
          flipped = true;
        }
      }
    }

    current = next;
    if (!flipped) break;
  }

  return current;
}

/** Index of the nearest source palette color per pixel. Ties resolve to the first color. */
function nearestIndexes(
  pixels: Uint8ClampedArray,
  sourcePalette: Palette,
  distance: DistanceMode,
): Uint16Array {
  const labels = new Uint16Array(pixels.length / 4);

  for (let p = 0; p < labels.length; p++) {
    const r = pixels[p * 4]!;
    const g = pixels[p * 4 + 1]!;
    const b = pixels[p * 4 + 2]!;
    let nearestDistance = Infinity;
    let nearestIndex = 0;

    for (let index = 0; index < sourcePalette.length; index++) {
      const source = sourcePalette[index]!;
      const dr = r - source[0];
      const dg = g - source[1];
      const db = b - source[2];
      let d: number;
      if (distance === "weighted-rgb") {
        // Summed in float32, left to right, as numpy does for three values.
        d = f32(dr * dr * RGB_DISTANCE_WEIGHTS[0]);
        d = f32(d + f32(dg * dg * RGB_DISTANCE_WEIGHTS[1]));
        d = f32(d + f32(db * db * RGB_DISTANCE_WEIGHTS[2]));
      } else {
        d = dr * dr + dg * dg + db * db;
      }
      if (d < nearestDistance) {
        nearestDistance = d;
        nearestIndex = index;
      }
    }
    labels[p] = nearestIndex;
  }

  return labels;
}

/** Rewrite RGB colors onto a target palette while preserving the original alpha channel. */
export function rewritePalette(
  frame: RgbaFrame,
  sourcePalette: Palette,
  targetPalette: TargetPalette,
  distance: DistanceMode = "rgb",
  cleanup = 0,
): FrameResult {
  validatePaletteMapping(sourcePalette, targetPalette);
  validateDistanceMode(distance);

  const pixels = new Uint8ClampedArray(frame.data);
  const pixelCount = pixels.length / 4;
  let labels = nearestIndexes(pixels, sourcePalette, distance);

  if (cleanup > 0) {
    // Treat "transparent" as an extra region so cleanup works on color and
    // opacity together: a pixel adopts the color *and* alpha of whatever
    // surrounds it most. Stray opaque pixels in transparent space become
    // transparent, and transparent holes inside a region fill in. This also
    // stops visible pixels from being recolored toward the hidden RGB of
    // transparent neighbors, which now only ever vote for "transparent".
    const transparentLabel = sourcePalette.length;
    for (let p = 0; p < pixelCount; p++) {
      if (pixels[p * 4 + 3] === 0) labels[p] = transparentLabel;
    }
    const opaque = labels.map((label) => (label === transparentLabel ? 0 : 1));
    labels = cleanupEdges(
      labels,
      frame.width,
      frame.height,
      sourcePalette.length + 1,
      cleanup,
    );

    for (let p = 0; p < pixelCount; p++) {
      if (labels[p] === transparentLabel) {
        pixels[p * 4 + 3] = 0;
      } else if (!opaque[p]) {
        // Transparent pixels pulled into a region become fully opaque.
        pixels[p * 4 + 3] = 255;
      }
    }
  }

  const assignmentCounts = new Array<number>(sourcePalette.length).fill(0);
  for (let p = 0; p < pixelCount; p++) {
    const index = labels[p]!;
    const targetColor = targetPalette[index];
    if (targetColor === undefined) continue; // the cleanup "transparent" label

    if (targetColor === TRANSPARENT) {
      pixels[p * 4 + 3] = 0;
    } else {
      pixels[p * 4] = targetColor[0];
      pixels[p * 4 + 1] = targetColor[1];
      pixels[p * 4 + 2] = targetColor[2];
    }
    assignmentCounts[index]!++;
  }

  return {
    frame: { data: pixels, width: frame.width, height: frame.height },
    counts: assignmentCounts,
  };
}

export function rewriteGifPalette(
  gif: DecodedGif,
  sourcePalette: Palette,
  targetPalette: TargetPalette,
  distance: DistanceMode = "rgb",
  cleanup = 0,
): RecoloredGif {
  validatePaletteMapping(sourcePalette, targetPalette);
  validateDistanceMode(distance);

  const totalAssignmentCounts = new Array<number>(sourcePalette.length).fill(0);
  const frames = gif.frames.map((frame) => {
    const result = rewritePalette(
      frame,
      sourcePalette,
      targetPalette,
      distance,
      cleanup,
    );
    result.counts.forEach((count, index) => {
      totalAssignmentCounts[index]! += count;
    });
    return result.frame;
  });

  return { ...gif, frames, changedCounts: totalAssignmentCounts };
}
