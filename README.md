# GIF Color Changer

Command line tool for replacing colors across every frame of a GIF.

**[Try it in your browser →](https://mpeyfuss.github.io/gif-color-changer/)** It runs the real CLI on [Pyodide](https://pyodide.org), so nothing is uploaded.

> [!NOTE]
> This works best on simple GIFs with flat colors, like logos, icons, pixel art and flat illustrations. Complex GIFs (photos, gradients, heavy dithering, many similar shades) may not work as well. Matching is by color, not position, so it's especially hard to target one specific area: every pixel that matches changes, wherever it is in the frame.

## Install

```bash
uv tool install gif-color-changer
```

Or with pipx:

```bash
pipx install gif-color-changer
```

Or run it once without installing:

```bash
uvx --from gif-color-changer gifcc input.gif output.gif --map "#FFFFFF=#FF0000"
```

From a local checkout:

```bash
uv tool install .
```

## Usage

```bash
gifcc input.gif output.gif \
  --map "#FFFFFF=#FF0000" \
  --map "#000000=#00FF00"
```

Each `--map` is:

```text
source_color=replacement_color
```

So this:

```bash
--map "#FFFFFF=#FF0000"
```

means:

```text
replace white with red
```

You can pass as many mappings as you need. They run in order, and a pixel is only changed once.

Alpha is not part of color matching. The tool only changes RGB values and preserves each pixel's original alpha value, including fully transparent pixels.

## Transparency

The replacement (right-hand) side of a mapping can be the keyword `transparent` (or `none`) instead of a hex color, which makes every matched pixel fully transparent:

```bash
gifcc input.gif output.gif \
  --map "#FFFFFF=transparent"
```

This knocks out a solid color, for example to drop a flat background. Matching is still RGB-only and respects `--tolerance`; only the right-hand side may be transparent. With `--softness`, pixels near the edge of the tolerance range fade out gradually (their alpha drops proportionally) instead of being cut out abruptly.

`transparent` also works as a target in palette mode (see below).

## Tolerance

GIF colors are often not exactly what they look like, especially after palette conversion or compression. Use `--tolerance` to match colors that are close to the source color.

```bash
gifcc input.gif output.gif \
  --map "#FFFFFF=#FF0000" \
  --tolerance 20
```

The default tolerance is `50`.

## Softness

Use `--softness` to blend pixels near the edge of the tolerance range instead of fully replacing every matched pixel.

```bash
gifcc input.gif output.gif \
  --map "#FFFFFF=#FF0000" \
  --tolerance 20 \
  --softness 8
```

With `--tolerance 20 --softness 8`, pixels within distance `12` of the source color are fully replaced. Pixels between `12` and `20` are blended proportionally from their original color toward the replacement color.

The default softness is `25`. Use `--softness 0` for hard replacement.

## Palette Rewrite Mode

Palette mode rewrites every pixel by mapping its RGB value to the nearest color in a source palette, then forcing it to the color at the same position in a target palette. Alpha values are preserved unchanged.

```bash
gifcc input.gif output.gif \
  --source-palette "#000000,#808080,#FFFFFF" \
  --target-palette "#1D3557,#E63946,#F1FAEE"
```

Both palettes must contain the same number of colors. The source and target palettes are matched by position, so the first source color maps to the first target color, the second source color maps to the second target color, and so on.

Any target palette entry may be `transparent` (or `none`) to make every pixel assigned to that bucket fully transparent, while still mapping the remaining buckets to colors:

```bash
gifcc input.gif output.gif \
  --source-palette "#000000,#808080,#FFFFFF" \
  --target-palette "#1D3557,#E63946,transparent"
```

Source palette colors must be hex; only the target side accepts `transparent`.

Palette mode cannot be combined with `--map`, `--tolerance`, or `--softness`.

By default, palette mode uses squared RGB distance. Use `--distance weighted-rgb` to weight channel differences by perceptual luminance:

```bash
gifcc input.gif output.gif \
  --source-palette "#000000,#808080,#FFFFFF" \
  --target-palette "#1D3557,#E63946,#F1FAEE" \
  --distance weighted-rgb
```

### Edge cleanup

Because each pixel is classified to its nearest palette color independently, antialiased or dithered pixels along an edge can land in a different bucket than the region around them, leaving isolated speckles of an unexpected color.

Use `--cleanup` to run one or more cleanup passes that reassign such pixels to the palette bucket that dominates their neighborhood:

```bash
gifcc input.gif output.gif \
  --source-palette "#000000,#808080,#FFFFFF" \
  --target-palette "#1D3557,#E63946,#F1FAEE" \
  --cleanup 2
```

Each pass reassigns a pixel whenever some *other* bucket occupies more of its 8-neighborhood than its own bucket does, snapping it to whichever neighbor color surrounds it most. This absorbs isolated speckles and the thin intermediate-color bands that form along antialiased edges, while pixels inside a solid region or on a real boundary are left intact, because their own side still dominates their neighborhood. More passes dissolve thicker bands but can also erode thin, legitimate detail.

Transparency is treated as just another region, so a pixel takes on the color *and* opacity of whatever surrounds it most. A stray opaque pixel sitting in transparent space becomes transparent, and a transparent hole inside a solid region fills in with that region's color. This also means a visible pixel bordering transparency is never recolored toward the hidden color of the transparent area around it.

`--cleanup` defaults to `0` (off) and is only valid in palette mode.

## Output

The script prints how many pixels were changed for each mapping:

```text
(255, 255, 255) -> (255, 0, 0): changed 1234 pixel(s)
```

In palette mode, it prints how many pixels were assigned to each source palette bucket:

```text
(0, 0, 0) -> (29, 53, 87): assigned 1234 pixel(s)
```

If a mapping says it changed `0` pixels, the source color probably does not exist in the GIF at that tolerance.

## Use with AI agents

- **Any agent:** point it at [`llms.txt`](https://mpeyfuss.github.io/gif-color-changer/llms.txt). It covers install steps, every flag and worked examples.
- **Claude Code:** install the skill in [`skills/gifcc/SKILL.md`](skills/gifcc/SKILL.md) and Claude will handle GIF recoloring requests on its own:

  ```bash
  mkdir -p ~/.claude/skills/gifcc && curl -fsSL \
    https://mpeyfuss.github.io/gif-color-changer/SKILL.md \
    -o ~/.claude/skills/gifcc/SKILL.md
  ```

## Uninstall

```bash
uv tool uninstall gif-color-changer
```

## Development

Set up the repo and install the git pre-commit hooks:

```bash
uv sync
make hooks
```

The hooks run [ruff](https://docs.astral.sh/ruff/) (lint + format) and
[pyrefly](https://pyrefly.org/) (type checking) on every commit. CI runs the
same hooks. To run them across the whole repo by hand:

```bash
make lint    # ruff check, ruff format, pyrefly
make check   # lint + tests
```

Run tests:

```bash
uv run pytest
```

Run tests against a specific Python version:

```bash
uv run --python 3.11 pytest
```

Or use the Makefile:

```bash
make test
make test-all
make test-3.11
```

Run the command without installing it as a tool:

```bash
uv run gifcc input.gif output.gif \
  --map "#FFFFFF=#FF0000"
```

### Browser playground

The playground in `site/` is a Vite + TypeScript app, managed with [Bun](https://bun.sh). On page load it installs the latest `gif-color-changer` release from PyPI into Pyodide inside a Web Worker, so publishing a new version updates the playground without a redeploy. Pushes to `main` that touch `site/` or `skills/` deploy it to GitHub Pages via `.github/workflows/pages.yml`.

```bash
make site        # dev server at http://localhost:5173/gif-color-changer/
make site-build  # test, build and preview the production bundle
```

## Build

```bash
uv build
```

That writes the package artifacts to `dist/`.

## Releasing

Publishing a GitHub Release uploads the package to PyPI via
`.github/workflows/release.yml` (PyPI Trusted Publishing, no API token).

1. Bump the version and push it to `main`:

   ```bash
   uv version --bump patch   # or minor / major
   git commit -am "bump version to $(uv version --short)"
   git push
   ```

2. On GitHub, draft a new Release with a tag `v<version>` that matches
   `pyproject.toml` (e.g. `v0.5.1`) and publish it.

3. CI runs the tests, checks the tag matches the version, builds, publishes to
   PyPI and attaches the wheel and sdist to the Release.
