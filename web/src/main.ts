import "./style.css";

import * as Comlink from "comlink";

import type { Job, WorkerApi } from "./worker";

type Mode = "map" | "palette";
type Row = { source: string; target: string; transparent: boolean };

const RUN_DELAY_MS = 200;
const HINTS: Record<Mode, string> = {
  map: "Each source color is replaced wherever a pixel is within the tolerance. Click a row, then click the original to pick its color.",
  palette: "Every pixel snaps to its nearest source color and takes that color's replacement. Good for full recolors.",
};

const state = {
  mode: "map" as Mode,
  rows: {
    map: [{ source: "#ffffff", target: "#ff0000", transparent: false }] as Row[],
    palette: [
      { source: "#000000", target: "#1d3557", transparent: false },
      { source: "#808080", target: "#e63946", transparent: false },
      { source: "#ffffff", target: "#f1faee", transparent: false },
    ] as Row[],
  },
  // Which row the eyedropper fills, per mode.
  activeRow: { map: 0, palette: 0 } as Record<Mode, number>,
  fileName: "",
  loaded: false,
  latestJob: 0,
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>("file-input");
const dropzone = $<HTMLLabelElement>("dropzone");
const dropzoneText = $<HTMLSpanElement>("dropzone-text");
const modeHint = $<HTMLParagraphElement>("mode-hint");
const rowsEl = $<HTMLDivElement>("rows");
const rowTemplate = $<HTMLTemplateElement>("row-template");
const original = $<HTMLImageElement>("original");
const result = $<HTMLImageElement>("result");
const statusText = $<HTMLElement>("status");
const errorText = $<HTMLParagraphElement>("error");
const summary = $<HTMLUListElement>("summary");
const download = $<HTMLAnchorElement>("download");
const tolerance = $<HTMLInputElement>("tolerance");
const softness = $<HTMLInputElement>("softness");
const distance = $<HTMLSelectElement>("distance");
const cleanup = $<HTMLInputElement>("cleanup");

const worker = Comlink.wrap<WorkerApi>(
  new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

function replaceUrl(img: HTMLImageElement | HTMLAnchorElement, url: string) {
  const previous = img instanceof HTMLImageElement ? img.src : img.href;
  if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
  if (img instanceof HTMLImageElement) img.src = url;
  else img.href = url;
}

function renderRows() {
  const rows = state.rows[state.mode];
  rowsEl.replaceChildren(
    ...rows.map((row, index) => {
      const el = rowTemplate.content.firstElementChild!.cloneNode(true) as HTMLDivElement;
      const source = el.querySelector<HTMLInputElement>(".source")!;
      const target = el.querySelector<HTMLInputElement>(".target")!;
      const transparent = el.querySelector<HTMLInputElement>(".transparent input")!;
      const remove = el.querySelector<HTMLButtonElement>(".remove")!;

      el.classList.toggle("active", index === state.activeRow[state.mode]);
      source.value = row.source;
      target.value = row.target;
      target.disabled = row.transparent;
      transparent.checked = row.transparent;
      remove.disabled = rows.length === 1;

      el.addEventListener("pointerdown", () => {
        if (state.activeRow[state.mode] === index) return;
        state.activeRow[state.mode] = index;
        rowsEl.querySelectorAll(".row").forEach((r, i) => r.classList.toggle("active", i === index));
      });
      source.addEventListener("input", () => {
        row.source = source.value;
        scheduleRun();
      });
      target.addEventListener("input", () => {
        row.target = target.value;
        scheduleRun();
      });
      transparent.addEventListener("change", () => {
        row.transparent = transparent.checked;
        target.disabled = row.transparent;
        scheduleRun();
      });
      remove.addEventListener("click", () => {
        rows.splice(index, 1);
        state.activeRow[state.mode] = Math.min(state.activeRow[state.mode], rows.length - 1);
        renderRows();
        scheduleRun();
      });
      return el;
    }),
  );
}

function setMode(mode: Mode) {
  state.mode = mode;
  document.querySelectorAll<HTMLButtonElement>("[role=tab]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.mode === mode));
  });
  document.querySelectorAll<HTMLElement>(".settings").forEach((el) => {
    el.hidden = el.dataset.for !== mode;
  });
  modeHint.textContent = HINTS[mode];
  renderRows();
  scheduleRun();
}

function currentJob(): Job {
  const rows = state.rows[state.mode];
  const target = (row: Row) => (row.transparent ? "transparent" : row.target);
  if (state.mode === "map") {
    return {
      mode: "map",
      mappings: rows.map((row) => `${row.source}=${target(row)}`),
      tolerance: tolerance.valueAsNumber,
      softness: softness.valueAsNumber,
    };
  }
  return {
    mode: "palette",
    source: rows.map((row) => row.source).join(","),
    target: rows.map(target).join(","),
    distance: distance.value,
    cleanup: cleanup.valueAsNumber,
  };
}

let runTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleRun() {
  clearTimeout(runTimer);
  if (state.loaded) runTimer = setTimeout(run, RUN_DELAY_MS);
}

async function run() {
  const id = ++state.latestJob;
  statusText.textContent = "processing…";
  try {
    const output = await worker.run(currentJob());
    if (id !== state.latestJob) return;

    const url = URL.createObjectURL(new Blob([output.bytes as Uint8Array<ArrayBuffer>], { type: "image/gif" }));
    replaceUrl(result, url);
    replaceUrl(download, url);
    download.download = state.fileName.replace(/\.gif$/i, "") + "-recolored.gif";
    download.hidden = false;
    errorText.textContent = "";
    summary.replaceChildren(
      ...output.lines.map((line) => Object.assign(document.createElement("li"), { textContent: line })),
    );
    statusText.textContent = `${Math.round(output.ms)} ms`;
  } catch (error) {
    if (id !== state.latestJob) return;
    errorText.textContent = error instanceof Error ? error.message : String(error);
    statusText.textContent = "";
  }
}

async function loadFile(file: File) {
  state.loaded = false;
  state.fileName = file.name;
  errorText.textContent = "";
  summary.replaceChildren();
  download.hidden = true;
  replaceUrl(result, "");
  try {
    const bytes = await file.arrayBuffer();
    replaceUrl(original, URL.createObjectURL(file));
    const info = await worker.load(Comlink.transfer(bytes, [bytes]));
    dropzoneText.textContent = `${file.name} · ${info.width}×${info.height} · ${info.frames} frame${info.frames === 1 ? "" : "s"}`;
    state.loaded = true;
    run();
  } catch (error) {
    replaceUrl(original, "");
    dropzoneText.textContent = "Drop a GIF here or click to choose one";
    errorText.textContent = error instanceof Error ? error.message : String(error);
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  const file = event.dataTransfer?.files[0];
  if (file) loadFile(file);
});

original.addEventListener("click", async (event) => {
  if (!state.loaded) return;
  const rect = original.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * original.naturalWidth;
  const y = ((event.clientY - rect.top) / rect.height) * original.naturalHeight;
  const row = state.rows[state.mode][state.activeRow[state.mode]];
  if (!row) return;
  row.source = await worker.pick(x, y);
  renderRows();
  scheduleRun();
});

document.querySelectorAll<HTMLButtonElement>("[role=tab]").forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode as Mode));
});

$<HTMLButtonElement>("add-row").addEventListener("click", () => {
  const rows = state.rows[state.mode];
  rows.push({ source: "#000000", target: "#ffffff", transparent: false });
  state.activeRow[state.mode] = rows.length - 1;
  renderRows();
  scheduleRun();
});

for (const [input, id] of [
  [tolerance, "tolerance-value"],
  [softness, "softness-value"],
  [cleanup, "cleanup-value"],
] as const) {
  const output = $<HTMLOutputElement>(id);
  const sync = () => (output.textContent = input.value);
  sync();
  input.addEventListener("input", () => {
    sync();
    scheduleRun();
  });
}
distance.addEventListener("change", scheduleRun);

setMode("map");
