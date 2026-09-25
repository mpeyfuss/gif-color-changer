---
name: gifcc
description: Recolor animated GIFs with the gifcc CLI (gif-color-changer). Use when the user wants to change, swap, or replace colors in a GIF, recolor or re-theme an animation, map a GIF onto a new palette, or make a GIF's background (or any solid color) transparent.
---

# gifcc: recolor GIFs

`gifcc` replaces colors across every frame of a GIF. It keeps frame timing, looping and each pixel's alpha. Colors are matched by RGB only.

**Know its limits before promising results.** It works best on simple GIFs with flat colors, like logos, icons, pixel art and flat illustrations. Complex GIFs (photos, gradients, heavy dithering, many similar shades) may not work as well. Matching is by color, not position, so it can't target one specific area. If the user wants to recolor only part of the image (say, one character's shirt) and that color also appears elsewhere, every matching pixel will change. Tell the user about this up front rather than after a disappointing run.

## 1. Make sure it's installed

Install and run it with [uv](https://docs.astral.sh/uv/). Don't use pip or pipx. uv puts the tool in its own isolated environment and downloads a suitable Python (3.11 or newer) if needed, so no system Python is required.

```bash
command -v uv || curl -LsSf https://astral.sh/uv/install.sh | sh   # tell the user if you install uv
command -v gifcc || uv tool install gif-color-changer
```

- If `gifcc` isn't on `PATH` right after installing, run `uv tool update-shell` and open a new shell, or call it through `uvx` (below).
- To run it once without installing: `uvx --from gif-color-changer gifcc ...`
- To upgrade: `uv tool upgrade gif-color-changer`

## 2. Find the colors that are actually in the GIF

Don't guess hex values. GIF colors are often slightly off from what they look like. List the most common colors in the first frame:

```bash
uvx --with pillow python -c '
import sys; from PIL import Image
im = Image.open(sys.argv[1]).convert("RGBA")
for n, (r, g, b, a) in sorted(im.getcolors(im.width * im.height), reverse=True)[:12]:
    if a: print(f"#{r:02X}{g:02X}{b:02X}  {n} px")
' input.gif
```

Antialiased edges show up as many near-duplicate shades. The top few distinct colors are the real ones.

## 3. Pick a mode

**Map mode** replaces specific colors and leaves everything else untouched:

```bash
gifcc input.gif output.gif \
  --map "#FFFFFF=#FF0000" \
  --map "#000000=#00FF00"
```

- `--map FROM=TO` can be repeated. Mappings run in order, and each pixel changes at most once.
- `TO` may be `transparent` (or `none`) to knock a color out, for example `--map "#FFFFFF=transparent"` to remove a flat background.
- `--tolerance N` (default 50) is the RGB distance within which a pixel counts as `FROM`. Lower it if unrelated colors change. Raise it if edges are missed.
- `--softness N` (default 25) blends pixels in the outer `N` of the tolerance band, which gives smooth antialiased edges. `--softness 0` makes a hard cut.

**Palette mode** remaps every pixel to a new palette:

```bash
gifcc input.gif output.gif \
  --source-palette "#000000,#808080,#FFFFFF" \
  --target-palette "#1D3557,#E63946,#F1FAEE" \
  --cleanup 2
```

- Each pixel snaps to its nearest source color and then takes the target color at the same position. Both lists must be the same length.
- Target entries may be `transparent`. Source entries must be hex.
- `--distance rgb|weighted-rgb` (default `rgb`). `weighted-rgb` weights channels by perceived luminance.
- `--cleanup N` (default 0) runs passes that absorb stray speckles and antialiasing bands into the surrounding region. Use 1–2. More passes can erode thin details.

Rules: you can't combine `--map` with the palette flags. `--tolerance` and `--softness` are for map mode only. `--distance` and `--cleanup` are for palette mode only. Always quote hex values, because an unquoted `#` starts a shell comment.

## 4. Check the result

`gifcc` prints one line per mapping or palette entry:

```text
(255, 255, 255) -> (255, 0, 0): changed 1234 pixel(s)
```

- `changed 0 pixel(s)` means the source color isn't in the GIF at that tolerance. Re-check the colors from step 2, or raise `--tolerance`.
- A huge count on a mapping you meant to be narrow means the tolerance is too high.
- If there are halos around knocked-out or recolored shapes, raise `--softness` in map mode, or add `--cleanup 1` or `--cleanup 2` in palette mode.

Tell the user where the output file is. If you can, show it or describe what changed. There's an interactive playground at https://mpeyfuss.github.io/gif-color-changer/ if they want to experiment visually.
