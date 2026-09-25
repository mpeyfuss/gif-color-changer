use std::collections::HashMap;

use color_quant::NeuQuant;
use gif::{ColorOutput, DecodeOptions, DisposalMethod, Encoder, Frame, Repeat};

use crate::{Error, map_frames};

/// GIF transparency is 1-bit: pixels with alpha below this are written as the
/// transparent palette index, everything else as fully opaque.
pub const ALPHA_THRESHOLD: u8 = 128;
/// Frame delay used when a GIF doesn't specify one.
pub const DEFAULT_DELAY_MS: u32 = 100;
/// NeuQuant sampling factor for frames with more colors than fit in a palette
/// (1 = best quality, 30 = fastest).
const QUANTIZE_SPEED: i32 = 10;

/// A decoded GIF: every frame fully composited onto the canvas as RGBA.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Animation {
    pub width: u16,
    pub height: u16,
    /// One `width * height * 4` RGBA buffer per frame.
    pub frames: Vec<Vec<u8>>,
    pub delays_ms: Vec<u32>,
    /// Number of times to repeat the animation; 0 loops forever.
    pub loop_count: u16,
}

/// Decode a GIF into fully composited RGBA frames, applying each frame's
/// disposal method the way browsers do.
pub fn decode(bytes: &[u8]) -> Result<Animation, Error> {
    let mut options = DecodeOptions::new();
    options.set_color_output(ColorOutput::RGBA);
    let mut decoder = options.read_info(bytes).map_err(Error::gif)?;

    let width = decoder.width();
    let height = decoder.height();
    let (w, h) = (usize::from(width), usize::from(height));
    let mut canvas = vec![0u8; w * h * 4];
    let mut frames = Vec::new();
    let mut delays_ms = Vec::new();

    while let Some(frame) = decoder.read_next_frame().map_err(Error::gif)? {
        let (left, top) = (usize::from(frame.left), usize::from(frame.top));
        let frame_width = usize::from(frame.width);
        let visible_width = frame_width.min(w.saturating_sub(left));
        let visible_height = usize::from(frame.height).min(h.saturating_sub(top));
        let previous = (frame.dispose == DisposalMethod::Previous).then(|| canvas.clone());

        for fy in 0..visible_height {
            for fx in 0..visible_width {
                let src = &frame.buffer[(fy * frame_width + fx) * 4..][..4];
                let dst = &mut canvas[((top + fy) * w + left + fx) * 4..][..4];
                // Transparent frame pixels let the canvas show through; they
                // still fill in canvas pixels that are themselves transparent.
                if src[3] != 0 || dst[3] == 0 {
                    dst.copy_from_slice(src);
                }
            }
        }

        frames.push(canvas.clone());
        delays_ms.push(match frame.delay {
            0 => DEFAULT_DELAY_MS,
            delay => u32::from(delay) * 10,
        });

        match (frame.dispose, previous) {
            (DisposalMethod::Background, _) => {
                for y in top..top + visible_height {
                    canvas[(y * w + left) * 4..(y * w + left + visible_width) * 4].fill(0);
                }
            }
            (DisposalMethod::Previous, Some(previous)) => canvas = previous,
            _ => {}
        }
    }

    if frames.is_empty() {
        return Err(Error::Gif("GIF contains no frames".into()));
    }

    let loop_count = match decoder.repeat() {
        Repeat::Finite(count) => count,
        Repeat::Infinite => 0,
    };

    Ok(Animation {
        width,
        height,
        frames,
        delays_ms,
        loop_count,
    })
}

/// Encode an animation as a GIF. Frames with at most 255 distinct opaque
/// colors (256 if fully opaque) get an exact palette; busier frames are
/// quantized with NeuQuant.
pub fn encode(animation: &Animation) -> Result<Vec<u8>, Error> {
    let Animation {
        width,
        height,
        ref frames,
        ref delays_ms,
        loop_count,
    } = *animation;

    let delays: Vec<u16> = delays_ms
        .iter()
        .map(|&delay| (delay / 10).min(u32::from(u16::MAX)) as u16)
        .collect();
    let encoded_frames = map_frames(frames, |index, rgba| {
        let mut frame = index_frame(width, height, rgba);
        frame.delay = delays.get(index).copied().unwrap_or(10);
        // Every frame covers the full canvas, so clearing it before the next
        // one keeps transparent pixels transparent instead of showing the
        // previous frame through them.
        frame.dispose = DisposalMethod::Background;
        frame.make_lzw_pre_encoded();
        frame
    });

    let mut output = Vec::new();
    {
        let mut encoder = Encoder::new(&mut output, width, height, &[]).map_err(Error::gif)?;
        encoder
            .set_repeat(match loop_count {
                0 => Repeat::Infinite,
                count => Repeat::Finite(count),
            })
            .map_err(Error::gif)?;
        for frame in &encoded_frames {
            encoder
                .write_lzw_pre_encoded_frame(frame)
                .map_err(Error::gif)?;
        }
    }
    Ok(output)
}

/// Convert one RGBA frame to palette indices.
fn index_frame(width: u16, height: u16, rgba: &[u8]) -> Frame<'static> {
    let has_transparency = rgba
        .as_chunks::<4>()
        .0
        .iter()
        .any(|p| p[3] < ALPHA_THRESHOLD);
    let max_colors = if has_transparency { 255 } else { 256 };

    let (mut palette, mut indices) =
        exact_palette(rgba, max_colors).unwrap_or_else(|| quantized_palette(rgba, max_colors));

    let transparent = has_transparency.then(|| {
        let index = (palette.len() / 3) as u8;
        palette.extend_from_slice(&[0, 0, 0]);
        for (slot, pixel) in indices.iter_mut().zip(rgba.as_chunks::<4>().0.iter()) {
            if pixel[3] < ALPHA_THRESHOLD {
                *slot = index;
            }
        }
        index
    });
    if palette.is_empty() {
        palette.extend_from_slice(&[0, 0, 0]);
    }

    Frame {
        width,
        height,
        buffer: indices.into(),
        palette: Some(palette),
        transparent,
        ..Frame::default()
    }
}

/// Build a lossless palette, or `None` if the frame has too many colors.
/// Transparent pixels are left at index 0 for the caller to fill in.
fn exact_palette(rgba: &[u8], max_colors: usize) -> Option<(Vec<u8>, Vec<u8>)> {
    let mut lookup: HashMap<[u8; 3], u8> = HashMap::new();
    let mut palette = Vec::new();
    let mut indices = Vec::with_capacity(rgba.len() / 4);

    for pixel in rgba.as_chunks::<4>().0.iter() {
        if pixel[3] < ALPHA_THRESHOLD {
            indices.push(0);
            continue;
        }
        let rgb = [pixel[0], pixel[1], pixel[2]];
        let index = match lookup.get(&rgb) {
            Some(&index) => index,
            None => {
                if lookup.len() == max_colors {
                    return None;
                }
                let index = lookup.len() as u8;
                lookup.insert(rgb, index);
                palette.extend_from_slice(&rgb);
                index
            }
        };
        indices.push(index);
    }

    Some((palette, indices))
}

/// Quantize the opaque pixels of a frame down to `max_colors`.
fn quantized_palette(rgba: &[u8], max_colors: usize) -> (Vec<u8>, Vec<u8>) {
    let opaque: Vec<u8> = rgba
        .as_chunks::<4>()
        .0
        .iter()
        .filter(|p| p[3] >= ALPHA_THRESHOLD)
        .flat_map(|p| [p[0], p[1], p[2], 255])
        .collect();
    let quantizer = NeuQuant::new(QUANTIZE_SPEED, max_colors, &opaque);

    let indices = rgba
        .as_chunks::<4>()
        .0
        .iter()
        .map(|p| {
            if p[3] < ALPHA_THRESHOLD {
                0
            } else {
                quantizer.index_of(&[p[0], p[1], p[2], 255]) as u8
            }
        })
        .collect();

    (quantizer.color_map_rgb(), indices)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn animation(frames: Vec<Vec<u8>>, width: u16, height: u16) -> Animation {
        Animation {
            width,
            height,
            delays_ms: vec![70; frames.len()],
            frames,
            loop_count: 3,
        }
    }

    #[test]
    fn round_trips_exact_palette_frames_with_transparency() {
        let frames = vec![
            [
                [255, 0, 0, 255],
                [0, 0, 0, 0],
                [0, 255, 0, 255],
                [1, 2, 3, 255],
            ]
            .concat(),
            [[0, 0, 0, 0], [9, 9, 9, 255], [0, 255, 0, 255], [0, 0, 0, 0]].concat(),
        ];
        let original = animation(frames, 2, 2);

        let decoded = decode(&encode(&original).unwrap()).unwrap();

        assert_eq!(decoded.delays_ms, original.delays_ms);
        assert_eq!(decoded.loop_count, 3);
        for (decoded, original) in decoded.frames.iter().zip(&original.frames) {
            for (d, o) in decoded
                .as_chunks::<4>()
                .0
                .iter()
                .zip(original.as_chunks::<4>().0.iter())
            {
                assert_eq!(d[3] == 0, o[3] == 0);
                if o[3] != 0 {
                    assert_eq!(d, o);
                }
            }
        }
    }

    #[test]
    fn thresholds_partial_alpha() {
        let frame = [[10, 10, 10, 127], [20, 20, 20, 128]].concat();

        let decoded = decode(&encode(&animation(vec![frame], 2, 1)).unwrap()).unwrap();

        assert_eq!(decoded.frames[0][3], 0);
        assert_eq!(&decoded.frames[0][4..], &[20, 20, 20, 255]);
    }

    #[test]
    fn quantizes_frames_with_too_many_colors_without_leaking_transparency() {
        let (width, height) = (64u16, 64u16);
        let mut frame = Vec::new();
        for i in 0..usize::from(width) * usize::from(height) {
            let alpha = if i % 7 == 0 { 0 } else { 255 };
            frame.extend_from_slice(&[(i % 256) as u8, (i / 16) as u8, (i * 3 % 251) as u8, alpha]);
        }

        let decoded =
            decode(&encode(&animation(vec![frame.clone()], width, height)).unwrap()).unwrap();

        for (i, (d, o)) in decoded.frames[0]
            .as_chunks::<4>()
            .0
            .iter()
            .zip(frame.as_chunks::<4>().0.iter())
            .enumerate()
        {
            assert_eq!(d[3] == 0, o[3] == 0, "pixel {i} transparency changed");
        }
    }

    #[test]
    fn loops_forever_when_loop_count_is_zero() {
        let mut still = animation(vec![vec![0, 0, 0, 255]], 1, 1);
        still.loop_count = 0;

        assert_eq!(decode(&encode(&still).unwrap()).unwrap().loop_count, 0);
    }

    #[test]
    fn rejects_non_gif_input() {
        assert!(decode(b"not a gif").is_err());
    }
}
