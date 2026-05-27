# Security Policy

Demetafy is privacy-first and local-only — it reads your Meta archive on your own machine and never uploads it. Security reports are welcome and taken seriously.

## Reporting a vulnerability

Please report security issues **privately**, not in public Issues:

- Open a private report via this repository's **Security → Report a vulnerability** tab (GitHub private vulnerability reporting).
- Include what you found, how to reproduce it, and the potential impact. You'll get an acknowledgement within a few days.

## Where to focus

The trust boundaries that matter most in a local archive viewer:

- **Untrusted archive input** — a crafted DYI `.zip` (path traversal, decompression bombs, malformed JSON).
- **Media fetching** — the bundled `yt-dlp` argument/URL handling and SSRF surface.
- **The opt-in Instagram avatar fetch** (`src-tauri/src/avatars.rs`) — the only feature that touches the network.
- **The WebView to Rust IPC surface** and the custom `vmedia://` / `dmedia://` URI schemes.

## Supported versions

Demetafy is pre-1.0; security fixes target the latest `main`.
