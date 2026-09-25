//! Replace colors across every frame of a GIF.
//!
//! Two modes are supported:
//! - [`recolor_gif`]: tolerance-based `FROM=TO` color mappings, with optional
//!   soft blending near the tolerance edge.
//! - [`rewrite_gif_palette`]: snap every pixel to the nearest color in a source
//!   palette and replace it with the color at the same position in a target
//!   palette, with optional edge cleanup.
//!
//! Both preserve each pixel's alpha, and either may make pixels transparent.

mod color;
mod gif_io;
mod palette;
mod recolor;

use std::fmt;

pub use color::{
    ColorMapping, Rgb, TRANSPARENT_KEYWORDS, Target, format_rgb, hex_to_rgb, parse_color_mapping,
    parse_palette, parse_target_color, parse_target_palette,
};
pub use gif_io::{ALPHA_THRESHOLD, Animation, DEFAULT_DELAY_MS, decode, encode};
pub use palette::{
    Distance, RGB_DISTANCE_WEIGHTS, cleanup_edges, rewrite_palette, validate_palette_mapping,
};
pub use recolor::replace_colors;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// Invalid user input: a bad color, palette, or option.
    Invalid(String),
    /// The GIF couldn't be decoded or encoded.
    Gif(String),
}

impl Error {
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Error::Invalid(message.into())
    }

    pub(crate) fn gif(error: impl fmt::Display) -> Self {
        Error::Gif(error.to_string())
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Invalid(message) | Error::Gif(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for Error {}

/// Apply color mappings to every frame. Returns how many pixels each mapping
/// changed across all frames.
pub fn recolor_gif(
    animation: &mut Animation,
    color_mappings: &[ColorMapping],
    tolerance: i32,
    softness: i32,
) -> Vec<u64> {
    let counts = map_frames_mut(&mut animation.frames, |rgba| {
        replace_colors(rgba, color_mappings, tolerance, softness)
    });
    sum_counts(counts, color_mappings.len())
}

/// Rewrite every frame onto the target palette. Returns how many pixels were
/// assigned to each source palette bucket across all frames.
pub fn rewrite_gif_palette(
    animation: &mut Animation,
    source_palette: &[Rgb],
    target_palette: &[Target],
    distance: Distance,
    cleanup: u32,
) -> Result<Vec<u64>, Error> {
    validate_palette_mapping(source_palette, target_palette)?;

    let (width, height) = (usize::from(animation.width), usize::from(animation.height));
    let counts = map_frames_mut(&mut animation.frames, |rgba| {
        rewrite_palette(
            rgba,
            width,
            height,
            source_palette,
            target_palette,
            distance,
            cleanup,
        )
    })
    .into_iter()
    .collect::<Result<Vec<_>, _>>()?;
    Ok(sum_counts(counts, source_palette.len()))
}

fn sum_counts(per_frame: Vec<Vec<u64>>, len: usize) -> Vec<u64> {
    per_frame
        .into_iter()
        .fold(vec![0; len], |mut total, counts| {
            for (total, count) in total.iter_mut().zip(counts) {
                *total += count;
            }
            total
        })
}

/// Run `f` on every frame, in parallel when the `parallel` feature is on.
fn map_frames_mut<R: Send>(
    frames: &mut [Vec<u8>],
    f: impl Fn(&mut [u8]) -> R + Sync + Send,
) -> Vec<R> {
    #[cfg(feature = "parallel")]
    {
        use rayon::prelude::*;
        frames.par_iter_mut().map(|frame| f(frame)).collect()
    }
    #[cfg(not(feature = "parallel"))]
    {
        frames.iter_mut().map(|frame| f(frame)).collect()
    }
}

/// Run `f` on every frame with its index, in parallel when the `parallel`
/// feature is on.
pub(crate) fn map_frames<R: Send>(
    frames: &[Vec<u8>],
    f: impl Fn(usize, &[u8]) -> R + Sync + Send,
) -> Vec<R> {
    #[cfg(feature = "parallel")]
    {
        use rayon::prelude::*;
        frames
            .par_iter()
            .enumerate()
            .map(|(i, frame)| f(i, frame))
            .collect()
    }
    #[cfg(not(feature = "parallel"))]
    {
        frames
            .iter()
            .enumerate()
            .map(|(i, frame)| f(i, frame))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one_frame(pixels: &[[u8; 4]], width: u16) -> Animation {
        Animation {
            width,
            height: (pixels.len() / usize::from(width)) as u16,
            frames: vec![pixels.concat(), pixels.concat()],
            delays_ms: vec![75, 75],
            loop_count: 1,
        }
    }

    #[test]
    fn rewrite_gif_palette_sums_counts_across_frames() {
        let mut animation = one_frame(&[[0, 0, 0, 255], [255, 255, 255, 255]], 2);

        let counts = rewrite_gif_palette(
            &mut animation,
            &[[0, 0, 0], [255, 255, 255]],
            &[Target::Color([255, 0, 0]), Target::Color([0, 0, 255])],
            Distance::Rgb,
            0,
        )
        .unwrap();

        assert_eq!(counts, [2, 2]);
        assert_eq!(
            animation.frames[1],
            [[255, 0, 0, 255], [0, 0, 255, 255]].concat()
        );
    }

    #[test]
    fn recolor_gif_sums_counts_across_frames() {
        let mut animation = one_frame(&[[255, 255, 255, 255]], 1);

        let counts = recolor_gif(
            &mut animation,
            &[([255, 255, 255], Target::Color([255, 0, 0]))],
            0,
            0,
        );

        assert_eq!(counts, [2]);
        assert_eq!(animation.frames[0], [255, 0, 0, 255]);
    }

    #[test]
    fn rewrite_gif_palette_validates_palettes() {
        let mut animation = one_frame(&[[0, 0, 0, 255]], 1);

        let error =
            rewrite_gif_palette(&mut animation, &[[0, 0, 0]], &[], Distance::Rgb, 0).unwrap_err();

        assert!(matches!(error, Error::Invalid(_)));
    }
}
