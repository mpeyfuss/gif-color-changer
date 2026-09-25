import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readGif, writeGif } from "../src";
import { frameOf, gifOf, pixelsOf, type Pixel } from "./helpers";

const cli = new URL("../src/cli.ts", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "gifcc-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function gifcc(...args: string[]) {
  const result = Bun.spawnSync(["bun", cli, ...args], { stderr: "pipe", stdout: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function writeInput(name: string, frame: ReturnType<typeof frameOf>) {
  const path = join(dir, name);
  writeFileSync(path, writeGif(gifOf([frame], [100])));
  return path;
}

function readOutput(path: string) {
  return pixelsOf(readGif(readFileSync(path)).frames[0]!);
}

const usageErrors: [string, string[]][] = [
  [
    "--tolerance cannot be used with palette mode",
    ["--source-palette", "#000000", "--target-palette", "#FFFFFF", "--tolerance", "10"],
  ],
  [
    "--softness cannot be used with palette mode",
    ["--source-palette", "#000000", "--target-palette", "#FFFFFF", "--softness", "10"],
  ],
  ["--distance can only be used with palette mode", ["--map", "#000000=#FFFFFF", "--distance", "weighted-rgb"]],
  ["--cleanup can only be used with palette mode", ["--map", "#000000=#FFFFFF", "--cleanup", "2"]],
  [
    "--cleanup must be 0 or greater",
    ["--source-palette", "#000000", "--target-palette", "#FFFFFF", "--cleanup", "-1"],
  ],
  ["--softness must be 0 or greater", ["--map", "#000000=#FFFFFF", "--softness", "-1"]],
  ["--map cannot be combined with palette mode", ["--map", "#000000=#FFFFFF", "--source-palette", "#000000"]],
  ["expected --map or both --source-palette and --target-palette", []],
  ["palette mode requires both --source-palette and --target-palette", ["--source-palette", "#000000"]],
  ["Expected color mapping in FROM=TO format, got: '#000000'", ["--map", "#000000"]],
  [
    "Expected source and target palettes to contain the same number of colors",
    ["--source-palette", "#000000,#FFFFFF", "--target-palette", "#FFFFFF"],
  ],
  [
    "Expected distance to be 'rgb' or 'weighted-rgb'",
    ["--source-palette", "#000000", "--target-palette", "#FFFFFF", "--distance", "lab"],
  ],
];

test.each(usageErrors)("rejects: %s", (message, args) => {
  const { exitCode, stderr } = gifcc("input.gif", "output.gif", ...args);

  expect(exitCode).toBe(2);
  expect(stderr).toContain(message);
});

test("rejects non-integer numbers", () => {
  const { exitCode, stderr } = gifcc("in.gif", "out.gif", "--map", "#000000=#FFFFFF", "--tolerance", "ten");

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("invalid int value: 'ten'");
});

test("cleanup recolors isolated pixel in palette mode", () => {
  const pixels = Array.from({ length: 9 }, (): Pixel => [0, 0, 0, 255]);
  pixels[4] = [255, 255, 255, 255]; // lone white pixel in a field of black
  const input = writeInput("cleanup.gif", frameOf(3, 3, pixels));
  const output = join(dir, "cleanup-out.gif");

  const result = gifcc(
    input,
    output,
    "--source-palette",
    "#000000,#FFFFFF",
    "--target-palette",
    "#FF0000,#0000FF",
    "--cleanup",
    "1",
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe(
    [
      "Processing frame(s)...",
      "(0, 0, 0) -> (255, 0, 0): assigned 9 pixel(s)",
      "(255, 255, 255) -> (0, 0, 255): assigned 0 pixel(s)",
      `Saved: ${output}`,
      "",
    ].join("\n"),
  );
  expect(readOutput(output)).toEqual(Array(9).fill([255, 0, 0, 255]));
});

test("maps color to transparent", () => {
  const input = writeInput(
    "transparent.gif",
    frameOf(2, 1, [
      [255, 255, 255, 255],
      [0, 0, 0, 255],
    ]),
  );
  const output = join(dir, "transparent-out.gif");

  const result = gifcc(input, output, "--map", "#FFFFFF=transparent");

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("(255, 255, 255) -> transparent: changed 1 pixel(s)");
  const [white, black] = readOutput(output);
  // The white pixel is now transparent; the black pixel is untouched.
  expect(white![3]).toBe(0);
  expect(black).toEqual([0, 0, 0, 255]);
});

test("rewrites GIF with palette mode", () => {
  const input = writeInput(
    "palette.gif",
    frameOf(2, 1, [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]),
  );
  const output = join(dir, "palette-out.gif");

  const result = gifcc(
    input,
    output,
    "--source-palette",
    "#000000,#FFFFFF",
    "--target-palette",
    "#FF0000,#0000FF",
    "--distance",
    "weighted-rgb",
  );

  expect(result.exitCode).toBe(0);
  expect(readOutput(output)).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
});

test("reports unreadable input", () => {
  const input = join(dir, "not-a.gif");
  writeFileSync(input, "not a gif");

  const { exitCode, stderr } = gifcc(input, join(dir, "x.gif"), "--map", "#000000=#FFFFFF");

  expect(exitCode).toBe(2);
  expect(stderr).toContain("Couldn't read this GIF");
});
