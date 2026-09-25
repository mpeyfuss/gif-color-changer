// Messages between the page and the Pyodide worker.

// Keep in sync with the pyodide devDependency (used for types).
export const PYODIDE_VERSION = "314.0.7";

export type Request =
  | { type: "load"; bytes: Uint8Array }
  | { type: "run"; argv: string[] };

export type ToWorker = Request & { id: number };

export type FromWorker =
  | { type: "status"; text: string }
  | { type: "ready"; version: string }
  | { type: "fatal"; text: string }
  | { type: "loaded"; id: number; colors: string[] }
  | {
      type: "result";
      id: number;
      code: number;
      stdout: string;
      stderr: string;
      output?: Uint8Array;
      elapsedMs: number;
    };
