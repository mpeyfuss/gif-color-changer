// Runs the real gifcc CLI inside Pyodide, off the main thread.
import type { PyodideAPI } from "pyodide";
import { type FromWorker, PYODIDE_VERSION, type ToWorker } from "./protocol";

// Load the loader from the same CDN folder as the runtime it fetches, so the
// two can't drift apart. The npm package only supplies types.
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const PACKAGE = "gif-color-changer";

const PYTHON_HELPERS = `
import contextlib
import io
import sys
from importlib.metadata import version

from PIL import Image

from gif_color_changer.cli import main

PACKAGE_VERSION = version("${PACKAGE}")


def run_cli(argv):
    out, err = io.StringIO(), io.StringIO()
    code = 0
    # Pass arguments through sys.argv rather than main(argv) so this works with
    # every released version of the CLI.
    sys.argv = ["gifcc", "/work/in.gif", "/work/out.gif", *argv]
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            main()
        except SystemExit as exc:
            code = exc.code if isinstance(exc.code, int) else 1
        except Exception as exc:
            print(f"gifcc: error: {exc}", file=sys.stderr)
            code = 1
    return code, out.getvalue(), err.getvalue()


def top_colors(limit=12, min_distance=40):
    """Most common visible colors in the first frame, skipping near-duplicates
    (antialiasing produces many shades of each real color)."""
    with Image.open("/work/in.gif") as image:
        rgba = image.convert("RGBA")
    counts = rgba.getcolors(maxcolors=rgba.width * rgba.height) or []
    picked = []
    for _, (r, g, b, a) in sorted(counts, reverse=True):
        if a == 0:
            continue
        if all(
            (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2 >= min_distance**2
            for pr, pg, pb in picked
        ):
            picked.append((r, g, b))
            if len(picked) == limit:
                break
    return [f"#{r:02X}{g:02X}{b:02X}" for r, g, b in picked]
`;

function post(message: FromWorker, transfer: Transferable[] = []) {
  postMessage(message, { transfer });
}

async function boot(): Promise<PyodideAPI> {
  post({ type: "status", text: "Downloading Python…" });
  const { loadPyodide } = (await import(
    /* @vite-ignore */ `${INDEX_URL}pyodide.mjs`
  )) as typeof import("pyodide");
  const pyodide = await loadPyodide({ indexURL: INDEX_URL });

  post({ type: "status", text: "Loading numpy and Pillow…" });
  await pyodide.loadPackage(["micropip", "numpy", "pillow"]);

  // Always the latest release on PyPI, so new versions reach the playground
  // without redeploying the site.
  post({ type: "status", text: `Installing ${PACKAGE} from PyPI…` });
  const micropip = pyodide.pyimport("micropip");
  await micropip.install(PACKAGE);

  pyodide.FS.mkdirTree("/work");
  await pyodide.runPythonAsync(PYTHON_HELPERS);
  post({ type: "ready", version: pyodide.globals.get("PACKAGE_VERSION") });
  return pyodide;
}

const ready = boot();
ready.catch((error: unknown) => post({ type: "fatal", text: String(error) }));

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  const pyodide = await ready;

  if (message.type === "load") {
    pyodide.FS.writeFile("/work/in.gif", message.bytes);
    let colors: string[] = [];
    try {
      const result = pyodide.globals.get("top_colors")();
      colors = result.toJs();
      result.destroy();
    } catch {
      // Not an image Pillow can read; the run will report the real error.
    }
    post({ type: "loaded", id: message.id, colors });
    return;
  }

  if (pyodide.FS.analyzePath("/work/out.gif").exists) {
    pyodide.FS.unlink("/work/out.gif");
  }
  const started = performance.now();
  const result = pyodide.globals.get("run_cli")(pyodide.toPy(message.argv));
  const [code, stdout, stderr] = result.toJs() as [number, string, string];
  result.destroy();
  const elapsedMs = performance.now() - started;

  const output =
    code === 0 && pyodide.FS.analyzePath("/work/out.gif").exists
      ? pyodide.FS.readFile("/work/out.gif")
      : undefined;
  post(
    { type: "result", id: message.id, code, stdout, stderr, output, elapsedMs },
    output ? [output.buffer] : [],
  );
};
