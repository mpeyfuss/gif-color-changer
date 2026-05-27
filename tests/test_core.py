import pytest
from PIL import Image

from gif_color_changer.core import (
    cleanup_edges,
    parse_color_mapping,
    parse_palette,
    recolor_gif,
    replace_colors,
    rewrite_gif_palette,
    rewrite_palette,
    validate_distance_mode,
    validate_palette_mapping,
)


def test_parse_color_mapping():
    assert parse_color_mapping("#FFFFFF=#FF0000") == (
        (255, 255, 255),
        (255, 0, 0),
    )


def test_parse_palette_accepts_comma_separated_hex_colors():
    assert parse_palette("#000000,808080, #FFFFFF ") == [
        (0, 0, 0),
        (128, 128, 128),
        (255, 255, 255),
    ]


def test_parse_palette_rejects_empty_entries_and_invalid_hex():
    with pytest.raises(ValueError):
        parse_palette("#000000,,#FFFFFF")

    with pytest.raises(ValueError):
        parse_palette("#00000G")


def test_validate_palette_mapping_rejects_empty_or_unequal_palettes():
    with pytest.raises(ValueError):
        validate_palette_mapping([], [(255, 255, 255)])

    with pytest.raises(ValueError):
        validate_palette_mapping([(0, 0, 0)], [])

    with pytest.raises(ValueError):
        validate_palette_mapping([(0, 0, 0)], [(255, 255, 255), (0, 0, 0)])


def test_validate_distance_mode_rejects_unknown_modes():
    with pytest.raises(ValueError):
        validate_distance_mode("lab")


def test_replace_colors_maps_visible_pixels_once_and_preserves_alpha():
    image = Image.new("RGBA", (4, 1))
    image.putdata(
        [
            (255, 255, 255, 255),
            (250, 250, 250, 255),
            (0, 0, 0, 0),
            (0, 0, 0, 255),
        ]
    )

    recolored, counts = replace_colors(
        image,
        [
            ((255, 255, 255), (0, 0, 0)),
            ((0, 0, 0), (255, 0, 0)),
        ],
        tolerance=10,
    )

    assert counts == [2, 2]
    assert list(recolored.getdata()) == [
        (0, 0, 0, 255),
        (0, 0, 0, 255),
        (255, 0, 0, 0),
        (255, 0, 0, 255),
    ]


def test_replace_colors_softens_pixels_near_tolerance_edge():
    image = Image.new("RGBA", (3, 1))
    image.putdata(
        [
            (255, 255, 255, 255),
            (250, 250, 250, 255),
            (244, 244, 244, 255),
        ]
    )

    recolored, counts = replace_colors(
        image,
        [((255, 255, 255), (0, 0, 0))],
        tolerance=10,
        softness=10,
    )

    assert counts == [2]
    assert list(recolored.getdata()) == [
        (0, 0, 0, 255),
        (125, 125, 125, 255),
        (244, 244, 244, 255),
    ]


def test_rewrite_palette_forces_pixels_to_nearest_source_palette_bucket():
    image = Image.new("RGBA", (4, 1))
    image.putdata(
        [
            (1, 1, 1, 255),
            (254, 254, 254, 255),
            (128, 128, 128, 255),
            (7, 8, 9, 0),
        ]
    )

    recolored, counts = rewrite_palette(
        image,
        [(0, 0, 0), (255, 255, 255)],
        [(10, 20, 30), (200, 210, 220)],
    )

    assert counts == [2, 2]
    assert list(recolored.getdata()) == [
        (10, 20, 30, 255),
        (200, 210, 220, 255),
        (200, 210, 220, 255),
        (10, 20, 30, 0),
    ]


def test_rewrite_palette_breaks_distance_ties_by_first_source_color():
    image = Image.new("RGBA", (1, 1), (5, 0, 0, 255))

    recolored, counts = rewrite_palette(
        image,
        [(0, 0, 0), (10, 0, 0)],
        [(255, 0, 0), (0, 255, 0)],
    )

    assert counts == [1, 0]
    assert list(recolored.getdata()) == [(255, 0, 0, 255)]


def test_rewrite_palette_supports_weighted_rgb_distance():
    image = Image.new("RGBA", (1, 1), (0, 0, 0, 255))
    source_palette = [(0, 0, 100), (0, 50, 0)]
    target_palette = [(255, 0, 0), (0, 0, 255)]

    rgb_recolored, rgb_counts = rewrite_palette(
        image, source_palette, target_palette
    )
    weighted_recolored, weighted_counts = rewrite_palette(
        image,
        source_palette,
        target_palette,
        distance="weighted-rgb",
    )

    assert rgb_counts == [0, 1]
    assert weighted_counts == [1, 0]
    assert list(rgb_recolored.getdata()) == [(0, 0, 255, 255)]
    assert list(weighted_recolored.getdata()) == [(255, 0, 0, 255)]


def test_cleanup_edges_absorbs_isolated_speckle_into_neighbor_majority():
    import numpy as np

    labels = np.zeros((3, 3), dtype=np.intp)
    labels[1, 1] = 1  # lone bucket-1 pixel surrounded by 8 bucket-0 neighbors

    cleaned = cleanup_edges(labels, num_labels=2, passes=1)

    assert cleaned[1, 1] == 0
    assert np.all(cleaned == 0)


def test_cleanup_edges_preserves_a_straight_edge():
    import numpy as np

    # Left half bucket 0, right half bucket 1. Each edge pixel's own side still
    # dominates its neighborhood, so the boundary is left intact.
    labels = np.zeros((4, 4), dtype=np.intp)
    labels[:, 2:] = 1

    cleaned = cleanup_edges(labels, num_labels=2, passes=3)

    assert np.array_equal(cleaned, labels)


def test_cleanup_edges_dissolves_a_thin_intermediate_band_along_an_edge():
    import numpy as np

    # A 1-pixel-wide bucket-2 band sits between a bucket-0 region (cols 0-1) and
    # a bucket-1 region (cols 3-4) -- the antialiased-edge case. Every band
    # pixel is outnumbered by the regions on either side, so the band dissolves
    # into them and no bucket-2 pixel survives. The two regions are preserved.
    labels = np.zeros((5, 5), dtype=np.intp)
    labels[:, 2] = 2
    labels[:, 3:] = 1

    cleaned = cleanup_edges(labels, num_labels=3, passes=1)

    assert not np.any(cleaned == 2)
    assert np.all(cleaned[:, :2] == 0)
    assert np.all(cleaned[:, 3:] == 1)


def test_rewrite_palette_cleanup_erases_stray_opaque_pixel_into_transparency():
    image = Image.new("RGBA", (3, 3))
    pixels = [(0, 0, 128, 0)] * 9  # transparent background
    pixels[4] = (0, 0, 128, 255)  # one stray opaque pixel
    image.putdata(pixels)

    source_palette = [(255, 255, 0), (0, 0, 128)]
    target_palette = [(255, 255, 0), (0, 0, 128)]

    recolored, _ = rewrite_palette(
        image, source_palette, target_palette, cleanup=1
    )

    # Surrounded by transparency, the stray pixel takes on that transparency.
    assert all(pixel[3] == 0 for pixel in recolored.getdata())


def test_rewrite_palette_cleanup_fills_transparent_hole_inside_a_region():
    image = Image.new("RGBA", (3, 3), (255, 255, 0, 255))  # solid opaque region
    pixels = list(image.getdata())
    pixels[4] = (0, 0, 128, 0)  # one transparent hole in the middle
    image.putdata(pixels)

    source_palette = [(255, 255, 0), (0, 0, 128)]
    target_palette = [(255, 255, 0), (0, 0, 128)]

    recolored, _ = rewrite_palette(
        image, source_palette, target_palette, cleanup=1
    )

    # Surrounded by the region, the hole fills in with its color and opacity.
    assert list(recolored.getdata()) == [(255, 255, 0, 255)] * 9


def test_cleanup_edges_is_a_no_op_when_passes_is_zero():
    import numpy as np

    labels = np.zeros((3, 3), dtype=np.intp)
    labels[1, 1] = 1

    cleaned = cleanup_edges(labels, num_labels=2, passes=0)

    assert np.array_equal(cleaned, labels)


def test_rewrite_palette_cleanup_recolors_isolated_pixel_to_neighbor_color():
    image = Image.new("RGBA", (3, 3), (0, 0, 0, 255))
    pixels = list(image.getdata())
    pixels[4] = (255, 255, 255, 255)  # lone white pixel in a field of black
    image.putdata(pixels)

    source_palette = [(0, 0, 0), (255, 255, 255)]
    target_palette = [(10, 20, 30), (200, 210, 220)]

    recolored, counts = rewrite_palette(
        image, source_palette, target_palette, cleanup=1
    )

    # The lone white pixel is reassigned to the surrounding black bucket.
    assert counts == [9, 0]
    assert list(recolored.getdata()) == [(10, 20, 30, 255)] * 9


def test_rewrite_gif_palette_returns_frames_metadata_and_counts():
    image = Image.new("RGBA", (2, 1))
    image.putdata([(0, 0, 0, 255), (255, 255, 255, 255)])
    image.info["duration"] = 75
    image.info["loop"] = 1

    recolored = rewrite_gif_palette(
        image,
        [(0, 0, 0), (255, 255, 255)],
        [(255, 0, 0), (0, 0, 255)],
    )

    assert recolored.durations == [75]
    assert recolored.loop == 1
    assert recolored.changed_counts == [1, 1]
    assert list(recolored.frames[0].getdata()) == [
        (255, 0, 0, 255),
        (0, 0, 255, 255),
    ]


def test_recolor_gif_returns_frames_metadata_and_counts():
    image = Image.new("RGBA", (1, 1), (255, 255, 255, 255))
    image.info["duration"] = 75
    image.info["loop"] = 1

    recolored = recolor_gif(
        image,
        [((255, 255, 255), (255, 0, 0))],
        tolerance=0,
    )

    assert recolored.durations == [75]
    assert recolored.loop == 1
    assert recolored.changed_counts == [1]
    assert list(recolored.frames[0].getdata()) == [(255, 0, 0, 255)]
