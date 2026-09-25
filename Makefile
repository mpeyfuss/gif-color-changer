.PHONY: test lint fmt build wasm web web-dev

test:
	cargo test --workspace

lint:
	cargo fmt --all --check
	cargo clippy --workspace --all-targets -- -D warnings

fmt:
	cargo fmt --all

build:
	cargo build --release -p gif-color-changer

# Requires: rustup target add wasm32-unknown-unknown
#           cargo install wasm-bindgen-cli --version <wasm-bindgen version in Cargo.lock>
wasm:
	cd web && bun run wasm

web: wasm
	cd web && bun install --frozen-lockfile && bun run build

web-dev: wasm
	cd web && bun install && bun run dev
