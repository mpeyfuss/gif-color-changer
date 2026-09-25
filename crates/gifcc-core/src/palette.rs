use std::str::FromStr;

use crate::Error;
use crate::color::{Rgb, Target};

/// Luminance weights for `weighted-rgb` distance (Rec. 709).
pub const RGB_DISTANCE_WEIGHTS: [f32; 3] = [0.2126, 0.7152, 0.0722];

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Distance {
    /// Squared RGB distance.
    #[default]
    Rgb,
    /// Squared RGB distance with each channel weighted by perceptual luminance.
    WeightedRgb,
}

impl FromStr for Distance {
    type Err = Error;

    fn from_str(distance: &str) -> Result<Self, Error> {
        match distance {
            "rgb" => Ok(Distance::Rgb),
            "weighted-rgb" => Ok(Distance::WeightedRgb),
            _ => Err(Error::invalid(
                "Expected distance to be 'rgb' or 'weighted-rgb'",
            )),
        }
    }
}

pub fn validate_palette_mapping(
    source_palette: &[Rgb],
    target_palette: &[Target],
) -> Result<(), Error> {
    if source_palette.is_empty() {
        return Err(Error::invalid(
            "Expected source palette to contain at least one color",
        ));
    }
    if target_palette.is_empty() {
        return Err(Error::invalid(
            "Expected target palette to contain at least one color",
        ));
    }
    if source_palette.len() != target_palette.len() {
        return Err(Error::invalid(
            "Expected source and target palettes to contain the same number of colors",
        ));
    }
    Ok(())
}

/// Index of the source palette color nearest to `rgb`. Ties resolve to the
/// earlier palette entry.
fn nearest_index(rgb: [u8; 3], source_palette: &[Rgb], distance: Distance) -> u32 {
    let mut nearest = 0;
    match distance {
        Distance::Rgb => {
            let mut nearest_distance = i32::MAX;
            for (index, source) in source_palette.iter().enumerate() {
                let d: i32 = (0..3)
                    .map(|c| {
                        let delta = i32::from(rgb[c]) - i32::from(source[c]);
                        delta * delta
                    })
                    .sum();
                if d < nearest_distance {
                    nearest_distance = d;
                    nearest = index;
                }
            }
        }
        Distance::WeightedRgb => {
            let mut nearest_distance = f32::INFINITY;
            for (index, source) in source_palette.iter().enumerate() {
                let mut d = 0.0f32;
                for c in 0..3 {
                    let delta = f32::from(rgb[c]) - f32::from(source[c]);
                    d += (delta * delta) * RGB_DISTANCE_WEIGHTS[c];
                }
                if d < nearest_distance {
                    nearest_distance = d;
                    nearest = index;
                }
            }
        }
    }
    nearest as u32
}

/// Smooth a label map by reassigning pixels to the label that surrounds them
/// more than their own.
///
/// Each pass reassigns a pixel whenever some *other* label occupies more of its
/// 8-neighborhood than the pixel's own label does, snapping it to whichever
/// neighbor dominates. This absorbs isolated speckles and the thin
/// intermediate bands that form along antialiased edges (their own label has
/// few neighbors), while pixels inside a solid region or along a real boundary
/// keep their label, because their own side still dominates their
/// neighborhood. Ties between competing labels resolve to the lower index.
/// Pixels outside the image count as no label.
pub fn cleanup_edges(
    labels: &[u32],
    width: usize,
    height: usize,
    num_labels: usize,
    passes: u32,
) -> Vec<u32> {
    assert_eq!(labels.len(), width * height);
    let mut current = labels.to_vec();
    if passes == 0 {
        return current;
    }

    let mut next = current.clone();
    let mut counts = vec![0u8; num_labels];
    let mut neighbors = [0u32; 8];

    for _ in 0..passes {
        let mut flipped = false;

        for y in 0..height {
            for x in 0..width {
                let mut n = 0;
                for ny in y.saturating_sub(1)..(y + 2).min(height) {
                    for nx in x.saturating_sub(1)..(x + 2).min(width) {
                        if nx != x || ny != y {
                            let label = current[ny * width + nx];
                            neighbors[n] = label;
                            n += 1;
                            counts[label as usize] += 1;
                        }
                    }
                }

                let own = current[y * width + x];
                let self_count = counts[own as usize];

                // The strongest competing label, ignoring the pixel's own.
                let mut other = own;
                let mut other_count = 0;
                for &label in &neighbors[..n] {
                    let count = counts[label as usize];
                    if label != own
                        && (count > other_count || (count == other_count && label < other))
                    {
                        other = label;
                        other_count = count;
                    }
                }

                let new_label = if other_count > self_count {
                    flipped = true;
                    other
                } else {
                    own
                };
                next[y * width + x] = new_label;

                for &label in &neighbors[..n] {
                    counts[label as usize] = 0;
                }
            }
        }

        if !flipped {
            break;
        }
        std::mem::swap(&mut current, &mut next);
    }

    current
}

/// Rewrite every pixel of an RGBA buffer to the target color whose source
/// palette entry is nearest, preserving the original alpha channel. Returns
/// how many pixels were assigned to each palette bucket.
pub fn rewrite_palette(
    rgba: &mut [u8],
    width: usize,
    height: usize,
    source_palette: &[Rgb],
    target_palette: &[Target],
    distance: Distance,
    cleanup: u32,
) -> Result<Vec<u64>, Error> {
    validate_palette_mapping(source_palette, target_palette)?;
    assert_eq!(rgba.len(), width * height * 4);

    let mut labels: Vec<u32> = rgba
        .as_chunks::<4>()
        .0
        .iter()
        .map(|p| nearest_index([p[0], p[1], p[2]], source_palette, distance))
        .collect();

    if cleanup > 0 {
        // Treat "transparent" as an extra region so cleanup works on color and
        // opacity together: a pixel adopts the color *and* alpha of whatever
        // surrounds it most. Stray opaque pixels in transparent space become
        // transparent, and transparent holes inside a region fill in. This also
        // stops visible pixels from being recolored toward the hidden RGB of
        // transparent neighbors, which now only ever vote for "transparent".
        let transparent_label = source_palette.len() as u32;
        for (label, pixel) in labels.iter_mut().zip(rgba.as_chunks::<4>().0.iter()) {
            if pixel[3] == 0 {
                *label = transparent_label;
            }
        }

        labels = cleanup_edges(&labels, width, height, source_palette.len() + 1, cleanup);

        for (label, pixel) in labels.iter().zip(rgba.as_chunks_mut::<4>().0.iter_mut()) {
            if *label == transparent_label {
                pixel[3] = 0;
            } else if pixel[3] == 0 {
                // Transparent pixels pulled into a region become fully opaque.
                pixel[3] = 255;
            }
        }
    }

    let mut assignment_counts = vec![0u64; source_palette.len()];
    for (label, pixel) in labels.iter().zip(rgba.as_chunks_mut::<4>().0.iter_mut()) {
        let Some(target) = target_palette.get(*label as usize) else {
            continue;
        };
        match target {
            Target::Color(rgb) => pixel[..3].copy_from_slice(rgb),
            Target::Transparent => pixel[3] = 0,
        }
        assignment_counts[*label as usize] += 1;
    }

    Ok(assignment_counts)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(
        pixels: &[[u8; 4]],
        width: usize,
        source: &[Rgb],
        target: &[Target],
        distance: Distance,
        cleanup: u32,
    ) -> (Vec<[u8; 4]>, Vec<u64>) {
        let mut rgba: Vec<u8> = pixels.concat();
        let counts = rewrite_palette(
            &mut rgba,
            width,
            pixels.len() / width,
            source,
            target,
            distance,
            cleanup,
        )
        .unwrap();
        let out = rgba.as_chunks::<4>().0.to_vec();
        (out, counts)
    }

    const fn color(rgb: Rgb) -> Target {
        Target::Color(rgb)
    }

    #[test]
    fn validate_palette_mapping_rejects_empty_or_unequal_palettes() {
        assert!(validate_palette_mapping(&[], &[color([255, 255, 255])]).is_err());
        assert!(validate_palette_mapping(&[[0, 0, 0]], &[]).is_err());
        assert!(
            validate_palette_mapping(&[[0, 0, 0]], &[color([255, 255, 255]), color([0, 0, 0])])
                .is_err()
        );
    }

    #[test]
    fn distance_rejects_unknown_modes() {
        assert!("lab".parse::<Distance>().is_err());
        assert_eq!("rgb".parse::<Distance>().unwrap(), Distance::Rgb);
        assert_eq!(
            "weighted-rgb".parse::<Distance>().unwrap(),
            Distance::WeightedRgb
        );
    }

    #[test]
    fn assigns_transparent_target_bucket() {
        let (out, counts) = run(
            &[[1, 1, 1, 255], [254, 254, 254, 255]],
            2,
            &[[0, 0, 0], [255, 255, 255]],
            &[color([10, 20, 30]), Target::Transparent],
            Distance::Rgb,
            0,
        );

        assert_eq!(counts, [1, 1]);
        assert_eq!(out, [[10, 20, 30, 255], [254, 254, 254, 0]]);
    }

    #[test]
    fn forces_pixels_to_nearest_source_palette_bucket() {
        let (out, counts) = run(
            &[
                [1, 1, 1, 255],
                [254, 254, 254, 255],
                [128, 128, 128, 255],
                [7, 8, 9, 0],
            ],
            4,
            &[[0, 0, 0], [255, 255, 255]],
            &[color([10, 20, 30]), color([200, 210, 220])],
            Distance::Rgb,
            0,
        );

        assert_eq!(counts, [2, 2]);
        assert_eq!(
            out,
            [
                [10, 20, 30, 255],
                [200, 210, 220, 255],
                [200, 210, 220, 255],
                [10, 20, 30, 0]
            ]
        );
    }

    #[test]
    fn breaks_distance_ties_by_first_source_color() {
        let (out, counts) = run(
            &[[5, 0, 0, 255]],
            1,
            &[[0, 0, 0], [10, 0, 0]],
            &[color([255, 0, 0]), color([0, 255, 0])],
            Distance::Rgb,
            0,
        );

        assert_eq!(counts, [1, 0]);
        assert_eq!(out, [[255, 0, 0, 255]]);
    }

    #[test]
    fn supports_weighted_rgb_distance() {
        let source = [[0, 0, 100], [0, 50, 0]];
        let target = [color([255, 0, 0]), color([0, 0, 255])];

        let (rgb_out, rgb_counts) = run(&[[0, 0, 0, 255]], 1, &source, &target, Distance::Rgb, 0);
        let (weighted_out, weighted_counts) = run(
            &[[0, 0, 0, 255]],
            1,
            &source,
            &target,
            Distance::WeightedRgb,
            0,
        );

        assert_eq!(rgb_counts, [0, 1]);
        assert_eq!(weighted_counts, [1, 0]);
        assert_eq!(rgb_out, [[0, 0, 255, 255]]);
        assert_eq!(weighted_out, [[255, 0, 0, 255]]);
    }

    #[test]
    fn cleanup_edges_absorbs_isolated_speckle_into_neighbor_majority() {
        let mut labels = vec![0; 9];
        labels[4] = 1; // lone bucket-1 pixel surrounded by 8 bucket-0 neighbors

        let cleaned = cleanup_edges(&labels, 3, 3, 2, 1);

        assert_eq!(cleaned, vec![0; 9]);
    }

    #[test]
    fn cleanup_edges_preserves_a_straight_edge() {
        // Left half bucket 0, right half bucket 1. Each edge pixel's own side
        // still dominates its neighborhood, so the boundary is left intact.
        let labels: Vec<u32> = (0..16).map(|i| u32::from(i % 4 >= 2)).collect();

        let cleaned = cleanup_edges(&labels, 4, 4, 2, 3);

        assert_eq!(cleaned, labels);
    }

    #[test]
    fn cleanup_edges_dissolves_a_thin_intermediate_band_along_an_edge() {
        // A 1-pixel-wide bucket-2 band sits between a bucket-0 region (cols
        // 0-1) and a bucket-1 region (cols 3-4) -- the antialiased-edge case.
        // Every band pixel is outnumbered by the regions on either side, so the
        // band dissolves into them. The two regions are preserved.
        let labels: Vec<u32> = (0..25)
            .map(|i| match i % 5 {
                0 | 1 => 0,
                2 => 2,
                _ => 1,
            })
            .collect();

        let cleaned = cleanup_edges(&labels, 5, 5, 3, 1);

        assert!(!cleaned.contains(&2));
        for (i, label) in cleaned.iter().enumerate() {
            match i % 5 {
                0 | 1 => assert_eq!(*label, 0),
                3 | 4 => assert_eq!(*label, 1),
                _ => {}
            }
        }
    }

    #[test]
    fn cleanup_edges_is_a_no_op_when_passes_is_zero() {
        let mut labels = vec![0; 9];
        labels[4] = 1;

        assert_eq!(cleanup_edges(&labels, 3, 3, 2, 0), labels);
    }

    #[test]
    fn cleanup_erases_stray_opaque_pixel_into_transparency() {
        let mut pixels = [[0, 0, 128, 0]; 9]; // transparent background
        pixels[4] = [0, 0, 128, 255]; // one stray opaque pixel
        let palette = [[255, 255, 0], [0, 0, 128]];

        let (out, _) = run(&pixels, 3, &palette, &palette.map(color), Distance::Rgb, 1);

        // Surrounded by transparency, the stray pixel takes on that transparency.
        assert!(out.iter().all(|p| p[3] == 0));
    }

    #[test]
    fn cleanup_fills_transparent_hole_inside_a_region() {
        let mut pixels = [[255, 255, 0, 255]; 9]; // solid opaque region
        pixels[4] = [0, 0, 128, 0]; // one transparent hole in the middle
        let palette = [[255, 255, 0], [0, 0, 128]];

        let (out, _) = run(&pixels, 3, &palette, &palette.map(color), Distance::Rgb, 1);

        // Surrounded by the region, the hole fills in with its color and opacity.
        assert_eq!(out, [[255, 255, 0, 255]; 9]);
    }

    #[test]
    fn cleanup_recolors_isolated_pixel_to_neighbor_color() {
        let mut pixels = [[0, 0, 0, 255]; 9];
        pixels[4] = [255, 255, 255, 255]; // lone white pixel in a field of black

        let (out, counts) = run(
            &pixels,
            3,
            &[[0, 0, 0], [255, 255, 255]],
            &[color([10, 20, 30]), color([200, 210, 220])],
            Distance::Rgb,
            1,
        );

        // The lone white pixel is reassigned to the surrounding black bucket.
        assert_eq!(counts, [9, 0]);
        assert_eq!(out, [[10, 20, 30, 255]; 9]);
    }
}
