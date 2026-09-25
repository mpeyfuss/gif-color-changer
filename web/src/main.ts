import "./style.css";
import type { Job, WorkerRequest, WorkerResponse } from "./protocol";

type Mode = "map" | "palette";
type Row = { source: string; target: string; transparent: boolean };

const HEX = /^#?([0-9a-f]{6})$/i;
const RUN_DELAY_MS = 250;

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
  activeRow: { map: 0, palette: 0 },
  fileName: "",
  loaded: false,
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>("file-input");
const dropzone = $<HTMLLabelElement>("dropzone");
const original = $<HTMLImageElement>("original");
const result = $<HTMLImageElement>("result");
const statusText = $<HTMLSpanElement>("status");
const errorText = $<HTMLParagraphElement>("error");
const summary = $<HTMLUListElement>("summary");
const download = $<HTMLAnchorElement>("download");
const tolerance = $<HTMLInputElement>("tolerance");
const softness = $<HTMLInputElement>("softness");
const distance = $<HTMLSelectElement>("distance");
const cleanup = $<HTMLInputElement>("cleanup");
const rowTemplate = $<HTMLTemplateElement>("row-template");

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const post = (request: WorkerRequest, transfer: Transferable[] = []) =>
  worker.postMessage(request, transfer);

// --- Running jobs -----------------------------------------------------------

let latestId = 0;
let runTimer: number | undefined;
let resultUrl: string | undefined;

function normalizeHex(value: string): string | null {
  const match = HEX.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

function buildJob(): Job {
  const rows = state.rows[state.mode];
  const target = (row: Row) => (row.transparent ? "transparent" : row.target);
  if (state.mode === "map") {
    return {
      mode: "map",
      mappings: rows.map((row) => `${row.source}=${target(row)}`),
      tolerance: Number(tolerance.value),
      softness: Number(softness.value),
    };
  }
  return {
    mode: "palette",
    source: rows.map((row) => row.source).join(","),
    target: rows.map(target).join(","),
    distance: distance.value,
    cleanup: Math.max(0, Math.floor(Number(cleanup.value) || 0)),
  };
}

function scheduleRun() {
  if (!state.loaded) return;
  window.clearTimeout(runTimer);
  runTimer = window.setTimeout(() => {
    latestId += 1;
    statusText.textContent = "Processing…";
    post({ type: "run", id: latestId, job: buildJob() });
  }, RUN_DELAY_MS);
}

worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
  const response = event.data;
  // A newer job is already queued or running; drop stale results.
  if (response.id !== latestId) return;

  if (!response.ok) {
    statusText.textContent = "";
    errorText.textContent = response.error;
    errorText.hidden = false;
    return;
  }

  errorText.hidden = true;
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = URL.createObjectURL(new Blob([response.bytes], { type: "image/gif" }));
  result.src = resultUrl;
  result.hidden = false;
  $("result-empty").hidden = true;

  download.href = resultUrl;
  download.download = `${state.fileName.replace(/\.gif$/i, "") || "output"}-recolored.gif`;
  download.hidden = false;

  const size = `${(response.bytes.byteLength / 1024).toFixed(0)} KB`;
  statusText.textContent = `${response.frames} frame${response.frames === 1 ? "" : "s"} · ${response.width}×${response.height} · ${size} · ${Math.round(response.ms)} ms`;
  summary.replaceChildren(
    ...response.lines.map((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      return item;
    }),
  );
};

worker.onerror = (event) => {
  statusText.textContent = "";
  errorText.textContent = `Worker failed: ${event.message}`;
  errorText.hidden = false;
};

// --- Loading a GIF ----------------------------------------------------------

let originalUrl: string | undefined;

async function loadFile(file: File) {
  if (file.type && file.type !== "image/gif") {
    errorText.textContent = `${file.name} isn't a GIF`;
    errorText.hidden = false;
    return;
  }

  state.fileName = file.name;
  state.loaded = true;
  $("dropzone-title").textContent = file.name;
  $("dropzone-detail").textContent = `${(file.size / 1024).toFixed(0)} KB · click or drop to replace`;

  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = URL.createObjectURL(file);
  original.src = originalUrl;
  original.hidden = false;
  $("original-empty").hidden = true;
  $("pick-hint").hidden = false;

  const bytes = await file.arrayBuffer();
  post({ type: "load", bytes }, [bytes]);
  scheduleRun();
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

// --- Eyedropper: click the original to set the active row's source ---------

const pickCanvas = document.createElement("canvas");

original.addEventListener("click", (event) => {
  const rect = original.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * original.naturalWidth);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * original.naturalHeight);
  pickCanvas.width = original.naturalWidth;
  pickCanvas.height = original.naturalHeight;
  const context = pickCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.drawImage(original, 0, 0);
  const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
  if (a === 0) return;

  const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  const rows = state.rows[state.mode];
  const index = Math.min(state.activeRow[state.mode], rows.length - 1);
  rows[index].source = hex;
  renderRows(state.mode);
  scheduleRun();
});

// --- Color rows -------------------------------------------------------------

function renderRows(mode: Mode) {
  const container = $(`${mode}-rows`);
  const rows = state.rows[mode];

  container.replaceChildren(
    ...rows.map((row, index) => {
      const element = rowTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
      const part = <T extends HTMLElement>(selector: string) =>
        element.querySelector(selector) as T;
      const sourceColor = part<HTMLInputElement>(".source-color");
      const sourceHex = part<HTMLInputElement>(".source-hex");
      const targetColor = part<HTMLInputElement>(".target-color");
      const targetHex = part<HTMLInputElement>(".target-hex");
      const transparent = part<HTMLInputElement>(".transparent");
      const remove = part<HTMLButtonElement>(".remove");

      element.classList.toggle("active", index === state.activeRow[mode]);
      sourceColor.value = sourceHex.value = row.source;
      targetColor.value = targetHex.value = row.target;
      transparent.checked = row.transparent;
      targetColor.disabled = targetHex.disabled = row.transparent;
      remove.disabled = rows.length === 1;

      element.addEventListener("focusin", () => {
        state.activeRow[mode] = index;
        container.querySelectorAll(".row").forEach((r, i) => r.classList.toggle("active", i === index));
      });

      const bind = (key: "source" | "target", color: HTMLInputElement, hex: HTMLInputElement) => {
        color.addEventListener("input", () => {
          row[key] = hex.value = color.value;
          hex.classList.remove("invalid");
          scheduleRun();
        });
        hex.addEventListener("input", () => {
          const value = normalizeHex(hex.value);
          hex.classList.toggle("invalid", value === null);
          if (value === null) return;
          row[key] = color.value = value;
          scheduleRun();
        });
        hex.addEventListener("blur", () => {
          hex.value = row[key];
          hex.classList.remove("invalid");
        });
      };
      bind("source", sourceColor, sourceHex);
      bind("target", targetColor, targetHex);

      transparent.addEventListener("change", () => {
        row.transparent = transparent.checked;
        targetColor.disabled = targetHex.disabled = row.transparent;
        scheduleRun();
      });

      remove.addEventListener("click", () => {
        rows.splice(index, 1);
        state.activeRow[mode] = Math.min(state.activeRow[mode], rows.length - 1);
        renderRows(mode);
        scheduleRun();
      });

      return element;
    }),
  );
}

function addRow(mode: Mode) {
  const rows = state.rows[mode];
  rows.push({ source: "#000000", target: "#ffffff", transparent: false });
  state.activeRow[mode] = rows.length - 1;
  renderRows(mode);
  scheduleRun();
}

$("add-map-row").addEventListener("click", () => addRow("map"));
$("add-palette-row").addEventListener("click", () => addRow("palette"));

// --- Tabs and options -------------------------------------------------------

function setMode(mode: Mode) {
  state.mode = mode;
  for (const name of ["map", "palette"] as const) {
    $(`tab-${name}`).setAttribute("aria-selected", String(name === mode));
    $(`panel-${name}`).hidden = name !== mode;
  }
  scheduleRun();
}

$("tab-map").addEventListener("click", () => setMode("map"));
$("tab-palette").addEventListener("click", () => setMode("palette"));

for (const [input, output] of [
  [tolerance, $("tolerance-value")],
  [softness, $("softness-value")],
] as const) {
  input.addEventListener("input", () => {
    output.textContent = input.value;
    scheduleRun();
  });
}
distance.addEventListener("change", scheduleRun);
cleanup.addEventListener("input", scheduleRun);

renderRows("map");
renderRows("palette");
