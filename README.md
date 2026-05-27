# Demetafy

**A privacy-first desktop viewer for your Meta data exports.** Drop in your "Download Your Information" archive and browse your Instagram saved posts, messages, stories, reposts, profile, and connections in a familiar, Instagram-style interface — fully offline, on your own machine, for as long as you like.

Demetafy parses your archive locally, can re-fetch still-available media that Meta leaves out of the export (saved reels, posts shared in DMs), and never sends your data anywhere.

---

## Why

Your Meta archive is a ZIP full of raw JSON and loose media files — technically "your data," practically unreadable. Demetafy turns it back into something you can actually browse, keep, and own:

- **Local-only.** No servers, no accounts, no telemetry. Your archive never leaves your device.
- **Small and sandboxed.** Built on [Tauri](https://tauri.app) (Rust + the OS WebView), not Electron — a ~10 MB app with tight filesystem and process permissions instead of a bundled 100 MB browser. The web layer can't spawn processes or read arbitrary files; the media downloader (`yt-dlp`) is launched only by the Rust core with a fixed argument template.
- **Yours to keep.** Once imported, everything works offline indefinitely — even if you later delete your account.

## What you can browse

- **Saved** — saved posts and reels, grouped by collection, as an image-first grid.
- **Messages** — full DM history with inline photos, videos, voice notes, reactions, and shared posts; a per-thread media gallery and in-conversation search.
- **Stories**, **Reposts**, **Profile** (including change history), your own **Posts**, and **Connections** (followers / following / close friends / blocked).
- **Recover missing media.** Saved reels and posts shared into DMs are stored by Meta as bare links, not files. Demetafy fetches the still-available ones with a bundled `yt-dlp` — one at a time, a whole conversation at once, or your entire archive — and plays them back offline.

## Privacy at a glance

| Concern | How Demetafy handles it |
|---|---|
| Where your data lives | A local SQLite index for metadata; media is served straight from the ZIP. Nothing is uploaded. |
| Process permissions | The WebView has no process-spawn capability; `yt-dlp` runs only from Rust with fixed arguments. |
| Footprint | A Tauri shell over the OS WebView (~10 MB), not a bundled Chromium. |
| Network | Only optional, user-initiated media fetches ever touch the network. |

## Supported archives

Demetafy reads Meta "Download Your Information" (DYI) exports.

- **Instagram** — supported today.
- **Facebook**, **Threads** — on the roadmap (below).
- **WhatsApp** and mobile apps — later, and conditional.

Meta exports one Accounts Center profile per archive, so request your Instagram export specifically. Content other people created (for example, photos others tagged you in) lives in *their* archive, not yours, and isn't included.

## Getting your archive

Request an export from Meta: **Accounts Center → Your information and permissions → Download your information**. Choose your Instagram profile, set the format to **JSON** and media quality to the **highest** option. The download link Meta emails you expires a few days after it's ready, so grab it promptly.

## Development

Prerequisites: **Node** + **pnpm**, and **Rust** with your platform toolchain (on Windows, the MSVC Build Tools).

```bash
pnpm install            # one-time

pnpm tauri:dev          # run the desktop app (Vite + Tauri shell)
pnpm tauri:build        # production bundle (MSI / DMG / AppImage)

pnpm typecheck          # tsc (Node + UI projects)
pnpm test               # vitest
pnpm lint               # eslint
```

Rust unit tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

### yt-dlp sidecar

The media downloader uses a bundled `yt-dlp` binary that is **not committed** (per-platform, ~18 MB each). Before `tauri:dev` / `tauri:build`, place one in `src-tauri/binaries/` named for your target triple — on Windows:

```bash
cp "$(which yt-dlp)" src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe
```

`yt-dlp` tracks Instagram's changes closely; if downloads start failing, update the binary first.

### Command-line viewer

A read-only CLI can inspect an archive without building the desktop app:

```bash
pnpm demetafy saved list <archive.zip>
pnpm demetafy messages list <archive.zip>
pnpm demetafy stories <archive.zip>
pnpm demetafy ingest <archive.zip>     # build a local SQLite index
pnpm demetafy search <query>
```

## Project status

**Phase 1 — the Instagram desktop app — is feature-complete.** Roadmap:

- **Phase 2** — Facebook support (a second parser pack: timeline, albums, Messenger).
- **Phase 3** — Threads, plus release polish (code-signing, notarization, onboarding).
- **Phase 4** — Mobile + WhatsApp (deferred, conditional on the desktop product succeeding).

## Limitations

Some things are inherent to what Meta does — or doesn't — put in the export:

- **Deleted posts can't be recovered.** Saved or shared links to removed posts surface as "no longer available."
- **Login-walled content** increasingly needs a logged-in cookie jar for `yt-dlp` to fetch it.
- **Some DM media is excluded by Meta** — View Once, Vanishing Mode, and Unsent messages are never written to the export.
- **Facebook compresses photos on upload**; the export returns Meta's stored copy, not your pre-upload original.

## License & attribution

Licensed under the GNU Affero General Public License, version 3 or later (**AGPL-3.0-or-later**).

Created and maintained by **Judicael** ([@judicael-s](https://github.com/judicael-s)).
**"Demetafy" is a registered name** — the source is open under AGPL-3.0, but the name and brand are reserved.
