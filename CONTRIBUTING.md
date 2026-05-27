# Contributing to Demetafy

Thanks for your interest. Demetafy is a **privacy-first, local-only** desktop viewer for Meta "Download Your Information" (DYI) archives — so the rules below are stricter than usual about data.

## The one rule that matters: never commit real personal data

This is a public repository. Treat every commit as permanent and world-readable.

- **Never commit a real Meta archive, export, media file, or cookie jar.** Real `.zip` / media / cookie files belong only in the **gitignored `data/`** directory.
- **Test fixtures must be synthetic.** Use invented values — e.g. `example_user`, `Alex Rivera`, `someone@example.com`, placeholder dates. Never paste a real message, caption, email, handle, location, or other personal detail from an actual archive into a test or a comment.
- Need a real archive to develop against? Keep it in `data/` (already ignored) — it will never be staged.

## Turn on the safety net (one-time, per clone)

The repo ships a pre-commit hook that blocks accidental commits of secrets, credentials, and real archive/media files:

```bash
git config core.hooksPath .githooks
```

Optionally drop a personal, gitignored blocklist at `.githooks/blocklist.local` (one term per line) to also catch your own sensitive strings — it never leaves your machine. GitHub secret-scanning + push protection are enabled on the repo as a second line of defense.

## Development setup

Prerequisites: **Node** + **pnpm**, and **Rust** + your platform toolchain (on Windows, the MSVC Build Tools).

```bash
pnpm install            # one-time
pnpm tauri:dev          # run the desktop app (Vite + Tauri shell)
pnpm typecheck          # tsc (Node + UI projects)
pnpm test               # vitest
pnpm lint               # eslint
cargo test --manifest-path src-tauri/Cargo.toml
```

The bundled `yt-dlp` sidecar is **not committed** (per-platform binary). Before `tauri:dev` / `tauri:build`, place one in `src-tauri/binaries/` named for your target triple — on Windows:

```bash
cp "$(which yt-dlp)" src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe
```

## Pull requests

- Keep changes focused; add tests for parser/logic changes.
- Ensure `pnpm typecheck`, `pnpm test`, and `cargo test` pass, and that the pre-commit hook passes (don't `--no-verify` unless you are certain it's a false positive).
