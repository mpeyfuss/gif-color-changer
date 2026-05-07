# GIF Color Changer

Command line tool for replacing colors across every frame of a GIF.

## Install

```bash
uv tool install gif-color-changer
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

## Tolerance

GIF colors are often not exactly what they look like, especially after palette conversion or compression. Use `--tolerance` to match colors that are close to the source color.

```bash
gifcc input.gif output.gif \
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

## Uninstall

```bash
uv tool uninstall gif-color-changer
```

## Development

Set up the repo:

```bash
uv sync
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

You can also run the compatibility wrapper directly:

```bash
uv run python main.py input.gif output.gif \
  --map "#FFFFFF=#FF0000"
```

## Build

```bash
uv build
```

That writes the package artifacts to `dist/`.
