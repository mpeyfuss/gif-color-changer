import "./style.css";
import {
  buildArgs,
  type ColorPair,
  DEFAULT_SOFTNESS,
  DEFAULT_TOLERANCE,
  type Distance,
  type FormState,
  formatCommand,
  TRANSPARENT,
} from "./argv";
import { type FromWorker, PYODIDE_VERSION, type Request, type ToWorker } from "./protocol";

// ---------------------------------------------------------------- DOM helpers

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} missing`);
  return element as T;
}

const HEX = /^#?[0-9a-f]{6}$/i;

function normalizeHex(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (value === "") return value;
  return value.startsWith("#") ? value : `#${value}`;
}

// ---------------------------------------------------------------- state

const state = {
  mode: "map" as "map" | "palette",
  map: {
    pairs: [
      { from: "#FFFFFF", to: TRANSPARENT },
      { from: "#E63946", to: "#2A9D8F" },
    ] as ColorPair[],
    tolerance: DEFAULT_TOLERANCE,
    softness: DEFAULT_SOFTNESS,
  },
  palette: {
    pairs: [
      { from: "#FFFFFF", to: "#F1FAEE" },
      { from: "#E63946", to: "#2A9D8F" },
      { from: "#1D3557", to: "#264653" },
      { from: "#F4A261", to: "#E9C46A" },
    ] as ColorPair[],
    distance: "rgb" as Distance,
    cleanup: 0,
  },
  input: null as { name: string; bytes: Uint8Array } | null,
  inputLoaded: false,
  ready: false,
  running: false,
  detected: [] as string[],
  // The row whose source color the eyedropper and swatches fill in.
  selected: 0,
};

function formState(): FormState {
  return state.mode === "map"
    ? { mode: "map", ...state.map }
    : { mode: "palette", ...state.palette };
}

function activePairs(): ColorPair[] {
  return state[state.mode].pairs;
}

function inputName(): string {
  return state.input?.name ?? "input.gif";
}

function outputName(): string {
  return `${inputName().replace(/\.[^.]+$/, "")}-recolored.gif`;
}

// ---------------------------------------------------------------- worker

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const pending = new Map<number, (message: FromWorker) => void>();
let nextId = 1;

function request(message: Request): Promise<FromWorker> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ ...message, id } satisfies ToWorker);
  });
}

const statusEl = $("runtime-status");

function setStatus(stateName: "loading" | "ready" | "error", text: string) {
  statusEl.dataset.state = stateName;
  statusEl.querySelector(".status-text")!.textContent = text;
}

worker.onmessage = (event: MessageEvent<FromWorker>) => {
  const message = event.data;
  switch (message.type) {
    case "status":
      setStatus("loading", message.text);
      break;
    case "ready":
      state.ready = true;
      setStatus("ready", `Ready · gif-color-changer ${message.version}`);
      $("footer-versions").textContent =
        `gif-color-changer ${message.version} on Pyodide ${PYODIDE_VERSION}`;
      updateRunButton();
      break;
    case "fatal":
      setStatus("error", "Python failed to load. See the console for details.");
      console.error(message.text);
      break;
    default:
      pending.get(message.id)?.(message);
      pending.delete(message.id);
  }
};

// ---------------------------------------------------------------- input

const inputImg = $<HTMLImageElement>("input-img");
const pickCanvas = document.createElement("canvas");
let inputUrl: string | undefined;

async function setInput(name: string, bytes: Uint8Array) {
  state.input = { name, bytes };
  state.inputLoaded = false;
  updateRunButton();
  updateCommand();

  if (inputUrl) URL.revokeObjectURL(inputUrl);
  inputUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/gif" }));
  inputImg.src = inputUrl;
  inputImg.hidden = false;
  $("input-stage").classList.add("has-image");
  clearOutput();

  // The worker keeps its own copy; send a clone so ours stays usable.
  const reply = await request({ type: "load", bytes: bytes.slice() });
  if (state.input?.bytes !== bytes) return; // superseded by a newer input
  state.inputLoaded = true;
  if (reply.type === "loaded") renderDetected(reply.colors);
  updateRunButton();
}

inputImg.addEventListener("load", () => {
  // Snapshot the first frame so clicks can read pixel colors.
  pickCanvas.width = inputImg.naturalWidth;
  pickCanvas.height = inputImg.naturalHeight;
  pickCanvas.getContext("2d", { willReadFrequently: true })!.drawImage(inputImg, 0, 0);
  for (const img of [inputImg, $<HTMLImageElement>("output-img")]) {
    img.classList.toggle("pixelated", inputImg.naturalWidth < 240);
  }
});

inputImg.addEventListener("click", (event) => {
  // The image is letterboxed with object-fit: contain; map the click back to
  // image pixels.
  const rect = inputImg.getBoundingClientRect();
  const scale = Math.min(rect.width / inputImg.naturalWidth, rect.height / inputImg.naturalHeight);
  const offsetX = (rect.width - inputImg.naturalWidth * scale) / 2;
  const offsetY = (rect.height - inputImg.naturalHeight * scale) / 2;
  const x = Math.floor((event.clientX - rect.left - offsetX) / scale);
  const y = Math.floor((event.clientY - rect.top - offsetY) / scale);
  if (x < 0 || y < 0 || x >= inputImg.naturalWidth || y >= inputImg.naturalHeight) return;

  const [r, g, b, a] = pickCanvas.getContext("2d")!.getImageData(x, y, 1, 1).data;
  if (a === 0) return;
  const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  setSelectedSource(hex);
});

const fileInput = $<HTMLInputElement>("file-input");
const dropzone = $("dropzone");

async function loadFile(file: File) {
  await setInput(file.name, new Uint8Array(await file.arrayBuffer()));
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
});

for (const type of ["dragenter", "dragover"]) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
}
for (const type of ["dragleave", "drop"]) {
  dropzone.addEventListener(type, () => dropzone.classList.remove("dragging"));
}
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) void loadFile(file);
});

async function loadSample() {
  const response = await fetch(`${import.meta.env.BASE_URL}sample.gif`);
  await setInput("sample.gif", new Uint8Array(await response.arrayBuffer()));
}

$("use-sample").addEventListener("click", () => void loadSample());

// ---------------------------------------------------------------- detected colors

function renderDetected(colors: string[]) {
  state.detected = colors;
  const container = $("detected");
  container.replaceChildren(
    ...colors.map((hex) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "swatch";
      swatch.style.setProperty("--swatch", hex);
      swatch.title = hex;
      swatch.setAttribute("aria-label", `Use ${hex} as source color`);
      swatch.addEventListener("click", () => setSelectedSource(hex));
      return swatch;
    }),
  );
  $("detected-field").hidden = colors.length === 0;
  $<HTMLButtonElement>("palette-from-detected").disabled = colors.length === 0;
}

$("palette-from-detected").addEventListener("click", () => {
  const previous = state.palette.pairs;
  state.palette.pairs = state.detected.map((from, i) => ({
    from,
    to: previous[i]?.to ?? from,
  }));
  state.selected = 0;
  renderPairs();
  updateCommand();
});

function setSelectedSource(hex: string) {
  const pairs = activePairs();
  if (pairs.length === 0) pairs.push({ from: hex, to: hex });
  const index = Math.min(state.selected, pairs.length - 1);
  pairs[index].from = hex;
  renderPairs();
  updateCommand();
}

// ---------------------------------------------------------------- pair rows

const template = $<HTMLTemplateElement>("pair-template");

function renderPairs() {
  const containerId = state.mode === "map" ? "map-pairs" : "palette-pairs";
  const pairs = activePairs();
  state.selected = Math.min(state.selected, Math.max(pairs.length - 1, 0));

  $(containerId).replaceChildren(
    ...pairs.map((pair, index) => {
      const row = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
      const fromColor = row.querySelector<HTMLInputElement>(".from-color")!;
      const fromHex = row.querySelector<HTMLInputElement>(".from-hex")!;
      const toColor = row.querySelector<HTMLInputElement>(".to-color")!;
      const toHex = row.querySelector<HTMLInputElement>(".to-hex")!;
      const toClear = row.querySelector<HTMLInputElement>(".to-transparent")!;
      const remove = row.querySelector<HTMLButtonElement>(".remove")!;

      row.classList.toggle("selected", index === state.selected);
      // Remember the last real color so unticking "clear" restores it.
      let lastTo = pair.to === TRANSPARENT ? "#FFFFFF" : pair.to;

      const sync = () => {
        fromHex.value = pair.from;
        if (HEX.test(pair.from)) fromColor.value = normalizeHex(pair.from).toLowerCase();
        const clear = pair.to === TRANSPARENT;
        toClear.checked = clear;
        toHex.disabled = clear;
        toColor.disabled = clear;
        toHex.value = clear ? TRANSPARENT : pair.to;
        if (HEX.test(lastTo)) toColor.value = normalizeHex(lastTo).toLowerCase();
        row.classList.toggle("invalid-from", !HEX.test(pair.from));
        row.classList.toggle("invalid-to", !clear && !HEX.test(pair.to));
      };
      sync();

      const select = () => {
        if (state.selected === index) return;
        state.selected = index;
        for (const [i, el] of [...row.parentElement!.children].entries()) {
          el.classList.toggle("selected", i === index);
        }
      };
      row.addEventListener("focusin", select);
      row.addEventListener("pointerdown", select);

      fromColor.addEventListener("input", () => {
        pair.from = fromColor.value.toUpperCase();
        sync();
        updateCommand();
      });
      fromHex.addEventListener("input", () => {
        pair.from = normalizeHex(fromHex.value);
        if (HEX.test(pair.from)) fromColor.value = pair.from.toLowerCase();
        row.classList.toggle("invalid-from", !HEX.test(pair.from));
        updateCommand();
      });
      fromHex.addEventListener("blur", sync);
      toColor.addEventListener("input", () => {
        pair.to = lastTo = toColor.value.toUpperCase();
        sync();
        updateCommand();
      });
      toHex.addEventListener("input", () => {
        const typed = toHex.value.trim().toLowerCase();
        pair.to = typed === TRANSPARENT || typed === "none" ? TRANSPARENT : normalizeHex(toHex.value);
        if (pair.to === TRANSPARENT) {
          sync();
          updateCommand();
          return;
        }
        if (HEX.test(pair.to)) {
          lastTo = pair.to;
          toColor.value = pair.to.toLowerCase();
        }
        row.classList.toggle("invalid-to", !HEX.test(pair.to));
        updateCommand();
      });
      toHex.addEventListener("blur", sync);
      toClear.addEventListener("change", () => {
        pair.to = toClear.checked ? TRANSPARENT : lastTo;
        sync();
        updateCommand();
      });
      remove.disabled = pairs.length === 1;
      remove.addEventListener("click", () => {
        pairs.splice(index, 1);
        if (state.selected >= index) state.selected = Math.max(state.selected - 1, 0);
        renderPairs();
        updateCommand();
      });
      return row;
    }),
  );
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-add]")) {
  button.addEventListener("click", () => {
    const pairs = state[button.dataset.add as "map" | "palette"].pairs;
    const from = state.detected.find((hex) => !pairs.some((pair) => pair.from === hex)) ?? "#000000";
    pairs.push({ from, to: "#FFFFFF" });
    state.selected = pairs.length - 1;
    renderPairs();
    updateCommand();
  });
}

// ---------------------------------------------------------------- mode + options

function setMode(mode: "map" | "palette") {
  state.mode = mode;
  state.selected = 0;
  for (const name of ["map", "palette"] as const) {
    $(`tab-${name}`).setAttribute("aria-selected", String(name === mode));
    $(`panel-${name}`).hidden = name !== mode;
  }
  renderPairs();
  updateCommand();
}

$("tab-map").addEventListener("click", () => setMode("map"));
$("tab-palette").addEventListener("click", () => setMode("palette"));

function bindSlider(id: "tolerance" | "softness") {
  const input = $<HTMLInputElement>(id);
  const output = $<HTMLOutputElement>(`${id}-out`);
  const update = () => {
    state.map[id] = Number(input.value);
    output.value = input.value;
    updateCommand();
  };
  input.addEventListener("input", update);
  output.value = input.value;
}
bindSlider("tolerance");
bindSlider("softness");

$<HTMLSelectElement>("distance").addEventListener("change", (event) => {
  state.palette.distance = (event.target as HTMLSelectElement).value as Distance;
  updateCommand();
});
$<HTMLInputElement>("cleanup").addEventListener("input", (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  state.palette.cleanup = Number.isInteger(value) ? value : 0;
  updateCommand();
});

function updateCommand() {
  $("command").textContent = formatCommand(inputName(), outputName(), buildArgs(formState()));
}

// ---------------------------------------------------------------- run

const runButton = $<HTMLButtonElement>("run");
const outputImg = $<HTMLImageElement>("output-img");
const download = $<HTMLAnchorElement>("download");
const log = $<HTMLPreElement>("log");
let outputUrl: string | undefined;

function updateRunButton() {
  runButton.disabled = !state.ready || !state.inputLoaded || state.running;
  runButton.textContent = state.running
    ? "Running…"
    : !state.ready
      ? "Waiting for Python…"
      : "Run";
}

function clearOutput() {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = undefined;
  outputImg.hidden = true;
  outputImg.removeAttribute("src");
  $("output-stage").classList.remove("has-image");
  download.hidden = true;
  log.hidden = true;
}

async function run() {
  if (runButton.disabled) return;
  state.running = true;
  updateRunButton();

  const reply = await request({ type: "run", argv: buildArgs(formState()) });
  state.running = false;
  updateRunButton();
  if (reply.type !== "result") return;

  clearOutput();
  const seconds = (reply.elapsedMs / 1000).toFixed(1);
  if (reply.output) {
    outputUrl = URL.createObjectURL(new Blob([reply.output as BlobPart], { type: "image/gif" }));
    outputImg.src = outputUrl;
    outputImg.hidden = false;
    $("output-stage").classList.add("has-image");
    download.href = outputUrl;
    download.download = outputName();
    download.hidden = false;
    const stdout = reply.stdout.trim().replace("/work/out.gif", outputName());
    log.textContent = `${stdout}\n(${seconds}s in the browser)`;
    log.classList.remove("error");
  } else {
    // parser.error prints the whole usage block; the last line is the useful bit.
    const lines = reply.stderr.trim().split("\n");
    log.textContent = lines.filter((line) => line.startsWith("gifcc: error")).join("\n") || lines.join("\n");
    log.classList.add("error");
  }
  log.hidden = false;
}

runButton.addEventListener("click", () => void run());
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void run();
});

// ---------------------------------------------------------------- copy buttons

for (const button of document.querySelectorAll<HTMLButtonElement>("button.copy")) {
  button.addEventListener("click", async () => {
    const source = button.dataset.copyFrom
      ? $(button.dataset.copyFrom)
      : button.parentElement!.querySelector("code")!;
    try {
      await navigator.clipboard.writeText(source.textContent ?? "");
      button.textContent = "Copied";
    } catch {
      button.textContent = "Press ⌘C";
      getSelection()?.selectAllChildren(source);
    }
    setTimeout(() => (button.textContent = "Copy"), 1500);
  });
}

// ---------------------------------------------------------------- start

renderPairs();
updateCommand();
updateRunButton();
void loadSample();
