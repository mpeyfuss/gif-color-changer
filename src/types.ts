export type Rgb = readonly [number, number, number];

// Sentinel for a fully transparent target color. Only valid on the replacement
// side of a mapping/palette; source matching always stays RGB-only.
export const TRANSPARENT = "transparent";
export const TRANSPARENT_KEYWORDS = ["transparent", "none"] as const;
export type TargetColor = Rgb | typeof TRANSPARENT;

export type ColorMapping = readonly [from: Rgb, to: TargetColor];
export type Palette = readonly Rgb[];
export type TargetPalette = readonly TargetColor[];
export type DistanceMode = "rgb" | "weighted-rgb";

/** One RGBA image, laid out like the DOM's `ImageData`. */
export interface RgbaFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A decoded GIF: every frame fully composited as RGBA. */
export interface DecodedGif {
  width: number;
  height: number;
  frames: RgbaFrame[];
  /** Per-frame delay in milliseconds. */
  durations: number[];
  /** Number of times to repeat the animation; 0 loops forever. */
  loop: number;
}

export interface RecoloredGif extends DecodedGif {
  /** Pixels changed per mapping, or assigned per palette bucket, summed over every frame. */
  changedCounts: number[];
}

export interface FrameResult {
  frame: RgbaFrame;
  counts: number[];
}
