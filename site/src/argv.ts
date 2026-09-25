// Turns the demo's form state into gifcc arguments. The same array is shown as
// the copyable shell command and handed to the CLI running in Pyodide, so the
// two can never disagree.

export const TRANSPARENT = "transparent";
export const DEFAULT_TOLERANCE = 50;
export const DEFAULT_SOFTNESS = 25;

export type Distance = "rgb" | "weighted-rgb";

export interface ColorPair {
  from: string;
  // A hex color or TRANSPARENT.
  to: string;
}

export type FormState =
  | { mode: "map"; pairs: ColorPair[]; tolerance: number; softness: number }
  | { mode: "palette"; pairs: ColorPair[]; distance: Distance; cleanup: number };

// Options only; the input and output paths are prepended by the caller.
// Defaults are omitted so the command stays as short as a person would type it.
export function buildArgs(state: FormState): string[] {
  if (state.mode === "map") {
    const args = state.pairs.flatMap((pair) => ["--map", `${pair.from}=${pair.to}`]);
    if (state.tolerance !== DEFAULT_TOLERANCE) {
      args.push("--tolerance", String(state.tolerance));
    }
    if (state.softness !== DEFAULT_SOFTNESS) {
      args.push("--softness", String(state.softness));
    }
    return args;
  }

  const args = [
    "--source-palette",
    state.pairs.map((pair) => pair.from).join(","),
    "--target-palette",
    state.pairs.map((pair) => pair.to).join(","),
  ];
  if (state.distance !== "rgb") args.push("--distance", state.distance);
  if (state.cleanup !== 0) args.push("--cleanup", String(state.cleanup));
  return args;
}

const SAFE_WORD = /^[A-Za-z0-9_\-.,/=:@+]+$/;

// Quote one argument for POSIX shells. Hex colors need quoting because a
// leading "#" starts a comment.
export function shellQuote(arg: string): string {
  if (SAFE_WORD.test(arg)) return arg;
  if (!/["$`\\!]/.test(arg)) return `"${arg}"`;
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

export function formatCommand(input: string, output: string, args: string[]): string {
  const words = [input, output, ...args].map(shellQuote);
  const lines = [`gifcc ${words[0]} ${words[1]}`];
  // One option (flag + value) per line, like the README examples.
  for (let i = 2; i < words.length; i++) {
    const word = words[i];
    const next = words[i + 1];
    if (word.startsWith("--") && next !== undefined && !next.startsWith("--")) {
      lines.push(`${word} ${next}`);
      i++;
    } else {
      lines.push(word);
    }
  }
  return lines.join(" \\\n  ");
}
