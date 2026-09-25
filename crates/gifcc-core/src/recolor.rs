use crate::color::{ColorMapping, Target};

/// Replace RGB colors in an RGBA buffer while preserving the original alpha
/// channel. Returns how many pixels each mapping changed.
///
/// Mappings run in order against the *original* colors, and a pixel is only
/// changed by the first mapping that matches it. A pixel matches when its
/// largest per-channel difference from the source color is within
/// `tolerance`. With `softness`, pixels in the outer `softness` band of the
/// tolerance range are blended toward the replacement instead of replaced.
pub fn replace_colors(
    rgba: &mut [u8],
    mappings: &[ColorMapping],
    tolerance: i32,
    softness: i32,
) -> Vec<u64> {
    let mut changed_counts = vec![0u64; mappings.len()];
    let soft = softness > 0 && tolerance > 0;
    let soft_start = (tolerance - softness).max(0);
    let soft_range = f64::from(tolerance - soft_start);

    for pixel in rgba.as_chunks_mut::<4>().0.iter_mut() {
        let original = [pixel[0], pixel[1], pixel[2]];

        for (index, (from_rgb, to_color)) in mappings.iter().enumerate() {
            let distance = (0..3)
                .map(|c| (i32::from(original[c]) - i32::from(from_rgb[c])).abs())
                .max()
                .unwrap();
            if distance > tolerance {
                continue;
            }

            let weight = if soft && distance > soft_start {
                (f64::from(tolerance - distance) / soft_range) as f32
            } else {
                1.0
            };

            match to_color {
                // Fade matched pixels toward fully transparent. With softness,
                // the alpha drops proportionally near the tolerance edge; the
                // RGB is left untouched since it is on its way to invisible.
                Target::Transparent if soft => {
                    pixel[3] = (f32::from(pixel[3]) * (1.0 - weight)).round_ties_even() as u8;
                }
                Target::Transparent => pixel[3] = 0,
                Target::Color(to_rgb) if soft => {
                    for c in 0..3 {
                        let source = f32::from(original[c]);
                        let target = f32::from(to_rgb[c]);
                        pixel[c] = (source + (target - source) * weight).round_ties_even() as u8;
                    }
                }
                Target::Color(to_rgb) => pixel[..3].copy_from_slice(to_rgb),
            }

            changed_counts[index] += 1;
            break;
        }
    }

    changed_counts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(
        pixels: &[[u8; 4]],
        mappings: &[ColorMapping],
        tolerance: i32,
        softness: i32,
    ) -> (Vec<[u8; 4]>, Vec<u64>) {
        let mut rgba: Vec<u8> = pixels.concat();
        let counts = replace_colors(&mut rgba, mappings, tolerance, softness);
        let out = rgba.as_chunks::<4>().0.to_vec();
        (out, counts)
    }

    #[test]
    fn maps_visible_pixels_once_and_preserves_alpha() {
        let (out, counts) = run(
            &[
                [255, 255, 255, 255],
                [250, 250, 250, 255],
                [0, 0, 0, 0],
                [0, 0, 0, 255],
            ],
            &[
                ([255, 255, 255], Target::Color([0, 0, 0])),
                ([0, 0, 0], Target::Color([255, 0, 0])),
            ],
            10,
            0,
        );

        assert_eq!(counts, [2, 2]);
        assert_eq!(
            out,
            [
                [0, 0, 0, 255],
                [0, 0, 0, 255],
                [255, 0, 0, 0],
                [255, 0, 0, 255]
            ]
        );
    }

    #[test]
    fn softens_pixels_near_tolerance_edge() {
        let (out, counts) = run(
            &[
                [255, 255, 255, 255],
                [250, 250, 250, 255],
                [244, 244, 244, 255],
            ],
            &[([255, 255, 255], Target::Color([0, 0, 0]))],
            10,
            10,
        );

        assert_eq!(counts, [2]);
        assert_eq!(
            out,
            [[0, 0, 0, 255], [125, 125, 125, 255], [244, 244, 244, 255]]
        );
    }

    #[test]
    fn makes_matched_pixels_transparent() {
        let (out, counts) = run(
            &[[255, 255, 255, 255], [250, 250, 250, 255], [0, 0, 0, 255]],
            &[([255, 255, 255], Target::Transparent)],
            10,
            0,
        );

        assert_eq!(counts, [2]);
        assert_eq!(
            out,
            [[255, 255, 255, 0], [250, 250, 250, 0], [0, 0, 0, 255]]
        );
    }

    #[test]
    fn fades_alpha_toward_transparent_with_softness() {
        let (out, counts) = run(
            &[
                [255, 255, 255, 255],
                [250, 250, 250, 255],
                [244, 244, 244, 255],
            ],
            &[([255, 255, 255], Target::Transparent)],
            10,
            10,
        );

        assert_eq!(counts, [2]);
        // Exact match goes fully transparent; the edge pixel fades proportionally.
        assert_eq!(
            out,
            [
                [255, 255, 255, 0],
                [250, 250, 250, 128],
                [244, 244, 244, 255]
            ]
        );
    }
}
