// Minimal types for the parts of gifenc this package uses; gifenc ships none.
declare module "gifenc" {
  export type PaletteColor = number[];
  export type ColorFormat = "rgb565" | "rgb444" | "rgba4444";

  export interface FrameOptions {
    palette?: PaletteColor[];
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    /** Frame delay in milliseconds. */
    delay?: number;
    /** -1 plays once, 0 loops forever, N repeats N times. */
    repeat?: number;
    colorDepth?: number;
    dispose?: number;
  }

  export interface Encoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: FrameOptions,
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
  }

  export function GIFEncoder(options?: {
    auto?: boolean;
    initialCapacity?: number;
  }): Encoder;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: ColorFormat },
  ): PaletteColor[];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: PaletteColor[],
    format?: ColorFormat,
  ): Uint8Array;
}
