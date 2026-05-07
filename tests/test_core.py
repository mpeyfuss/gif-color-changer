from PIL import Image

from gif_color_changer.core import parse_color_mapping, recolor_gif, replace_colors


def test_parse_color_mapping():
    assert parse_color_mapping("#FFFFFF=#FF0000") == (
        (255, 255, 255),
        (255, 0, 0),
    )


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

    assert counts == [2, 1]
    assert list(recolored.getdata()) == [
        (0, 0, 0, 255),
        (0, 0, 0, 255),
        (0, 0, 0, 0),
        (255, 0, 0, 255),
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
