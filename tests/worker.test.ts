// Drives the web app's worker through Comlink, as the page does. Rejections
// are checked by awaiting them directly: Bun's `expect().rejects` hangs on
// some Comlink rejections.

import { afterAll, expect, test } from "bun:test";
import * as Comlink from "comlink";

import { parseColorMapping, readGif, recolorGif, summaryLines } from "../src";
import type { WorkerApi } from "../web/src/worker";

const raw = new Worker(new URL("../web/src/worker.ts", import.meta.url));
const worker = Comlink.wrap<WorkerApi>(raw);
afterAll(() => raw.terminate());

/** The message a worker call rejects with, or null if it resolves. */
function rejection(call: Promise<unknown>): Promise<string | null> {
  return call.then(
    () => null,
    (error: Error) => error.message,
  );
}

const anim = await Bun.file(new URL("./fixtures/anim.gif", import.meta.url)).arrayBuffer();

test("runs before a GIF is loaded report an error", async () => {
  const run = worker.run({ mode: "map", mappings: ["#FFFFFF=#FF0000"], tolerance: 0, softness: 0 });

  expect(await rejection(run)).toBe("Choose a GIF first");
});

test("loads, picks colors, and recolors a GIF", async () => {
  expect(await worker.load(anim.slice(0))).toEqual({ width: 6, height: 4, frames: 3 });
  expect(await worker.pick(0, 0)).toBe("#0ac80a");
  expect(await worker.pick(1, 0)).toBe("#ffffff");

  const mappings = ["#FFFFFF=#FF0000", "#000000=transparent"];
  const output = await worker.run({ mode: "map", mappings, tolerance: 0, softness: 0 });

  const parsed = mappings.map(parseColorMapping);
  const expected = recolorGif(readGif(new Uint8Array(anim)), parsed, 0, 0);
  expect(output.lines).toEqual(summaryLines(parsed, expected.changedCounts, "changed"));
  expect(output.lines[0]).toBe("(255, 255, 255) -> (255, 0, 0): changed 16 pixel(s)");
  const gif = readGif(output.bytes);
  expect(gif.frames).toHaveLength(3);
  expect(gif.durations).toEqual([70, 120, 40]);
  expect(Array.from(gif.frames[0]!.data.subarray(4, 8))).toEqual([255, 0, 0, 255]);
});

test("rewrites palettes and surfaces parse errors", async () => {
  await worker.load(anim.slice(0));

  const output = await worker.run({
    mode: "palette",
    source: "#000000,#FFFFFF",
    target: "#1D3557,transparent",
    distance: "weighted-rgb",
    cleanup: 1,
  });
  expect(output.lines).toHaveLength(2);
  expect(output.lines[1]).toStartWith("(255, 255, 255) -> transparent: assigned");

  const unequal = worker.run({
    mode: "palette",
    source: "#000000",
    target: "#FFFFFF,#000000",
    distance: "rgb",
    cleanup: 0,
  });
  expect(await rejection(unequal)).toBe(
    "Expected source and target palettes to contain the same number of colors",
  );
  const empty = worker.run({ mode: "map", mappings: [], tolerance: 0, softness: 0 });
  expect(await rejection(empty)).toBe("Add at least one color mapping");
});

test("rejects files that aren't GIFs", async () => {
  const load = worker.load(new TextEncoder().encode("nope").buffer);

  expect(await rejection(load)).toStartWith("Couldn't read this GIF");
});
