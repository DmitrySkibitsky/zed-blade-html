# Development tasks. Run inside the dev shell (`nix develop`, or automatically via direnv).
#
#   make setup    install toolchains/dependencies (rustup toolchain from rust-toolchain.toml, npm ci)
#   make fmt      format everything (rustfmt, Biome, nixfmt)
#   make lint     check formatting + linters + types (no changes)
#   make test     Rust unit tests + server unit and end-to-end tests
#   make build    language server bundle + extension wasm
#   make check    everything CI runs: lint, test, committed bundle up to date

SERVER := server
WASM_TARGET := wasm32-wasip2

.PHONY: setup fmt lint lint-rust lint-server lint-nix test test-rust test-server build server wasm dist-check check clean

setup:
	rustup toolchain install
	cd $(SERVER) && npm ci

fmt:
	cargo fmt
	biome check --write .
	nixfmt flake.nix

lint: lint-rust lint-server lint-nix

lint-rust:
	cargo fmt --check
	cargo clippy --target $(WASM_TARGET) -- -D warnings
	cargo clippy --all-targets -- -D warnings

lint-server:
	biome ci .
	cd $(SERVER) && npm run typecheck

lint-nix:
	nixfmt --check flake.nix

test: test-rust test-server

test-rust: server
	cargo test

test-server:
	cd $(SERVER) && npm test

server:
	cd $(SERVER) && npm run build

wasm: server
	cargo build --release --target $(WASM_TARGET)

build: wasm

# Zed builds the extension with cargo only, so the bundle the wasm embeds is committed:
# a fresh build must match the committed (or staged) one.
dist-check: server
	@if ! git diff --quiet -- $(SERVER)/dist || [ -n "$$(git ls-files --others --exclude-standard -- $(SERVER)/dist)" ]; then \
		echo "$(SERVER)/dist is out of date: run 'make server' and commit the bundle"; \
		git status --short -- $(SERVER)/dist; \
		exit 1; \
	fi

check: lint test dist-check

clean:
	cargo clean
	rm -rf $(SERVER)/node_modules
