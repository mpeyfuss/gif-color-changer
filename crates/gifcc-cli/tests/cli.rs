use std::fs;
use std::path::Path;

use assert_cmd::Command;
use gifcc_core::{Animation, decode, encode};
use predicates::str::contains;
use tempfile::TempDir;

fn gifcc() -> Command {
    Command::cargo_bin("gifcc").unwrap()
}

fn write_gif(path: &Path, pixels: &[[u8; 4]], width: u16) {
    let animation = Animation {
        width,
        height: (pixels.len() / usize::from(width)) as u16,
        frames: vec![pixels.concat()],
        delays_ms: vec![100],
        loop_count: 0,
    };
    fs::write(path, encode(&animation).unwrap()).unwrap();
}

fn read_pixels(path: &Path) -> Vec<[u8; 4]> {
    let animation = decode(&fs::read(path).unwrap()).unwrap();
    animation.frames[0].as_chunks::<4>().0.to_vec()
}

fn assert_usage_error(args: &[&str], message: &str) {
    gifcc()
        .args(["input.gif", "output.gif"])
        .args(args)
        .assert()
        .code(2)
        .stderr(contains(message));
}

#[test]
fn rejects_tolerance_in_palette_mode() {
    assert_usage_error(
        &[
            "--source-palette",
            "#000000",
            "--target-palette",
            "#FFFFFF",
            "--tolerance",
            "10",
        ],
        "--tolerance cannot be used with palette mode",
    );
}

#[test]
fn rejects_distance_in_tolerance_mode() {
    assert_usage_error(
        &["--map", "#FFFFFF=#FF0000", "--distance", "weighted-rgb"],
        "--distance can only be used with palette mode",
    );
}

#[test]
fn rejects_cleanup_in_tolerance_mode() {
    assert_usage_error(
        &["--map", "#FFFFFF=#FF0000", "--cleanup", "1"],
        "--cleanup can only be used with palette mode",
    );
}

#[test]
fn rejects_negative_cleanup() {
    assert_usage_error(
        &[
            "--source-palette",
            "#000000",
            "--target-palette",
            "#FFFFFF",
            "--cleanup",
            "-1",
        ],
        "--cleanup must be 0 or greater",
    );
}

#[test]
fn rejects_mixing_modes_and_missing_modes() {
    assert_usage_error(
        &["--map", "#FFFFFF=#FF0000", "--source-palette", "#000000"],
        "--map cannot be combined with palette mode",
    );
    assert_usage_error(
        &[],
        "expected --map or both --source-palette and --target-palette",
    );
    assert_usage_error(
        &["--source-palette", "#000000"],
        "palette mode requires both --source-palette and --target-palette",
    );
}

#[test]
fn rejects_invalid_colors_and_distance() {
    assert_usage_error(
        &["--map", "#FFFFFF"],
        "Expected color mapping in FROM=TO format, got: '#FFFFFF'",
    );
    assert_usage_error(
        &[
            "--source-palette",
            "#000000",
            "--target-palette",
            "#FFFFFF",
            "--distance",
            "lab",
        ],
        "Expected distance to be 'rgb' or 'weighted-rgb'",
    );
    assert_usage_error(
        &[
            "--source-palette",
            "#000000",
            "--target-palette",
            "#FFFFFF,#000000",
        ],
        "Expected source and target palettes to contain the same number of colors",
    );
}

#[test]
fn cleanup_recolors_isolated_pixel_in_palette_mode() {
    let dir = TempDir::new().unwrap();
    let (input, output) = (dir.path().join("input.gif"), dir.path().join("output.gif"));
    let mut pixels = [[0, 0, 0, 255]; 9];
    pixels[4] = [255, 255, 255, 255]; // lone white pixel in a field of black
    write_gif(&input, &pixels, 3);

    gifcc()
        .arg(&input)
        .arg(&output)
        .args([
            "--source-palette",
            "#000000,#FFFFFF",
            "--target-palette",
            "#FF0000,#0000FF",
            "--cleanup",
            "1",
        ])
        .assert()
        .success()
        .stdout(contains("(0, 0, 0) -> (255, 0, 0): assigned 9 pixel(s)"));

    assert_eq!(read_pixels(&output), [[255, 0, 0, 255]; 9]);
}

#[test]
fn maps_color_to_transparent() {
    let dir = TempDir::new().unwrap();
    let (input, output) = (dir.path().join("input.gif"), dir.path().join("output.gif"));
    write_gif(&input, &[[255, 255, 255, 255], [0, 0, 0, 255]], 2);

    gifcc()
        .arg(&input)
        .arg(&output)
        .args(["--map", "#FFFFFF=transparent"])
        .assert()
        .success()
        .stdout(contains(
            "(255, 255, 255) -> transparent: changed 1 pixel(s)",
        ));

    let pixels = read_pixels(&output);
    // The white pixel is now transparent; the black pixel is untouched.
    assert_eq!(pixels[0][3], 0);
    assert_eq!(pixels[1], [0, 0, 0, 255]);
}

#[test]
fn rewrites_gif_with_palette_mode() {
    let dir = TempDir::new().unwrap();
    let (input, output) = (dir.path().join("input.gif"), dir.path().join("output.gif"));
    write_gif(&input, &[[0, 0, 0, 255], [255, 255, 255, 255]], 2);

    gifcc()
        .arg(&input)
        .arg(&output)
        .args([
            "--source-palette",
            "#000000,#FFFFFF",
            "--target-palette",
            "#FF0000,#0000FF",
            "--distance",
            "weighted-rgb",
        ])
        .assert()
        .success()
        .stdout(contains("Saved:"));

    assert_eq!(read_pixels(&output), [[255, 0, 0, 255], [0, 0, 255, 255]]);
}

#[test]
fn reports_unreadable_input() {
    let dir = TempDir::new().unwrap();
    let input = dir.path().join("input.gif");
    fs::write(&input, b"not a gif").unwrap();

    gifcc()
        .arg(&input)
        .arg(dir.path().join("output.gif"))
        .args(["--map", "#FFFFFF=#FF0000"])
        .assert()
        .code(1)
        .stderr(contains("failed to decode"));
}
