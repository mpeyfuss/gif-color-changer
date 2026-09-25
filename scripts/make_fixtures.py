"""Capture golden outputs from the original Python (numpy + Pillow) core.

The Python package was removed in the TypeScript port, so run this against the
last Python release (0.5.0, commit 2324710):

    git worktree add ../gifcc-python 2324710
    cp scripts/make_fixtures.py ../gifcc-python/scripts/
    cd ../gifcc-python && uv run python scripts/make_fixtures.py
    cp -r tests/fixtures/. ../gif-color-changer/tests/fixtures/

Writes tests/fixtures/{manifest.json,images.bin,expected.bin,anim.gif,still.gif}.
tests/parity.test.ts replays every case and must match byte-for-byte.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageSequence

from gif_color_changer.core import (
    parse_color_mapping,
    parse_palette,
    replace_colors,
    rewrite_palette,
)

WIDTH, HEIGHT = 24, 16
OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures"


def make_images() -> dict[str, np.ndarray]:
    rng = np.random.default_rng(1234)
    ys, xs = np.mgrid[0:HEIGHT, 0:WIDTH]

    noise = rng.integers(0, 256, (HEIGHT, WIDTH, 4), dtype=np.uint8)
    noise[..., 3] = rng.choice([0, 64, 127, 128, 200, 255], (HEIGHT, WIDTH))

    gradient = np.zeros((HEIGHT, WIDTH, 4), dtype=np.uint8)
    gradient[..., 0] = (xs * 255 // (WIDTH - 1)).astype(np.uint8)
    gradient[..., 1] = (ys * 255 // (HEIGHT - 1)).astype(np.uint8)
    gradient[..., 2] = ((xs + ys) * 255 // (WIDTH + HEIGHT - 2)).astype(np.uint8)
    gradient[..., 3] = 255

    # Colors clustered around the mapping/palette sources, so tolerance and
    # softness edges (and distance ties) get exercised.
    anchors = np.array(
        [(255, 255, 255), (0, 0, 0), (128, 128, 128), (255, 0, 0), (192, 192, 192), (5, 0, 0)],
        dtype=np.int16,
    )
    picks = anchors[rng.integers(0, len(anchors), (HEIGHT, WIDTH))]
    jitter = rng.integers(-40, 41, (HEIGHT, WIDTH, 3), dtype=np.int16)
    near = np.zeros((HEIGHT, WIDTH, 4), dtype=np.uint8)
    near[..., :3] = np.clip(picks + jitter, 0, 255).astype(np.uint8)
    near[..., 3] = rng.choice([0, 255, 255, 255, 180], (HEIGHT, WIDTH))

    # Blocky regions with speckles, antialiased-ish borders and transparent
    # holes: the cleanup cases.
    regions = np.zeros((HEIGHT, WIDTH, 4), dtype=np.uint8)
    regions[..., 3] = 255
    regions[:, : WIDTH // 3, :3] = (250, 5, 5)
    regions[:, WIDTH // 3 : 2 * WIDTH // 3, :3] = (5, 250, 5)
    regions[:, 2 * WIDTH // 3 :, :3] = (5, 5, 250)
    regions[: HEIGHT // 4, :, 3] = 0
    regions[:, WIDTH // 3, :3] = (128, 128, 5)
    speckles = rng.random((HEIGHT, WIDTH)) < 0.08
    regions[speckles, :3] = rng.integers(0, 256, (int(speckles.sum()), 3), dtype=np.uint8)
    holes = rng.random((HEIGHT, WIDTH)) < 0.05
    regions[holes, 3] = 0
    specks = rng.random((HEIGHT, WIDTH)) < 0.05
    regions[specks & (regions[..., 3] == 0), 3] = 255

    return {"noise": noise, "gradient": gradient, "near": near, "regions": regions}


MAPPING_SETS = [
    ["#FFFFFF=#FF0000", "#000000=#00FF00"],
    ["#808080=transparent", "#FF0000=#0000FF"],
    ["#C0C0C0=#102030", "#404040=none", "#7F7F7F=#FFFFFF"],
]
TOLERANCES = [0, 10, 50, 255]
SOFTNESSES = [0, 7, 25, 255]

PALETTE_SETS = [
    ("#000000,#808080,#FFFFFF", "#1D3557,#E63946,#F1FAEE"),
    ("#FF0000,#00FF00,#0000FF,#FFFF00", "#111111,#222222,transparent,#444444"),
    ("#000000,#0A0000", "#FF0000,#00FF00"),
]
DISTANCES = ["rgb", "weighted-rgb"]
CLEANUPS = [0, 1, 3]


def make_gifs() -> dict[str, dict]:
    """Small real GIFs saved by Pillow, plus the frames Pillow decodes from
    them, for decode tests."""
    frames = []
    for i, color in enumerate([(255, 255, 255), (0, 0, 0), (200, 30, 30)]):
        frame = Image.new("RGBA", (6, 4), (0, 0, 0, 0))
        for x in range(6):
            for y in range(4):
                if (x + y + i) % 3:
                    frame.putpixel((x, y), (*color, 255))
                elif x == y:
                    frame.putpixel((x, y), (10, 200, 10, 255))
        frames.append(frame)

    anim_path = OUT / "anim.gif"
    frames[0].save(
        anim_path,
        save_all=True,
        append_images=frames[1:],
        duration=[70, 120, 40],
        loop=2,
        disposal=2,
    )

    still_path = OUT / "still.gif"
    still = Image.new("RGBA", (3, 3), (0, 0, 0, 255))
    still.putpixel((1, 1), (255, 255, 255, 255))
    still.save(still_path)

    info = {}
    for path in (anim_path, still_path):
        with Image.open(path) as image:
            decoded = [
                frame.convert("RGBA").tobytes().hex()
                for frame in ImageSequence.Iterator(image)
            ]
            info[path.name] = {
                "width": image.width,
                "height": image.height,
                "loop": image.info.get("loop"),
                "durations": [
                    frame.info.get("duration", 100)
                    for frame in ImageSequence.Iterator(image)
                ],
                "frames": decoded,
            }
    return info


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    images = make_images()

    image_blob = bytearray()
    image_offsets = {}
    for name, pixels in images.items():
        image_offsets[name] = len(image_blob)
        image_blob += pixels.tobytes()

    expected_blob = bytearray()
    cases = []

    def record(case: dict, output: Image.Image, counts: list[int]):
        data = np.array(output, dtype=np.uint8).tobytes()
        case["offset"] = len(expected_blob)
        case["counts"] = counts
        expected_blob.extend(data)
        cases.append(case)

    for name, pixels in images.items():
        frame = Image.fromarray(pixels, mode="RGBA")

        for set_index, raw_mappings in enumerate(MAPPING_SETS):
            mappings = [parse_color_mapping(m) for m in raw_mappings]
            for tolerance in TOLERANCES:
                for softness in SOFTNESSES:
                    output, counts = replace_colors(frame, mappings, tolerance, softness)
                    record(
                        {
                            "name": f"map-{name}-{set_index}-t{tolerance}-s{softness}",
                            "image": name,
                            "mode": "map",
                            "mappings": raw_mappings,
                            "tolerance": tolerance,
                            "softness": softness,
                        },
                        output,
                        counts,
                    )

        for set_index, (raw_source, raw_target) in enumerate(PALETTE_SETS):
            source = parse_palette(raw_source)
            target = parse_palette(raw_target, allow_transparent=True)
            for distance in DISTANCES:
                for cleanup in CLEANUPS:
                    output, counts = rewrite_palette(frame, source, target, distance, cleanup)
                    record(
                        {
                            "name": f"palette-{name}-{set_index}-{distance}-c{cleanup}",
                            "image": name,
                            "mode": "palette",
                            "source": raw_source,
                            "target": raw_target,
                            "distance": distance,
                            "cleanup": cleanup,
                        },
                        output,
                        counts,
                    )

    gifs = make_gifs()

    (OUT / "images.bin").write_bytes(bytes(image_blob))
    (OUT / "expected.bin").write_bytes(bytes(expected_blob))
    manifest = {
        "width": WIDTH,
        "height": HEIGHT,
        "images": image_offsets,
        "cases": cases,
        "gifs": gifs,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"Wrote {len(cases)} cases to {OUT}")


if __name__ == "__main__":
    main()
