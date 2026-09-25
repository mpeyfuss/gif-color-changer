//! Replace colors across every frame of a GIF.
//!
//! Usage:
//!     gifcc input.gif output.gif --map "#FFFFFF=#FF0000" --map "#000000=#00FF00"
//!     gifcc input.gif output.gif --source-palette "#000000,#FFFFFF" --target-palette "#222222,#EEEEEE"

use std::path::PathBuf;
use std::process::ExitCode;
use std::{fmt, fs};

use clap::error::ErrorKind;
use clap::{CommandFactory, Parser};
use gifcc_core::{
    Distance, Error, Rgb, Target, decode, encode, format_rgb, parse_color_mapping, parse_palette,
    parse_target_palette, recolor_gif, rewrite_gif_palette, validate_palette_mapping,
};

const DEFAULT_TOLERANCE: i32 = 50;
const DEFAULT_SOFTNESS: i32 = 25;

const EXAMPLES: &str = "\
Examples:
  gifcc input.gif output.gif --map \"#FFFFFF=#FF0000\" --map \"#000000=#00FF00\"
  gifcc input.gif output.gif --source-palette \"#000000,#FFFFFF\" --target-palette \"#222222,#EEEEEE\"";

#[derive(Parser)]
#[command(
    name = "gifcc",
    version,
    about = "Replace colors across every frame of a GIF.",
    after_help = EXAMPLES
)]
struct Args {
    /// Path to input GIF
    input: PathBuf,

    /// Path to output GIF
    output: PathBuf,

    /// Color mapping in FROM=TO format, e.g. '#FFFFFF=#FF0000'. The TO color
    /// may be 'transparent' (or 'none') to make matched pixels fully
    /// transparent. Can be repeated.
    #[arg(long = "map", value_name = "FROM=TO")]
    color_mappings: Vec<String>,

    /// Comma-separated source palette colors, e.g. '#000000,#808080,#FFFFFF'.
    #[arg(long, value_name = "COLORS")]
    source_palette: Option<String>,

    /// Comma-separated target palette colors, e.g. '#1D3557,#E63946,#F1FAEE'.
    /// Any entry may be 'transparent' (or 'none') to make pixels in that
    /// bucket fully transparent.
    #[arg(long, value_name = "COLORS")]
    target_palette: Option<String>,

    /// Palette color distance mode: 'rgb' or 'weighted-rgb'. Default: rgb
    #[arg(long)]
    distance: Option<String>,

    /// Palette mode only: number of edge-cleanup passes. Each pass reassigns
    /// isolated pixels to the palette bucket that dominates their
    /// neighborhood, while leaving real edges intact. Default: 0 (off).
    #[arg(long, allow_negative_numbers = true)]
    cleanup: Option<i64>,

    /// How close a pixel must be to the source color (0-255). Default: 50
    #[arg(long, allow_negative_numbers = true)]
    tolerance: Option<i32>,

    /// Blend pixels near the edge of the tolerance range instead of fully
    /// replacing them. Default: 25
    #[arg(long, allow_negative_numbers = true)]
    softness: Option<i32>,
}

enum Job {
    Map {
        mappings: Vec<(Rgb, Target)>,
        tolerance: i32,
        softness: i32,
    },
    Palette {
        source: Vec<Rgb>,
        target: Vec<Target>,
        distance: Distance,
        cleanup: u32,
    },
}

/// Exit with a usage error (status 2), like argparse's `parser.error`.
fn usage_error(message: impl fmt::Display) -> ! {
    Args::command()
        .error(ErrorKind::ArgumentConflict, message)
        .exit()
}

fn validate(args: &Args) -> Job {
    let palette_mode = args.source_palette.is_some() || args.target_palette.is_some();
    let tolerance_mode = !args.color_mappings.is_empty();

    if palette_mode && tolerance_mode {
        usage_error("--map cannot be combined with palette mode");
    }
    if !palette_mode && !tolerance_mode {
        usage_error("expected --map or both --source-palette and --target-palette");
    }

    if palette_mode {
        let (Some(source), Some(target)) = (&args.source_palette, &args.target_palette) else {
            usage_error("palette mode requires both --source-palette and --target-palette");
        };
        if args.tolerance.is_some() {
            usage_error("--tolerance cannot be used with palette mode");
        }
        if args.softness.is_some() {
            usage_error("--softness cannot be used with palette mode");
        }
        let cleanup = args.cleanup.unwrap_or(0);
        if cleanup < 0 {
            usage_error("--cleanup must be 0 or greater");
        }

        let parsed = (|| -> Result<Job, Error> {
            let source = parse_palette(source)?;
            let target = parse_target_palette(target)?;
            validate_palette_mapping(&source, &target)?;
            let distance = args.distance.as_deref().unwrap_or("rgb").parse()?;
            Ok(Job::Palette {
                source,
                target,
                distance,
                cleanup: u32::try_from(cleanup).unwrap_or(u32::MAX),
            })
        })();
        parsed.unwrap_or_else(|error| usage_error(error))
    } else {
        let tolerance = args.tolerance.unwrap_or(DEFAULT_TOLERANCE);
        let softness = args.softness.unwrap_or(DEFAULT_SOFTNESS);

        if softness < 0 {
            usage_error("--softness must be 0 or greater");
        }
        if args.distance.is_some() {
            usage_error("--distance can only be used with palette mode");
        }
        if args.cleanup.is_some() {
            usage_error("--cleanup can only be used with palette mode");
        }

        let mappings = args
            .color_mappings
            .iter()
            .map(|mapping| parse_color_mapping(mapping))
            .collect::<Result<Vec<_>, _>>()
            .unwrap_or_else(|error| usage_error(error));
        Job::Map {
            mappings,
            tolerance,
            softness,
        }
    }
}

fn run(args: &Args, job: Job) -> Result<(), String> {
    println!("Processing frame(s)...");

    let bytes = fs::read(&args.input)
        .map_err(|e| format!("failed to read {}: {e}", args.input.display()))?;
    let mut animation =
        decode(&bytes).map_err(|e| format!("failed to decode {}: {e}", args.input.display()))?;

    match job {
        Job::Map {
            mappings,
            tolerance,
            softness,
        } => {
            let counts = recolor_gif(&mut animation, &mappings, tolerance, softness);
            for ((from_rgb, to_color), count) in mappings.iter().zip(counts) {
                println!(
                    "{} -> {to_color}: changed {count} pixel(s)",
                    format_rgb(*from_rgb)
                );
            }
        }
        Job::Palette {
            source,
            target,
            distance,
            cleanup,
        } => {
            let counts = rewrite_gif_palette(&mut animation, &source, &target, distance, cleanup)
                .map_err(|e| e.to_string())?;
            for ((from_rgb, to_color), count) in source.iter().zip(&target).zip(counts) {
                println!(
                    "{} -> {to_color}: assigned {count} pixel(s)",
                    format_rgb(*from_rgb)
                );
            }
        }
    }

    let output = encode(&animation).map_err(|e| format!("failed to encode GIF: {e}"))?;
    fs::write(&args.output, output)
        .map_err(|e| format!("failed to write {}: {e}", args.output.display()))?;
    println!("Saved: {}", args.output.display());
    Ok(())
}

fn main() -> ExitCode {
    let args = Args::parse();
    let job = validate(&args);
    match run(&args, job) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("error: {message}");
            ExitCode::FAILURE
        }
    }
}
