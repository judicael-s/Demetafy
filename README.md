# Demetafy

**Leave Meta without leaving your memories behind.**

Meta gives you a *Download Your Information* archive: a pile of ZIP files, JSON, folders, and media that technically belongs to you, but rarely feels usable.

Demetafy turns that archive back into something human.

It rebuilds your Instagram and Facebook exports into a private desktop library: feeds, messages, saved posts, stories, albums, profile history, connections, and local media playback. No Demetafy account. No cloud import. No analytics business behind the curtain.

Your past should not stay locked inside the product that monetized it.

## What Demetafy does

Demetafy is a privacy-first desktop app for Meta DYI archives.

It helps you:

- Import Instagram and Facebook archive ZIPs.
- Browse messages, posts, stories, saved items, albums, connections, and profile changes.
- Search and revisit old threads, media, and memories from one local app.
- Play media from the original archive without uploading it anywhere.
- Recover some missing linked media when you explicitly start a download.
- Keep a usable copy of your social past after you stop using Meta.

It is not a Meta clone. It does not recreate the live social network, rankings, ads, notifications, streaks, or behavioral profiling. It gives you a quieter thing: your own archive, on your own machine, in a form you can actually use.

## Status

Demetafy is pre-1.0 software.

The current priority is a quality-first Windows public beta. The app already has a Solid.js and TypeScript interface, a Tauri 2 desktop shell, a Rust core, SQLite indexing, local media protocols, and support for Instagram and Facebook archive browsing.

Signed one-click Windows installers are not published yet. Until the public beta ships, Demetafy is best for developers, testers, and privacy-minded users comfortable building from source.

macOS and Linux are planned, but public binaries should be treated as coming soon until they have their own native verification pass.

## Why this exists

A Meta archive is supposed to be your way out.

In practice, it often feels like a box of receipts: technically complete, emotionally dead, and painful to search. The memories are there, but the experience that made them legible is gone.

Demetafy exists because leaving a platform should not mean burning a decade of your life.

The project has three commitments:

1. **Local by default:** archive parsing, indexing, browsing, search, and playback happen on your device.
2. **Honest network behavior:** Demetafy only touches the network when you choose a feature that requires it, such as missing-media recovery or the opt-in Instagram avatar fetch.
3. **Open source proof:** the privacy promise can be inspected, tested, and challenged in public.

## What you can browse

| Area | Current support |
|---|---|
| Feed | Chronological archive browsing, with account and service context |
| Messages | Threads, inline media, reactions, shared posts, search, and thread media galleries |
| Saved | Instagram saved posts and reels, grouped by collection |
| Stories and reels | Archived Instagram stories and reposts where Meta included them |
| Posts | Instagram posts and Facebook posts from the archive |
| Albums | Facebook photo albums |
| Connections | Followers, following, friends, close friends, blocked accounts, and related archive data |
| Profile | Profile information and change history |
| Search | Archive search across supported surfaces |
| Media viewer | Local image, video, and audio playback with keyboard-friendly navigation |
| Downloads | User-started recovery for linked media that Meta did not include as files |

Support depends on what Meta includes in your export. Demetafy cannot recover media that Meta never wrote to the archive and that is no longer available online.

## Privacy model

| Concern | How Demetafy handles it |
|---|---|
| Archive contents | Parsed locally and indexed into a local SQLite database |
| Media | Served from the ZIP archive or from user-started local downloads |
| Account | No Demetafy account exists |
| Telemetry | No analytics, silent crash upload, or behavior tracking |
| Network | Off by default for normal browsing. Used only for explicit missing-media downloads and the opt-in Instagram avatar feature |
| Diagnostics | Local and user-triggered. Reports are designed to avoid private messages, archive paths, cookies, handles, media, and raw personal content |
| Development data | Real archives, cookies, databases, and personal fixtures must never be committed |

Important: Demetafy should not be described as an app that *never* contacts Meta under every condition. Normal archive browsing is local. Some optional features use the network because the user asked them to.

## What is a DYI archive?

DYI means Meta's **Download Your Information** export.

It is the official way to request a copy of the data Meta stores for a profile. Facebook, Instagram, and Meta profiles are exported separately, even when they are linked in Accounts Center.

Demetafy needs the JSON version of that export.

When requesting your archive:

1. Open [Meta Accounts Center](https://accountscenter.meta.com/).
2. Go to **Your information and permissions**, then **Download your information**.
3. Choose one profile, for example Instagram or Facebook.
4. Select **All available information**.
5. Choose **Download to device**.
6. Set **Format** to **JSON**. HTML will not work.
7. Set **Media quality** to **Higher quality**.
8. Set **Date range** to **All time**.
9. Submit the request and wait for Meta's email.
10. Download every ZIP part before the link expires.

Large archives can be 50 GB to 100 GB or more. Make sure you have enough disk space and a stable connection.

## Install from source

### Prerequisites

You need:

- Node.js 20 or newer
- pnpm
- Rust
- Your platform's native build toolchain
- On Windows: MSVC Build Tools

### Run the desktop app

```bash
pnpm install
pnpm tauri:dev
```

### Build a production bundle

```bash
pnpm tauri:build
```

### Optional downloader sidecar

Some saved posts and shared videos are stored by Meta as links rather than files. Demetafy can try to recover still-available media through a bundled `yt-dlp` binary, but that binary is not committed to the repository.

Before `tauri:dev` or `tauri:build`, place the correct binary in `src-tauri/binaries/` for your target platform.

On Windows, the expected filename is:

```bash
src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe
```

If missing-media downloads fail, first check whether the bundled `yt-dlp` binary is present and current.

## Developer commands

```bash
pnpm typecheck
pnpm test
pnpm lint
cargo test --manifest-path src-tauri/Cargo.toml
```

The repository also includes a read-only command-line viewer for archive inspection:

```bash
pnpm demetafy saved list <archive.zip>
pnpm demetafy messages list <archive.zip>
pnpm demetafy ingest <archive.zip>
pnpm demetafy search <query>
```

## Contributing

Contributions are welcome, especially around parser coverage, privacy review, Windows beta hardening, accessibility, large-archive performance, release engineering, and synthetic test fixtures.

Before contributing, read [CONTRIBUTING.md](CONTRIBUTING.md).

The most important rule: **never commit real personal data.**

Do not commit:

- Meta archive ZIPs
- Real media from an archive
- Cookie files
- SQLite databases created from real accounts
- Real handles, names, messages, captions, emails, locations, or private identifiers in tests or comments

Use synthetic fixtures only.

To enable the repository safety hook:

```bash
git config core.hooksPath .githooks
```

## Security

Please report vulnerabilities privately through GitHub's **Security** tab instead of opening a public issue.

Areas worth special attention:

- Malformed or hostile ZIP archives
- JSON parsing and archive shape changes
- WebView to Rust IPC boundaries
- Custom `vmedia://` and `dmedia://` protocols
- `yt-dlp` argument handling and URL validation
- The opt-in Instagram avatar fetch
- Local diagnostics redaction

See [SECURITY.md](SECURITY.md) for details.

## Roadmap

The near-term goal is a trustworthy Windows public beta that a non-technical user can install, understand, and use without developer tools.

Release gates include:

- Frozen beta scope and acceptance criteria
- Passing typecheck, lint, TypeScript tests, Rust tests, audits, and production builds
- Pinned and verified downloader sidecar
- Accurate privacy and network disclosures
- Signed Windows installer artifacts
- Clean Windows 11 acceptance testing
- Checksums, release notes, troubleshooting, and support templates
- No real archive data, cookies, identities, databases, or media in repository or release artifacts

After Windows beta, Demetafy can expand toward macOS, Linux, more Meta surfaces, and a public website. The principle stays the same: your archive should remain yours.

## License and brand

Demetafy is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).

The source is open. The name and brand are reserved.

Created and maintained by [Judicael](https://github.com/judicael-s).
