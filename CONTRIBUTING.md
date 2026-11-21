# Contributing

## Layout

| Path             | What                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| `extension.toml` | Zed manifest: registers the `blade-html` language server for the `Blade` language       |
| `src/lib.rs`     | The extension (Rust → wasm32-wasip2): writes the embedded server bundle and starts it   |
| `server/src/`    | The language server (TypeScript): Blade masking, web-types, HTML features               |
| `server/test/`   | Unit tests (masking, web-types, features) and end-to-end tests on the bundle over stdio |
| `server/dist/`   | The bundled server — **committed**: Zed builds extensions with `cargo` only             |

How it works: `server/src/blade.ts` replaces every Blade construct (`{{ }}`, `{!! !!}`, comments,
directives with their arguments, `@php` blocks, `<?php ?>`) with spaces, keeping the length and
the line breaks, so `vscode-html-languageservice` sees plain HTML at the same positions. Requests
inside Blade code return nothing; the PHP servers answer those.

## Environment

Everything runs in the flake dev shell: `nix develop`, or automatically with direnv
(`direnv allow` once). It provides rustup, Node.js, Biome, nixfmt and make; the Rust toolchain
and the `wasm32-wasip2` target come from `rust-toolchain.toml`.

```sh
make setup   # rustup toolchain + npm ci
make fmt     # rustfmt, Biome (format, imports, safe fixes), nixfmt
make lint    # formatting check, clippy (-D warnings), Biome lint, tsc, nixfmt --check
make test    # cargo test + server unit and end-to-end tests
make build   # server bundle + extension wasm
make check   # what CI runs: lint, test, and server/dist matching the sources
```

Try a change in Zed: `make server`, then `zed: install dev extension` and pick this directory
(Zed needs `rustup` on its `PATH`). After later changes: `make server` and **Rebuild** in the
extensions page. Server logs: `dev: open language server logs` → `blade-html`.

## Workflow

- Every change goes through a branch and a pull request; nobody commits or pushes to `main`
  directly. Branch names follow the commit type: `feat/…`, `fix/…`, `ci/…`, `docs/…`.
- Commits and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>(<scope>): <short description>`, e.g. `fix(server): keep Vue @event attributes inside
  Blade tags`. Scopes: `server`, `extension`, `ci`, `nix`, `deps`. Formatting-only changes go in
  their own `style:` commit.
- One concern per pull request. Every commit should make sense on its own: pull requests are
  usually merged with **Rebase**, which keeps them; a branch with fix-up commits is squashed.
- `main` is protected by two rulesets: a pull request gets in only when the **CI result** check
  passed (linear history, no force pushes or deletion), and only the owner merges.
  Documentation-only changes skip the heavy CI job; CI result still reports.
- Server changes are committed together with the rebuilt `server/dist` (`make server`);
  `make check` fails when the bundle does not match the sources.

## Definition of done

Always: `make check` and `make build`. A change to what users see in Zed is also tried there
with the dev extension.

## Tests

- Masking changes (`blade.ts`) need cases in `server/test/blade.test.ts`: the masked HTML must keep
  the length and the line breaks, mask the Blade code and keep the markup around it.
- web-types changes need cases in `server/test/webTypes.test.ts`; feature changes in
  `server/test/service.test.ts`, and in `server/test/server.test.ts` when the LSP wiring changes.
- A test for a bug should fail without the fix; say in the pull request that you checked.

## Pull requests

Opening a pull request fills in [the template](.github/pull_request_template.md). Keep its
sections, and fill in **AI assistance** every time:

- whether an AI tool wrote or changed any part of the pull request (code, tests, docs, the
  description itself);
- if so, the tool and the exact model (e.g. Claude Code, `claude-opus-5-5`), and what it did.

No "Generated with …" lines or AI co-author trailers in commits or descriptions: the AI section
says it once, in a form every pull request shares.

Comments in code say why, never the history.
