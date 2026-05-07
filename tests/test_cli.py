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
