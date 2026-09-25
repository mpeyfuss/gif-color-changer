/// <reference lib="webworker" />
// Runs the WebAssembly core off the main thread so the page stays responsive
// while large GIFs are processed.

import init, { recolor, rewritePalette } from "./wasm/gifcc_wasm.js";
import type { WorkerRequest, WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const ready = init();
let input: Uint8Array | null = null;

function reply(response: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(response, transfer);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "load") {
    input = new Uint8Array(request.bytes);
    return;
  }

  const { id, job } = request;
  try {
    await ready;
    if (!input) throw new Error("Choose a GIF first");

    const started = performance.now();
    const output =
      job.mode === "map"
        ? recolor(input, job.mappings, job.tolerance, job.softness)
        : rewritePalette(input, job.source, job.target, job.distance, job.cleanup);
    const ms = performance.now() - started;

    const bytes = new Uint8Array(output.bytes);
    const result = {
      id,
      ok: true as const,
      bytes,
      lines: output.lines,
      frames: output.frames,
      width: output.width,
      height: output.height,
      ms,
    };
    output.free();
    reply(result, [bytes.buffer]);
  } catch (error) {
    reply({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
