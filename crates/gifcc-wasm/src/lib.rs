//! WebAssembly bindings for gif-color-changer.
//!
//! Colors and palettes are passed as the same strings the CLI accepts, so the
//! web app gets identical parsing and error messages.

use gifcc_core::{
    Animation, Distance, Error, decode, encode, format_rgb, parse_color_mapping, parse_palette,
    parse_target_palette, recolor_gif, rewrite_gif_palette,
};
use wasm_bindgen::prelude::*;

/// A recolored GIF plus a per-mapping (or per-bucket) summary.
#[wasm_bindgen(getter_with_clone)]
pub struct Output {
    /// The encoded output GIF.
    pub bytes: Vec<u8>,
    /// Pixels changed per mapping, or assigned per palette bucket.
    pub counts: Vec<f64>,
    /// One human-readable line per mapping or bucket, as the CLI prints them.
    pub lines: Vec<String>,
    pub width: u16,
    pub height: u16,
    pub frames: u32,
}

fn js_error(error: Error) -> JsError {
    JsError::new(&error.to_string())
}

fn read_gif(gif: &[u8]) -> Result<Animation, JsError> {
    decode(gif).map_err(|error| JsError::new(&format!("Couldn't read this GIF: {error}")))
}

/// Replace colors using `FROM=TO` mappings, e.g. `["#FFFFFF=#FF0000"]`.
#[wasm_bindgen]
pub fn recolor(
    gif: &[u8],
    mappings: Vec<String>,
    tolerance: i32,
    softness: i32,
) -> Result<Output, JsError> {
    if mappings.is_empty() {
        return Err(JsError::new("Add at least one color mapping"));
    }
    if softness < 0 {
        return Err(JsError::new("Softness must be 0 or greater"));
    }
    let mappings = mappings
        .iter()
        .map(|mapping| parse_color_mapping(mapping))
        .collect::<Result<Vec<_>, _>>()
        .map_err(js_error)?;

    let mut animation = read_gif(gif)?;
    let counts = recolor_gif(&mut animation, &mappings, tolerance, softness);
    let lines = mappings
        .iter()
        .zip(&counts)
        .map(|((from, to), count)| {
            format!("{} -> {to}: changed {count} pixel(s)", format_rgb(*from))
        })
        .collect();

    finish(&animation, counts, lines)
}

/// Rewrite every pixel onto a target palette, e.g. source `"#000000,#FFFFFF"`
/// and target `"#1D3557,transparent"`.
#[wasm_bindgen(js_name = rewritePalette)]
pub fn rewrite_palette(
    gif: &[u8],
    source_palette: &str,
    target_palette: &str,
    distance: &str,
    cleanup: u32,
) -> Result<Output, JsError> {
    let source = parse_palette(source_palette).map_err(js_error)?;
    let target = parse_target_palette(target_palette).map_err(js_error)?;
    let distance: Distance = distance.parse().map_err(js_error)?;

    let mut animation = read_gif(gif)?;
    let counts = rewrite_gif_palette(&mut animation, &source, &target, distance, cleanup)
        .map_err(js_error)?;
    let lines = source
        .iter()
        .zip(&target)
        .zip(&counts)
        .map(|((from, to), count)| {
            format!("{} -> {to}: assigned {count} pixel(s)", format_rgb(*from))
        })
        .collect();

    finish(&animation, counts, lines)
}

fn finish(animation: &Animation, counts: Vec<u64>, lines: Vec<String>) -> Result<Output, JsError> {
    Ok(Output {
        bytes: encode(animation).map_err(js_error)?,
        counts: counts.into_iter().map(|count| count as f64).collect(),
        lines,
        width: animation.width,
        height: animation.height,
        frames: animation.frames.len() as u32,
    })
}
