/// <reference lib="webworker" />
// Decodes and recolors GIFs off the main thread so the page stays responsive
// while large GIFs are processed.

import * as Comlink from "comlink";

import {
  parseColorMapping,
  parsePalette,
  readGif,
  recolorGif,
  rewriteGifPalette,
  summaryLines,
  validateDistanceMode,
  validatePaletteMapping,
  writeGif,
  type DecodedGif,
  type RecoloredGif,
} from "../../src";

export type Job =
  | { mode: "map"; mappings: string[]; tolerance: number; softness: number }
  | { mode: "palette"; source: string; target: string; distance: string; cleanup: number };

export interface LoadedGif {
  width: number;
  height: number;
  frames: number;
}

export interface JobResult {
  bytes: Uint8Array;
  lines: string[];
  ms: number;
}

let input: DecodedGif | null = null;

function loaded(): DecodedGif {
  if (!input) throw new Error("Choose a GIF first");
  return input;
}

function recolor(gif: DecodedGif, job: Job): { recolored: RecoloredGif; lines: string[] } {
  if (job.mode === "map") {
    if (job.mappings.length === 0) throw new Error("Add at least one color mapping");
    if (job.softness < 0) throw new Error("Softness must be 0 or greater");
    const mappings = job.mappings.map(parseColorMapping);
    const recolored = recolorGif(gif, mappings, job.tolerance, job.softness);
    return { recolored, lines: summaryLines(mappings, recolored.changedCounts, "changed") };
  }

  const source = parsePalette(job.source);
  const target = parsePalette(job.target, true);
  validatePaletteMapping(source, target);
  const distance = job.distance;
  validateDistanceMode(distance);
  const recolored = rewriteGifPalette(gif, source, target, distance, job.cleanup);
  const pairs = source.map((color, index) => [color, target[index]!] as const);
  return { recolored, lines: summaryLines(pairs, recolored.changedCounts, "assigned") };
}

const api = {
  load(bytes: ArrayBuffer): LoadedGif {
    input = null;
    const gif = readGif(new Uint8Array(bytes));
    input = gif;
    return { width: gif.width, height: gif.height, frames: gif.frames.length };
  },

  /** Hex color of the first frame's pixel at (x, y), for the eyedropper. */
  pick(x: number, y: number): string {
    const gif = loaded();
    const i = (Math.floor(y) * gif.width + Math.floor(x)) * 4;
    const data = gif.frames[0]!.data;
    return "#" + [data[i]!, data[i + 1]!, data[i + 2]!].map((c) => c.toString(16).padStart(2, "0")).join("");
  },

  run(job: Job): JobResult {
    const started = performance.now();
    const { recolored, lines } = recolor(loaded(), job);
    const bytes = writeGif(recolored);
    const result = { bytes, lines, ms: performance.now() - started };
    return Comlink.transfer(result, [bytes.buffer]);
  },
};

export type WorkerApi = typeof api;

Comlink.expose(api);
