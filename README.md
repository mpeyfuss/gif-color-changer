# GIF Color Changer

Replace colors across every frame of a GIF, from the command line or in your browser.

## Install

### Web app

**https://mpeyfuss.github.io/gif-color-changer/**

Everything runs locally in your browser via WebAssembly. Your GIF is never uploaded anywhere. Click the original preview to pick a source color from it.

### Command line

Prebuilt binaries for macOS, Linux, and Windows are attached to each [GitHub release](https://github.com/mpeyfuss/gif-color-changer/releases).

macOS / Linux:

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/mpeyfuss/gif-color-changer/releases/latest/download/gif-color-changer-installer.sh | sh
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://github.com/mpeyfuss/gif-color-changer/releases/latest/download/gif-color-changer-installer.ps1 | iex"
```

From source (requires Rust):

```bash
cargo install --git https://github.com/mpeyfuss/gif-color-changer gif-color-changer
```

> The Python package on PyPI (`uv tool install gif-color-changer`) is deprecated as of 1.0.0 and will not receive updates. Remove it with `uv tool uninstall gif-color-changer`.

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

GIF transparency is all-or-nothing, so when the output is saved, pixels that are less than 50% opaque become fully transparent and the rest become fully opaque. A `--softness` fade toward `transparent` therefore ends in a hard edge halfway through the softness band.

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

## Development

The project is a Rust workspace:

- `crates/gifcc-core`: color matching, palette rewrite, edge cleanup, and GIF decoding/encoding
- `crates/gifcc-cli`: the `gifcc` binary (package `gif-color-changer`)
- `crates/gifcc-wasm`: WebAssembly bindings used by the web app
- `web/`: the Vite + TypeScript web app (uses [Bun](https://bun.sh))

Run the tests and lints:

```bash
make test
make lint
```

Run the CLI without installing it:

```bash
cargo run -p gif-color-changer -- input.gif output.gif --map "#FFFFFF=#FF0000"
```

`crates/gifcc-core/tests/fixtures` holds golden output captured from the original Python implementation. `cargo test` checks that the Rust port reproduces it byte for byte.

### Web app

One-time setup:

```bash
rustup target add wasm32-unknown-unknown
# Must match the wasm-bindgen version in Cargo.lock
cargo install wasm-bindgen-cli --version 0.2.128 --locked
```

Then:

```bash
make web-dev   # build the WebAssembly module and start the Vite dev server
make web       # production build into web/dist
```

## Releasing

1. Bump `version` under `[workspace.package]` in `Cargo.toml`.
2. Tag the commit (`git tag v1.0.0`) and push the tag. The release workflow builds binaries and installers for every platform and publishes a GitHub release.

Every push to `main` deploys the web app to GitHub Pages. In the repository settings, set Pages → Source to "GitHub Actions" once.
