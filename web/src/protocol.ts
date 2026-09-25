export type Job =
  | { mode: "map"; mappings: string[]; tolerance: number; softness: number }
  | { mode: "palette"; source: string; target: string; distance: string; cleanup: number };

export type WorkerRequest =
  | { type: "load"; bytes: ArrayBuffer }
  | { type: "run"; id: number; job: Job };

export type WorkerResponse =
  | {
      id: number;
      ok: true;
      bytes: Uint8Array<ArrayBuffer>;
      lines: string[];
      frames: number;
      width: number;
      height: number;
      ms: number;
    }
  | { id: number; ok: false; error: string };
