use std::fmt;

use crate::Error;

pub type Rgb = [u8; 3];

/// Keywords accepted in place of a hex color on the replacement side.
pub const TRANSPARENT_KEYWORDS: [&str; 2] = ["transparent", "none"];

/// A replacement color. `Transparent` is only valid on the replacement side of
/// a mapping or palette; source matching always stays RGB-only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    Color(Rgb),
    Transparent,
}

pub type ColorMapping = (Rgb, Target);

impl fmt::Display for Target {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Target::Color(rgb) => write!(f, "{}", format_rgb(*rgb)),
            Target::Transparent => f.write_str("transparent"),
        }
    }
}

/// Format a color like the Python tuple it replaces: `(255, 0, 0)`.
pub fn format_rgb([r, g, b]: Rgb) -> String {
    format!("({r}, {g}, {b})")
}

pub fn hex_to_rgb(hex_color: &str) -> Result<Rgb, Error> {
    let hex = hex_color.trim().trim_start_matches('#');
    if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(Error::invalid(format!(
            "Expected a 6-digit hex color, got: '{hex}'"
        )));
    }

    let channel = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).unwrap();
    Ok([channel(0), channel(2), channel(4)])
}

/// Parse a replacement color, which may be the `transparent`/`none` keyword
/// (fully clear) instead of a hex color.
pub fn parse_target_color(raw_color: &str) -> Result<Target, Error> {
    let keyword = raw_color.trim().to_lowercase();
    if TRANSPARENT_KEYWORDS.contains(&keyword.as_str()) {
        return Ok(Target::Transparent);
    }
    hex_to_rgb(raw_color).map(Target::Color)
}

pub fn parse_color_mapping(raw_mapping: &str) -> Result<ColorMapping, Error> {
    let invalid = || {
        Error::invalid(format!(
            "Expected color mapping in FROM=TO format, got: '{raw_mapping}'"
        ))
    };
    let (from_color, to_color) = raw_mapping.split_once('=').ok_or_else(invalid)?;
    if from_color.is_empty() || to_color.is_empty() {
        return Err(invalid());
    }

    Ok((hex_to_rgb(from_color)?, parse_target_color(to_color)?))
}

fn split_palette(raw_palette: &str) -> Result<Vec<&str>, Error> {
    let colors: Vec<&str> = raw_palette.split(',').map(str::trim).collect();
    if colors.iter().any(|color| color.is_empty()) {
        return Err(Error::invalid(format!(
            "Expected comma-separated hex colors, got: '{raw_palette}'"
        )));
    }
    Ok(colors)
}

/// Parse a comma-separated list of hex colors.
pub fn parse_palette(raw_palette: &str) -> Result<Vec<Rgb>, Error> {
    split_palette(raw_palette)?
        .into_iter()
        .map(hex_to_rgb)
        .collect()
}

/// Parse a comma-separated target palette, where any entry may be
/// `transparent`/`none`.
pub fn parse_target_palette(raw_palette: &str) -> Result<Vec<Target>, Error> {
    split_palette(raw_palette)?
        .into_iter()
        .map(parse_target_color)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_color_mapping_parses_hex_pair() {
        assert_eq!(
            parse_color_mapping("#FFFFFF=#FF0000").unwrap(),
            ([255, 255, 255], Target::Color([255, 0, 0]))
        );
    }

    #[test]
    fn parse_target_color_accepts_transparent_keywords() {
        assert_eq!(
            parse_target_color("transparent").unwrap(),
            Target::Transparent
        );
        assert_eq!(parse_target_color(" NONE ").unwrap(), Target::Transparent);
        assert_eq!(
            parse_target_color("#FF0000").unwrap(),
            Target::Color([255, 0, 0])
        );
    }

    #[test]
    fn parse_color_mapping_accepts_transparent_target() {
        assert_eq!(
            parse_color_mapping("#FFFFFF=transparent").unwrap(),
            ([255, 255, 255], Target::Transparent)
        );
    }

    #[test]
    fn parse_color_mapping_rejects_malformed_input() {
        assert!(parse_color_mapping("#FFFFFF").is_err());
        assert!(parse_color_mapping("=#FFFFFF").is_err());
        assert!(parse_color_mapping("#FFFFFF=").is_err());
        assert!(parse_color_mapping("transparent=#FFFFFF").is_err());
    }

    #[test]
    fn parse_palette_allows_transparent_only_in_target_palette() {
        assert_eq!(
            parse_target_palette("#000000,transparent").unwrap(),
            vec![Target::Color([0, 0, 0]), Target::Transparent]
        );
        assert!(parse_palette("#000000,transparent").is_err());
    }

    #[test]
    fn parse_palette_accepts_comma_separated_hex_colors() {
        assert_eq!(
            parse_palette("#000000,808080, #FFFFFF ").unwrap(),
            vec![[0, 0, 0], [128, 128, 128], [255, 255, 255]]
        );
    }

    #[test]
    fn parse_palette_rejects_empty_entries_and_invalid_hex() {
        assert!(parse_palette("#000000,,#FFFFFF").is_err());
        assert!(parse_palette("#00000G").is_err());
        assert!(parse_palette("").is_err());
    }

    #[test]
    fn hex_to_rgb_reports_the_offending_value() {
        assert_eq!(
            hex_to_rgb("#12345").unwrap_err().to_string(),
            "Expected a 6-digit hex color, got: '12345'"
        );
    }
}
