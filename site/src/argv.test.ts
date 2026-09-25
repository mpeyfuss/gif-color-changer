import { describe, expect, test } from "bun:test";
import { buildArgs, formatCommand, shellQuote } from "./argv";

describe("buildArgs", () => {
  test("map mode omits default tolerance and softness", () => {
    expect(
      buildArgs({
        mode: "map",
        pairs: [
          { from: "#FFFFFF", to: "transparent" },
          { from: "#000000", to: "#FF0000" },
        ],
        tolerance: 50,
        softness: 25,
      }),
    ).toEqual(["--map", "#FFFFFF=transparent", "--map", "#000000=#FF0000"]);
  });

  test("map mode includes non-default tolerance and softness", () => {
    expect(
      buildArgs({
        mode: "map",
        pairs: [{ from: "#FFFFFF", to: "#FF0000" }],
        tolerance: 20,
        softness: 0,
      }),
    ).toEqual(["--map", "#FFFFFF=#FF0000", "--tolerance", "20", "--softness", "0"]);
  });

  test("palette mode joins palettes by position", () => {
    expect(
      buildArgs({
        mode: "palette",
        pairs: [
          { from: "#000000", to: "#1D3557" },
          { from: "#FFFFFF", to: "transparent" },
        ],
        distance: "weighted-rgb",
        cleanup: 2,
      }),
    ).toEqual([
      "--source-palette",
      "#000000,#FFFFFF",
      "--target-palette",
      "#1D3557,transparent",
      "--distance",
      "weighted-rgb",
      "--cleanup",
      "2",
    ]);
  });

  test("palette mode omits default distance and cleanup", () => {
    expect(
      buildArgs({
        mode: "palette",
        pairs: [{ from: "#000000", to: "#FFFFFF" }],
        distance: "rgb",
        cleanup: 0,
      }),
    ).toEqual(["--source-palette", "#000000", "--target-palette", "#FFFFFF"]);
  });
});

describe("shellQuote", () => {
  test("leaves plain words alone", () => {
    expect(shellQuote("input.gif")).toBe("input.gif");
    expect(shellQuote("--map")).toBe("--map");
  });

  test("quotes hex colors", () => {
    expect(shellQuote("#FFFFFF=#FF0000")).toBe('"#FFFFFF=#FF0000"');
  });

  test("single-quotes shell metacharacters", () => {
    expect(shellQuote("my $file's.gif")).toBe(`'my $file'\\''s.gif'`);
  });
});

test("formatCommand puts one option per line", () => {
  expect(
    formatCommand("in put.gif", "out.gif", ["--map", "#FFFFFF=#FF0000", "--tolerance", "20"]),
  ).toBe('gifcc "in put.gif" out.gif \\\n  --map "#FFFFFF=#FF0000" \\\n  --tolerance 20');
});
