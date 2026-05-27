# Demetafy

### Your life is on their servers. Bring it home.

Meta will hand you a *"Download Your Information"* archive — a ZIP full of raw JSON and loose media that's technically **your data** and practically unreadable. Meanwhile the version you actually lived in — the feed, the DMs, the saved reels, the late-night stories — stays on **their** servers: mined, ranked, monetized, and one policy change away from gone.

**Demetafy flips that.** It rebuilds your archive into the familiar, scrollable app you remember — running entirely on your own machine, answerable to no one. Every thread you stayed up too late sending, every reel you saved and forgot, every story from a version of yourself you barely recognize now: a scrapbook of an entire era of your life, yours to wander back through, offline, for as long as you like.

Leaving Meta shouldn't mean torching your memories. Deleting your account shouldn't cost you a decade. **Demetafy is how you keep the archive and walk away.**

---

## Why this exists

Surveillance is the business model. The product was never the app — it was you, made legible and sold by the impression. "Download Your Information" is the escape hatch they're legally required to give you, and they make it as joyless as possible: thousands of cryptic JSON files no human was meant to open.

Demetafy is a small act of refusal. It takes the box of receipts they begrudgingly handed back and turns it into something warm again — something you own.

- **Local-only. Always.** No servers, no sign-up, no telemetry, no phone-home. Your archive never leaves your device — there is nowhere for it to go.
- **Small and sandboxed.** Built on [Tauri](https://tauri.app) (Rust + the OS WebView), **not** Electron — a ~10 MB app with tight filesystem and process permissions instead of a bundled 100 MB browser. The web layer can't spawn processes or read arbitrary files; the one media-downloader process is launched only by the Rust core, with a fixed argument template.
- **Yours to keep.** Once imported, everything works offline indefinitely — even after you delete your account and the originals are gone for good.

A privacy app that shipped a bloated browser engine with broad disk access would undercut its own marketing. So Demetafy doesn't. The privacy story *is* the product.

## What you can browse

Instagram is supported today:

- **Saved** — saved posts and reels, grouped by collection, as an image-first grid.
- **Messages** — full DM history with inline photos, videos, voice notes, reactions, and shared posts; a per-thread media gallery and in-conversation search.
- **Stories**, **Reposts**, **Profile** (including its change history), your own **Posts**, and **Connections** (followers / following / close friends / blocked).
- **Recover missing media.** Saved reels and posts shared into DMs are stored by Meta as bare links, not files. Demetafy re-fetches the still-available ones with a bundled [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) — one at a time, a whole conversation at once, or your entire archive — and plays them back offline.

## Privacy by design

| Concern | How Demetafy handles it |
|---|---|
| Where your data lives | A local SQLite index for metadata; media is served straight from the ZIP. Nothing is uploaded, ever. |
| Process permissions | The WebView has no process-spawn capability; `yt-dlp` runs only from the Rust core, with fixed arguments. |
| Footprint | A Tauri shell over the OS WebView (~10 MB), not a bundled Chromium. |
| Network | The app is offline by default. The **only** thing that ever touches the network is media you explicitly ask it to re-fetch. |

---

## What's a DYI?

**DYI** = Meta's **"Download Your Information"** export. It's the official, no-scraping way to get a copy of your own data. You ask Meta for it, they assemble a `.zip` (or several) of everything they hold on your profile, and you download it. Demetafy reads that archive locally — your data never touches a server of ours, because we don't have any.

One thing to know up front: **Meta exports one profile at a time.** Facebook, Instagram, and "Meta" (Threads / Meta AI / Quest) each produce a *separate* archive, even when they're linked. Request the one you want to browse. (Content other people created — like photos others tagged you in — lives in *their* archive, not yours, and isn't included.)

## How to request yours

The web flow is easiest. Plan ahead: preparing the export can take anywhere from **an hour to a few days**, and the download link **expires about 4 days** after it's ready.

1. **Open [Accounts Center](https://accountscenter.meta.com/)** and sign in.
2. Go to **Your information and permissions → Download your information → Download or transfer information**.
3. **Choose a profile** — pick your Instagram profile (repeat later for Facebook if you want it).
4. **Select "All available information"** — simplest, and you can ignore categories Demetafy doesn't use yet.
5. **Destination: "Download to device."**
6. **Set the format — this part matters most.** Meta's defaults are wrong for Demetafy; change all three:
   - **Format → JSON.** *(HTML is the default and will not work — it's for reading, not parsing. An empty or tiny download almost always means HTML was left selected.)*
   - **Media quality → Higher quality.** Anything lower re-compresses your photos and videos.
   - **Date range → All time.**
7. **Submit, then wait for the email.** When it arrives, re-enter your password and **download every `.zip` part** — large archives are split into several files, and you need all of them.

> Power-user archives can be **50–100+ GB**. Make sure you have the disk space and a stable connection before you start.

## Set up Demetafy

> **Signed, one-click installers ship with the public release.** Until then, you build from source — it's three commands.

**Prerequisites:** [Node](https://nodejs.org) + [pnpm](https://pnpm.io), and [Rust](https://rust-lang.org) with your platform's toolchain (on Windows, the **MSVC Build Tools**).

```bash
pnpm install            # one-time

pnpm tauri:dev          # run the desktop app (Vite + Tauri shell)
pnpm tauri:build        # production bundle (MSI / DMG / AppImage)
```

Then launch the app and, on first run, point it at your downloaded archive — Demetafy detects the type, ingests it locally, and drops you into your library.

<details>
<summary><strong>The <code>yt-dlp</code> sidecar (only needed to re-fetch missing media)</strong></summary>

The media downloader uses a bundled `yt-dlp` binary that is **not committed** (it's per-platform, ~18 MB each). Before `tauri:dev` / `tauri:build`, place one in `src-tauri/binaries/` named for your target triple — on Windows:

```bash
cp "$(which yt-dlp)" src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe
```

`yt-dlp` tracks Instagram's frequent changes closely; if downloads start failing, update the binary first.
</details>

<details>
<summary><strong>Quality checks & the command-line viewer</strong></summary>

```bash
pnpm typecheck          # tsc (Node + UI projects)
pnpm test               # vitest
pnpm lint               # eslint
cargo test --manifest-path src-tauri/Cargo.toml
```

A read-only CLI can inspect an archive without building the desktop app:

```bash
pnpm demetafy saved list <archive.zip>
pnpm demetafy messages list <archive.zip>
pnpm demetafy ingest <archive.zip>     # build a local SQLite index
pnpm demetafy search <query>
```
</details>

## Roadmap

Demetafy starts with Instagram on the desktop. The destination is bigger: **every place Meta is holding your past, browsable on your own terms.**

- **Facebook** — in active development. Timeline, albums, and Messenger, in the same shell.
- **Threads & WhatsApp** — planned. Threads rides in on the "Meta" export; WhatsApp's export is a different shape (closer to a new product than a new parser), so it lands later.
- **A mobile app** — on the way. Your archive, in your pocket, still 100% offline.

The principle never changes as the surface grows: **it all stays on your device.**

## Honest limitations

Some gaps are baked into what Meta does — or refuses to — put in the export:

- **Deleted posts can't be recovered.** Saved or shared links to removed posts surface as "no longer available," because the archive only stored the link, never the media.
- **Login-walled content** increasingly needs a logged-in session for `yt-dlp` to re-fetch it.
- **Some DM media is excluded by Meta** — View Once, Vanishing Mode, and Unsent messages are never written to the export. That's by design, not a bug in Demetafy.
- **Facebook compresses photos on upload**; the export returns Meta's stored copy, not your pre-upload original.

## License & attribution

Licensed under the **GNU Affero General Public License, version 3 or later** ([AGPL-3.0-or-later](LICENSE)). The privacy promise is enforceable, not just aspirational: anyone who runs a modified version as a network service must release their source.

Created and maintained by **Judicael** ([@judicael-s](https://github.com/judicael-s)).
**"Demetafy" is a registered name** — the source is open under AGPL-3.0, but the name and brand are reserved.
