# GIF Color Changer

Small script for replacing colors in a GIF. It takes one or more color mappings, applies them to every frame, and writes a new GIF.

## Setup

```bash
uv sync
```

## Usage

```bash
uv run python main.py input.gif output.gif \
  --map "#FFFFFF=#FF0000" \
  --map "#000000=#00FF00"
```

Or use the installed command:

```bash
uv run gifcc input.gif output.gif \
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

## Tolerance

GIF colors are often not exactly what they look like, especially after palette conversion or compression. Use `--tolerance` to match colors that are close to the source color.

```bash
uv run python main.py input.gif output.gif \
  --map "#FFFFFF=#FF0000" \
  --tolerance 20
```

The default tolerance is `10`.

## Output

The script prints how many pixels were changed for each mapping:

```text
(255, 255, 255) -> (255, 0, 0): changed 1234 pixel(s)
```

If a mapping says it changed `0` pixels, the source color probably does not exist in the GIF at that tolerance.

## Install as a uv Tool

From this repo:

```bash
uv tool install .
```

Then run it from anywhere:

```bash
gifcc input.gif output.gif --map "#FFFFFF=#FF0000"
```

To remove it:

```bash
uv tool uninstall gif-color-changer
```

## Build

```bash
uv build
```

That writes the package artifacts to `dist/`.
