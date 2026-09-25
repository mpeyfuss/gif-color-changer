#!/usr/bin/env bun
/**
 * Replace colors across every frame of a GIF.
 *
 * Usage:
 *     gifcc input.gif output.gif --map "#FFFFFF=#FF0000" --map "#000000=#00FF00"
 *     gifcc input.gif output.gif --source-palette "#000000,#FFFFFF" --target-palette "#222222,#EEEEEE"
 */

import { readFileSync, writeFileSync } from "node:fs";

import { Command, InvalidArgumentError } from "commander";

import {
  parseColorMapping,
  parsePalette,
  summaryLines,
  validateDistanceMode,
  validatePaletteMapping,
} from "./colors";
import { readGif, writeGif } from "./gif";
import { rewriteGifPalette } from "./palette";
import { recolorGif } from "./recolor";
import type { RecoloredGif } from "./types";
import pkg from "../package.json" with { type: "json" };

export const DEFAULT_TOLERANCE = 50;
export const DEFAULT_SOFTNESS = 25;

interface Options {
  map?: string[];
  sourcePalette?: string;
  targetPalette?: string;
  distance?: string;
  cleanup?: number;
  tolerance?: number;
  softness?: number;
}

function parseInteger(value: string): number {
  if (!/^\s*[+-]?\d+\s*$/.test(value)) {
    throw new InvalidArgumentError(`invalid int value: '${value}'`);
  }
  return Number.parseInt(value, 10);
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function program(): Command {
  return new Command("gifcc")
    .description("Replace colors across every frame of a GIF.")
    .version(pkg.version)
    .argument("<input>", "Path to input GIF")
    .argument("<output>", "Path to output GIF")
    .option(
      "--map <FROM=TO>",
      "Color mapping in FROM=TO format, e.g. '#FFFFFF=#FF0000'. The TO color " +
        "may be 'transparent' (or 'none') to make matched pixels fully " +
        "transparent. Can be repeated.",
      collect,
    )
    .option(
      "--source-palette <colors>",
      "Comma-separated source palette colors, e.g. '#000000,#808080,#FFFFFF'.",
    )
    .option(
      "--target-palette <colors>",
      "Comma-separated target palette colors, e.g. '#1D3557,#E63946,#F1FAEE'. " +
        "Any entry may be 'transparent' (or 'none') to make pixels in that " +
        "bucket fully transparent.",
    )
    .option(
      "--distance <mode>",
      "Palette color distance mode: 'rgb' or 'weighted-rgb'. Default: rgb",
    )
    .option(
      "--cleanup <passes>",
      "Palette mode only: number of edge-cleanup passes. Each pass reassigns " +
        "isolated pixels to the palette bucket that dominates their " +
        "neighborhood, while leaving real edges intact. Default: 0 (off).",
      parseInteger,
    )
    .option(
      "--tolerance <value>",
      `How close a pixel must be to the source color (0-255). Default: ${DEFAULT_TOLERANCE}`,
      parseInteger,
    )
    .option(
      "--softness <value>",
      "Blend pixels near the edge of the tolerance range instead of fully " +
        `replacing them. Default: ${DEFAULT_SOFTNESS}`,
      parseInteger,
    )
    .action(run);
}

function run(input: string, output: string, options: Options, command: Command) {
  const fail = (message: string): never => command.error(`error: ${message}`, { exitCode: 2 });
  const attempt = <T>(parse: () => T): T => {
    try {
      return parse();
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };

  const paletteMode = options.sourcePalette !== undefined || options.targetPalette !== undefined;
  const toleranceMode = options.map !== undefined;

  if (paletteMode && toleranceMode) fail("--map cannot be combined with palette mode");
  if (!paletteMode && !toleranceMode) {
    fail("expected --map or both --source-palette and --target-palette");
  }

  let recolor: (gif: ReturnType<typeof readGif>) => RecoloredGif;
  let summarize: (recolored: RecoloredGif) => string[];

  if (paletteMode) {
    if (options.sourcePalette === undefined || options.targetPalette === undefined) {
      fail("palette mode requires both --source-palette and --target-palette");
    }
    if (options.tolerance !== undefined) fail("--tolerance cannot be used with palette mode");
    if (options.softness !== undefined) fail("--softness cannot be used with palette mode");

    const cleanup = options.cleanup ?? 0;
    if (cleanup < 0) fail("--cleanup must be 0 or greater");

    const { sourcePalette, targetPalette, distance } = attempt(() => {
      const sourcePalette = parsePalette(options.sourcePalette!);
      const targetPalette = parsePalette(options.targetPalette!, true);
      validatePaletteMapping(sourcePalette, targetPalette);
      const distance = options.distance ?? "rgb";
      validateDistanceMode(distance);
      return { sourcePalette, targetPalette, distance };
    });

    recolor = (gif) => rewriteGifPalette(gif, sourcePalette, targetPalette, distance, cleanup);
    summarize = (recolored) =>
      summaryLines(
        sourcePalette.map((fromRgb, index) => [fromRgb, targetPalette[index]!] as const),
        recolored.changedCounts,
        "assigned",
      );
  } else {
    const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
    const softness = options.softness ?? DEFAULT_SOFTNESS;

    if (softness < 0) fail("--softness must be 0 or greater");
    if (options.distance !== undefined) fail("--distance can only be used with palette mode");
    if (options.cleanup !== undefined) fail("--cleanup can only be used with palette mode");

    const colorMappings = attempt(() => options.map!.map(parseColorMapping));

    recolor = (gif) => recolorGif(gif, colorMappings, tolerance, softness);
    summarize = (recolored) => summaryLines(colorMappings, recolored.changedCounts, "changed");
  }

  console.log("Processing frame(s)...");
  const gif = attempt(() => readGif(readFileSync(input)));
  const recolored = recolor(gif);
  for (const line of summarize(recolored)) console.log(line);

  writeFileSync(output, writeGif(recolored));
  console.log(`Saved: ${output}`);
}

export function main(argv: string[] = process.argv) {
  program().parse(argv);
}

if (import.meta.main) main();
