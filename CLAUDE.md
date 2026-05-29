# Demetafy

Privacy-first desktop archive viewer for Meta data. Users drop in their DYI (Download Your Information) exports from Facebook, Instagram, Messenger, and Threads. Demetafy parses the archives locally, downloads still-missing content (saved videos via permalinks), and presents everything in a faithful Instagram/Facebook-style UI they can browse offline forever.

**Out of initial scope (Phases 0–3):** WhatsApp + mobile apps. Both deferred to Phase 4, conditional on the desktop product succeeding.
**Excluded by Meta:** content others created (photos others tagged you in live in their archive, not yours).

## Current phase

**Phase 1 feature-complete** — Steps 7–15 done: Tauri shell + full browsing UI (Home, Saved, Messages with inline media, Stories, Reposts, Profile, Posts), the yt-dlp sidecar downloader (queue, progress dock, inline playback), the first-run ingest flow (native picker, streaming progress, archive-type gate, friendly errors, Settings re-import), and the Windows build + a11y/icon/theme polish (Step 15 ships an unsigned `.msi`/NSIS). **Remaining before Phase 1 done:** a display/VM pass (fps, per-route empty states, clean-VM artifact run) + the Phase 1 acceptance checklist in `tasks/todo.md`. Phase 0 (CLI pipeline) completed 2026-05-19. See `tasks/todo.md` for live status.

## Phase plan

- **Phase 0 — CLI on Alex' archive (1–2 weeks).** Validates the full parse → download → view pipeline against real data. Real archives expose edge cases public users will hit.
- **Phase 1 — Tauri 2 desktop MVP (3–4 weeks).** Instagram-feel UI for profile / saved / DMs / stories. Cross-platform binary.
- **Phase 2 — Facebook support (2–3 weeks).** Same shell, second parser pack; UI surfaces for timeline, albums, Messenger.
- **Phase 3 — Threads + release polish.** Code-signing, notarization, onboarding flow, public release.
- **Phase 4 — Mobile + WhatsApp (deferred, conditional).** Triggered only if Phases 0–3 ship and reach a viable user base. iOS + Android via Tauri 2 mobile (or React Native if needed); WhatsApp parser pack (different export shape than Meta DYI — closer to a new product than a new parser).

## Stack

- **Shell:** Tauri 2 (Rust + WebView). ~10MB bundle, strong sandboxing, sidecar process support.
- **Frontend:** TypeScript + Solid.js or React + Tailwind. Parser code stays in pure TS so it can be reused in a browser-only viewer if needed.
- **Storage:** SQLite (Tauri plugin) for indexed metadata; filesystem for media files.
- **Video fetching:** `yt-dlp` bundled as a Tauri sidecar binary, called per saved permalink.
- **Build:** `pnpm` (frontend) + `cargo` (Rust).

**Why Tauri over Electron:** the privacy story IS the product. A "leave Meta" app shipping a 100MB Electron + Chromium bundle, with broad filesystem access by default, would undercut its own marketing.

## Module layout (proposed — not yet implemented)

```
src/
├── parsers/
│   ├── instagram/
│   │   ├── posts.ts
│   │   ├── saved.ts
│   │   ├── collections.ts
│   │   ├── messages.ts
│   │   ├── stories.ts
│   │   └── encoding.ts       # Latin-1 mojibake fix
│   ├── facebook/
│   │   ├── posts.ts
│   │   ├── photos.ts
│   │   └── messages.ts
│   └── shared/
│       └── archive.ts        # zip extraction, split-archive handling
├── downloaders/
│   └── ytdlp.ts              # sidecar wrapper, queue, retry
├── storage/
│   ├── db.ts                 # SQLite schema + queries
│   └── media.ts              # filesystem media management
└── ui/
    ├── profile/
    ├── saved/
    ├── dms/
    └── stories/
```

## Non-obvious gotchas

1. **Latin-1-over-UTF-8 mojibake.** Meta emits each UTF-8 byte as a separate `\u00XX` JSON escape, so multi-byte chars arrive as runs of Latin-1-range codepoints — `"Café"` shows up as `"CafÃ©"`. Fix: read the parsed string's codepoints back as Latin-1 bytes, then decode as UTF-8. Affects ALL message text, captions, names. Failing to fix this is the #1 archive-parser bug in the wild.
2. **Archive splitting (multi-part).** Big DYI exports split into N independent, complete `.zip` parts (verified: 7 parts / ~17 GB for Facebook). Each opens standalone (own central directory; NOT a spanned `.z01` set), named `{service}-{user}-{date}-{8char-random}.zip` — the random suffix means **no part number, order, or count in the filename**. One logical tree is split **file-level** across parts (a thread's JSON and its media often sit in different parts), cleanly partitioned (no cross-part path dupes). JSON exports ship **no manifest / `start_here.html` / part-count**, so completeness isn't auto-detectable — the import flow surfaces the count and has the user confirm all parts are present. Demetafy **virtually merges** (no disk extraction): open all parts, merge entry indexes in memory, resolve each `vmedia` entry to its owning part (`MergedArchiveReader` in TS, `media.rs` in Rust). Applies to Facebook and Instagram alike.
3. **yt-dlp is a moving target.** Instagram changes HTML/endpoints every few weeks; yt-dlp updates within days. Pin a version and auto-prompt update on failure.
4. **Saved permalinks decay.** If the original poster deleted the post, the permalink is dead. `saved_posts.json` only stores references (permalink + folder + timestamp), no media — so deleted posts can't be reconstructed from the archive. Surface as "no longer available" in UI rather than failing.
5. **Login-walled content needs cookies.** yt-dlp can fetch private accounts the user follows only with a logged-in cookie jar — and Meta increasingly login-walls *public* content too, so cookies are needed more often than just for private accounts. Acceptable for Phase 0 personal use; opt-in only for public app.
6. **DYI download URL expires.** Meta's email contains a download link that expires ~4 days after notification.
7. **FB photo resolution.** Facebook compresses on upload. Even with the "Higher quality" DYI setting (the highest option Meta offers), the original-quality source is gone unless the user uploaded with HD enabled. The DYI returns Meta's stored copy, not the pre-upload original.
8. **Massive archives.** Power-user archives can be 50–100+ GB. Streaming parse > load-into-memory.
9. **DM media has silent exclusions.** Direct-message archives include text + most media files, but **exclude**: View Once / Allow Replay media (never written), Vanishing Mode messages (never written), and Unsent messages (removed server-side). Don't surface "missing media" errors for these — they're working as designed. The JSON references will simply not point to the excluded files.
10. **E2EE chats: Instagram separate, Facebook inline.** Instagram deprecated E2EE DMs on 2026-05-08; pre-deprecation E2EE threads live in a PIN-gated "secure storage" download, NOT the main IG DYI — handle a separate `instagram-e2ee/` root or document the gap, and verify per IG archive. **Facebook diverges:** it folds E2EE-cutover threads *inline* into the main DYI as readable plaintext under an `e2ee_cutover/` message category (same shape as `inbox`), so the FB parser treats it as just another thread category — no separate export.
11. **Per-profile DYI separation.** Meta exports one Accounts Center profile at a time (Facebook, Instagram, and "Meta" — the latter covers Threads/Meta AI/Quest). No bundled export exists even for linked accounts. Each archive lands separately with its own internal layout; parser pack selection should be driven by archive root, not user input.
12. **IG friend-avatar fetch is a deliberate network carve-out.** The opt-in "Fetch Instagram profile pictures" (Settings → OFF by default) is the ONE feature that calls Meta: a bespoke `web_profile_info` scraper (`src-tauri/src/avatars.rs`) gated on the user's cookie jar, throttled (~1.5s), cached under `downloads/avatars/ig/` and served via `dmedia://`. Unofficial endpoint → expect periodic breakage (a fetch returns `error`; the UI keeps the monogram). Facebook is unsupported (its connections export has no handle). Everything else stays strictly local. Full spec: `.claude/plans/ig-avatar-fetch.md`.
13. **Media is served as capped range chunks, not whole files.** Both `vmedia://` (zip) and `dmedia://` (disk) stream only the requested byte range and **cap open-ended `bytes=0-` to 4 MB** — a 206 deliberately returns *less* than asked; the WebView fetches more as playback advances (don't "fix" the short response). `Stored` zip entries seek to `data_start` (Meta stores media uncompressed); `Deflated` falls back to a whole-entry read. Responses carry `Cache-Control: immutable` + a strong ETag with 304s. See `respond_ranged` in `src-tauri/src/media.rs`.

## Out of scope (explicitly)

- Public app servers / cloud infrastructure (architecture is local-only).
- Live mirroring of Meta accounts (no compliant API path).
- Photos others tagged the user in (lives in their archive, not Alex').
- Live videos that have expired on Meta's side.
- Scraping / credential-based login flows — **except** the opt-in IG friend-avatar fetch (off by default; the one sanctioned network call — see gotcha #12).

WhatsApp and mobile apps are *deferred* (Phase 4, conditional on Phase 0–3 success), not permanently out of scope. See phase plan.

## Commands

```bash
pnpm install              # one-time
pnpm typecheck            # tsc on Node project + tsc on UI project
pnpm test                 # vitest run
pnpm lint                 # eslint .
pnpm demetafy <cmd> ...    # Phase 0 CLI via tsx (no build step)

# Phase 1 — Tauri 2 desktop app (Windows needs Rust + MSVC Build Tools)
pnpm dev:ui               # vite dev server only (no Tauri shell)
pnpm build:ui             # vite build → dist/ui/
pnpm tauri:dev            # spawn vite + Tauri shell together
pnpm tauri:build          # production bundle (MSI / DMG / AppImage)
```

**yt-dlp sidecar is gitignored, not committed.** Before `tauri:dev`/`tauri:build` (or in-app downloads will fail), copy a per-platform yt-dlp into `src-tauri/binaries/` named `yt-dlp-<target-triple><ext>` — on Windows: `cp "$(scoop apps/.../yt-dlp.exe)" src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe`. Declared via `externalBin: ["binaries/yt-dlp"]` in `tauri.conf.json` (the SOURCE path), but spawned from Rust with the **basename** `app.shell().sidecar("yt-dlp")` — Tauri resolves it next to the exe (`<exe_dir>/yt-dlp<ext>`). Passing the `binaries/yt-dlp` config path to `sidecar()` makes the spawn fail with "path not found" (os error 3); fixed 2026-05-26. Only the Windows binary exists locally; mac/Linux sidecars get added when building on those hosts (the build step fails without the matching-triple binary) — see the cross-platform build notes in `tasks/todo.md`.

CLI subcommands (Phase 0):

```bash
# read-only archive inspectors
pnpm demetafy saved list <archive.zip> [-n 10]
pnpm demetafy messages list <archive.zip> [-n 20] [--include-requests] [--include-broadcast]
pnpm demetafy messages show <archive.zip> <slug>   # substring match on thread folder name
pnpm demetafy stories <archive.zip> [-n 15]
pnpm demetafy reposts <archive.zip> [-n 10]
pnpm demetafy posts <archive.zip>
pnpm demetafy profile <archive.zip>

# media downloader (yt-dlp must be on PATH)
pnpm demetafy saved download <archive.zip> [-c <collection>] [-n N] [-p N] [--cookies <file>]

# SQLite index + search
pnpm demetafy ingest <archive.zip> [-d data/index.sqlite]
pnpm demetafy stats [-d data/index.sqlite]
pnpm demetafy search <query> [-d data/index.sqlite] [-n 10]

# local web viewer
pnpm demetafy serve [-d data/index.sqlite] [-p 5173] [-m data/extracted/instagram/saved]
```

`saved download` requires `yt-dlp` on PATH (`scoop install yt-dlp` on Windows). Default `--parallel 3` is aggressive — Instagram rate-limits (HTTP 429) at >1 concurrent in practice; lower it if you see frequent retries.

Phase 0 uses Node 24's built-in `node:sqlite` (SQLite 3.51, FTS5) — no native compile, no `better-sqlite3`. Phase 1's Tauri shell will switch to `tauri-plugin-sql` for the same data, but the schema in `src/storage/db.ts` is the canonical reference.

Archive lives under `data/archives/instagram/` (gitignored). Reference path in this session: `data/archives/instagram/instagram-example_user-2026-05-14-yailYno5.zip`.

## Workflow notes

- See `CONTRIBUTING.md` for the rules that matter — especially: **never commit real archives, cookies, or personal data; test fixtures must be synthetic.**
- Enable the pre-commit guard once per clone: `git config core.hooksPath .githooks`.
