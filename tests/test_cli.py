import sys

import pytest
from PIL import Image

from gif_color_changer.cli import main


def test_cli_rejects_tolerance_in_palette_mode(monkeypatch, capsys):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "gifcc",
            "input.gif",
            "output.gif",
            "--source-palette",
            "#000000",
            "--target-palette",
            "#FFFFFF",
            "--tolerance",
            "10",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 2
    assert "--tolerance cannot be used with palette mode" in capsys.readouterr().err


def test_cli_rejects_distance_in_tolerance_mode(monkeypatch, capsys):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "gifcc",
            "input.gif",
            "output.gif",
            "--map",
            "#000000=#FFFFFF",
            "--distance",
            "weighted-rgb",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 2
    assert "--distance can only be used with palette mode" in capsys.readouterr().err


def test_cli_rejects_cleanup_in_tolerance_mode(monkeypatch, capsys):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "gifcc",
            "input.gif",
            "output.gif",
            "--map",
            "#000000=#FFFFFF",
            "--cleanup",
            "2",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 2
    assert "--cleanup can only be used with palette mode" in capsys.readouterr().err


def test_cli_rejects_negative_cleanup(monkeypatch, capsys):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "gifcc",
            "input.gif",
            "output.gif",
            "--source-palette",
            "#000000",
            "--target-palette",
            "#FFFFFF",
            "--cleanup",
            "-1",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 2
    assert "--cleanup must be 0 or greater" in capsys.readouterr().err


def test_cli_cleanup_recolors_isolated_pixel_in_palette_mode(monkeypatch, tmp_path):
    input_path = tmp_path / "input.gif"
    output_path = tmp_path / "output.gif"
    image = Image.new("RGBA", (3, 3), (0, 0, 0, 255))
    pixels = list(image.getdata())
    pixels[4] = (255, 255, 255, 255)  # lone white pixel in a field of black
    image.putdata(pixels)
    image.save(input_path)

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "gifcc",
            str(input_path),
            str(output_path),
            "--source-palette",
            "#000000,#FFFFFF",
            "--target-palette",
            "#FF0000,#0000FF",
            "--cleanup",
            "1",
        ],
    )

    main()

    with Image.open(output_path) as output:
        assert list(output.convert("RGBA").getdata()) == [(255, 0, 0, 255)] * 9


def test_cli_maps_color_to_transparent(monkeypatch, tmp_path):
    input_path = tmp_path / "input.gif"
    output_path = tmp_path / "output.gif"
    image = Image.new("RGBA", (2, 1))
    image.putdata([(255, 255, 255, 255), (0, 0, 0, 255)])
    image.save(input_path)

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "gifcc",
            str(input_path),
            str(output_path),
            "--map",
            "#FFFFFF=transparent",
        ],
    )

    main()

    with Image.open(output_path) as output:
        round_tripped = list(output.convert("RGBA").getdata())

    # The white pixel is now transparent; the black pixel is untouched.
    assert round_tripped[0][3] == 0
    assert round_tripped[1] == (0, 0, 0, 255)


def test_cli_rewrites_gif_with_palette_mode(monkeypatch, tmp_path):
    input_path = tmp_path / "input.gif"
    output_path = tmp_path / "output.gif"
    image = Image.new("RGBA", (2, 1))
    image.putdata([(0, 0, 0, 255), (255, 255, 255, 255)])
    image.save(input_path)

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "gifcc",
            str(input_path),
            str(output_path),
            "--source-palette",
            "#000000,#FFFFFF",
            "--target-palette",
            "#FF0000,#0000FF",
            "--distance",
            "weighted-rgb",
        ],
    )

    main()

    with Image.open(output_path) as output:
        assert list(output.convert("RGBA").getdata()) == [
            (255, 0, 0, 255),
            (0, 0, 255, 255),
        ]
