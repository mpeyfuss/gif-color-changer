//! Golden tests against output captured from the original Python (numpy +
//! Pillow) implementation. See `tests/fixtures/manifest.json`.

use std::fs;
use std::path::{Path, PathBuf};

use gifcc_core::{
    Distance, decode, parse_color_mapping, parse_palette, parse_target_palette, replace_colors,
    rewrite_palette,
};
use serde_json::Value;

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn manifest() -> Value {
    serde_json::from_str(&fs::read_to_string(fixtures().join("manifest.json")).unwrap()).unwrap()
}

fn read(file: &Value) -> Vec<u8> {
    fs::read(fixtures().join(file.as_str().unwrap())).unwrap()
}

fn counts(case: &Value) -> Vec<u64> {
    case["counts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_u64().unwrap())
        .collect()
}

fn first_mismatch<'a>(
    actual: &'a [u8],
    expected: &'a [u8],
) -> Option<(usize, &'a [u8; 4], &'a [u8; 4])> {
    actual
        .as_chunks::<4>()
        .0
        .iter()
        .zip(expected.as_chunks::<4>().0.iter())
        .enumerate()
        .find(|(_, (a, e))| a != e)
        .map(|(i, (a, e))| (i, a, e))
}

#[test]
fn algorithms_match_python_output() {
    let manifest = manifest();
    let width = manifest["width"].as_u64().unwrap() as usize;
    let height = manifest["height"].as_u64().unwrap() as usize;
    let cases = manifest["cases"].as_array().unwrap();
    let mut failures = Vec::new();

    for case in cases {
        let name = case["name"].as_str().unwrap();
        let mut rgba = read(&manifest["images"][case["image"].as_str().unwrap()]);

        let actual_counts = match case["mode"].as_str().unwrap() {
            "map" => {
                let mappings: Vec<_> = case["mappings"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|m| parse_color_mapping(m.as_str().unwrap()).unwrap())
                    .collect();
                replace_colors(
                    &mut rgba,
                    &mappings,
                    case["tolerance"].as_i64().unwrap() as i32,
                    case["softness"].as_i64().unwrap() as i32,
                )
            }
            "palette" => rewrite_palette(
                &mut rgba,
                width,
                height,
                &parse_palette(case["source"].as_str().unwrap()).unwrap(),
                &parse_target_palette(case["target"].as_str().unwrap()).unwrap(),
                case["distance"]
                    .as_str()
                    .unwrap()
                    .parse::<Distance>()
                    .unwrap(),
                case["cleanup"].as_u64().unwrap() as u32,
            )
            .unwrap(),
            mode => panic!("unknown mode {mode}"),
        };

        let expected = read(&case["expected"]);
        if let Some((i, a, e)) = first_mismatch(&rgba, &expected) {
            failures.push(format!("{name}: pixel {i} is {a:?}, expected {e:?}"));
        } else if actual_counts != counts(case) {
            failures.push(format!(
                "{name}: counts {actual_counts:?}, expected {:?}",
                counts(case)
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "{} of {} cases differ:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
}

/// Decoding is compared on what's visible: alpha everywhere, RGB only where
/// the pixel isn't fully transparent (hidden RGB values are decoder-specific).
#[test]
fn decoded_gifs_match_pillow() {
    let manifest = manifest();

    for gif in manifest["gifs"].as_array().unwrap() {
        let name = gif["name"].as_str().unwrap();
        let animation = decode(&read(&gif["file"])).unwrap();
        let expected = read(&gif["frames"]);

        assert_eq!(u64::from(animation.width), gif["width"].as_u64().unwrap());
        assert_eq!(u64::from(animation.height), gif["height"].as_u64().unwrap());
        assert_eq!(
            animation.frames.len() as u64,
            gif["frame_count"].as_u64().unwrap(),
            "{name}: frame count"
        );
        let durations: Vec<u32> = gif["durations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d.as_u64().unwrap() as u32)
            .collect();
        assert_eq!(animation.delays_ms, durations, "{name}: durations");
        assert_eq!(
            u64::from(animation.loop_count),
            gif["loop"].as_u64().unwrap(),
            "{name}: loop"
        );

        let frame_len = animation.frames[0].len();
        for (index, frame) in animation.frames.iter().enumerate() {
            let expected = &expected[index * frame_len..][..frame_len];
            for (i, (a, e)) in frame
                .as_chunks::<4>()
                .0
                .iter()
                .zip(expected.as_chunks::<4>().0.iter())
                .enumerate()
            {
                assert_eq!(a[3], e[3], "{name} frame {index} pixel {i}: alpha");
                if e[3] != 0 {
                    assert_eq!(a, e, "{name} frame {index} pixel {i}");
                }
            }
        }
    }
}
