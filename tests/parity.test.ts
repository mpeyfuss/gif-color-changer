// Golden tests against output captured from the original Python (numpy +
// Pillow) implementation by scripts/make_fixtures.py.

import { describe, expect, test } from "bun:test";

import {
  parseColorMapping,
  parsePalette,
  replaceColors,
  rewritePalette,
  validateDistanceMode,
  type RgbaFrame,
} from "../src";

const fixtures = new URL("./fixtures/", import.meta.url);

interface Case {
  name: string;
  image: string;
  mode: "map" | "palette";
  mappings?: string[];
  tolerance?: number;
  softness?: number;
  source?: string;
  target?: string;
  distance?: string;
  cleanup?: number;
  offset: number;
  counts: number[];
}

const manifest: {
  width: number;
  height: number;
  images: Record<string, number>;
  cases: Case[];
} = await Bun.file(new URL("manifest.json", fixtures)).json();
const images = await Bun.file(new URL("images.bin", fixtures)).bytes();
const expected = await Bun.file(new URL("expected.bin", fixtures)).bytes();

const { width, height } = manifest;
const frameBytes = width * height * 4;

function frameAt(bytes: Uint8Array, offset: number): RgbaFrame {
  return {
    data: new Uint8ClampedArray(bytes.slice(offset, offset + frameBytes)),
    width,
    height,
  };
}

function run(testCase: Case) {
  const input = frameAt(images, manifest.images[testCase.image]!);
  if (testCase.mode === "map") {
    return replaceColors(
      input,
      testCase.mappings!.map(parseColorMapping),
      testCase.tolerance!,
      testCase.softness!,
    );
  }
  const distance = testCase.distance!;
  validateDistanceMode(distance);
  return rewritePalette(
    input,
    parsePalette(testCase.source!),
    parsePalette(testCase.target!, true),
    distance,
    testCase.cleanup!,
  );
}

function firstMismatch(actual: Uint8ClampedArray, wanted: Uint8ClampedArray) {
  for (let i = 0; i < actual.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      if (actual[i + c] !== wanted[i + c]) {
        return {
          pixel: i / 4,
          actual: Array.from(actual.subarray(i, i + 4)),
          expected: Array.from(wanted.subarray(i, i + 4)),
        };
      }
    }
  }
  return null;
}

describe("matches the Python implementation", () => {
  test.each(manifest.cases.map((c) => [c.name, c] as const))("%s", (_, testCase) => {
    const { frame, counts } = run(testCase);

    expect(counts).toEqual(testCase.counts);
    expect(firstMismatch(frame.data, frameAt(expected, testCase.offset).data)).toBeNull();
  });
});
