# Demetafy — Security Review (2026-05-21)

Pre-public-release review of the Demetafy desktop app (Tauri 2 + Solid + Rust/SQLite).
Method: manual code review of the trust boundaries (untrusted archive input, the
WebView↔Rust IPC surface, the custom URI schemes, the yt-dlp path, CSP/capabilities)
plus a dependency scan. This is a code review, not a penetration test — it reduces
risk, it doesn't certify the absence of bugs.

## Threat model

Demetafy is a **local, single-user desktop app with no servers**. The realistic
threats, in priority order:

1. **Malicious / malformed archive** — the user imports a crafted DYI ZIP (or one a
   friend handed them), or a normal archive containing media *other people* sent
   them. This is the primary untrusted input.
2. **Supply chain** — a tampered app build, a tampered bundled `yt-dlp`, or a
   compromised dependency → full compromise. Mitigated by signing + pinning.
3. **WebView exploit** — a Chromium/WebView2 bug triggered by rendered media. Low
   likelihood, OS-managed (keep WebView2 current).
4. **Local attacker** — someone with access to the user's machine reads the archive
   index / downloaded media at rest. Outside the usual scope of a local viewer.
5. **Network** — minimal: only user-initiated `yt-dlp` fetches; the CSP blocks the
   WebView from making outbound requests.

## Findings summary

| ID | Severity | Area | Issue |
|----|----------|------|-------|
| P1 | **High** (process) | Distribution | Unsigned binaries + no verified update path |
| P2 | Medium (process) | Supply chain | Bundled `yt-dlp` provenance not pinned/verified |
| C1 | Medium | Untrusted archive | Unbounded allocation from attacker-declared entry size (zip-bomb DoS) |
| C3 | Medium | IPC | `db_select` runs arbitrary WebView-supplied SQL |
| C4 | Medium | IPC / network | `run_download` doesn't validate the URL before handing it to yt-dlp |
| C2 | Low | IPC | `archive_open` accepts any filesystem path |
| C5 | Low | WebView | `openExternal` not scheme-restricted on archive-derived URLs |
| C6 | Info | Data at rest | Index + media stored unencrypted in app data dir |
| C7 | Info | CSP | `style-src 'unsafe-inline'`; `data:`/`blob:` in img/media-src |
| P3 | Info | Deps | `pnpm audit` clean; `cargo audit` not yet run |

Note on exploitability: C3/C4/C5 all require a **compromised WebView** (XSS or a
malicious build) to weaponize, and XSS exploitability today is low (see strengths
S1/S2). They are attack-surface reduction, not active holes. **All three are now
closed** (C4/C5 on 2026-05-21, C3 on 2026-05-22); C2 remains.

## Findings

### P1 — Unsigned binaries, no verified updates (High, process)
The app ships unsigned (`.msi`/NSIS today; signing deferred to Phase 3). Distributing
an unsigned "unknown publisher" binary that ingests someone's entire DM history is a
trust contradiction *and* offers no integrity guarantee — anyone can publish a
trojaned "Demetafy.msi". **Code-signing + notarization (Windows + macOS) is effectively
a prerequisite for public binary distribution.** If an auto-updater is added, it must
verify update signatures (Tauri updater signing key).

### P2 — yt-dlp supply chain (Medium, process)
`bundle.externalBin = ["binaries/yt-dlp"]` (`tauri.conf.json:31`); the binary is
fetched/copied at build time (`cp "$(which yt-dlp)" …`). For public releases, pin a
specific yt-dlp release and **verify its checksum** at bundle time; a tampered sidecar
is RCE. Keep it updatable — yt-dlp ships its own security fixes.

### C1 — Zip-bomb / unbounded allocation (Medium)
`archive_read_text` (`src-tauri/src/archive.rs:81`) and the `vmedia` reader
(`src-tauri/src/media.rs`, `read_entry`) both do `Vec::with_capacity(entry.size())`
then `read_to_end`, where `entry.size()` is the **uncompressed size declared in the
ZIP central directory** — attacker-controlled. A crafted entry (huge declared size or
a compression bomb) causes a multi-GB allocation / read → OOM crash (DoS). Triggered
by the core "import an archive" flow.
**Fix:** clamp/validate entry size before allocating. JSON entries are small — reject
oversized text entries (e.g. > a few MB); for media, set a sane upper bound or stream
with `Read::take(limit)` instead of buffering the whole entry.
**Status: addressed 2026-05-21** — `MAX_TEXT_ENTRY` (512 MB) and `MAX_MEDIA_ENTRY`
(2 GB) ceilings, with bounded `Read::take` reads, in `archive_read_text` and
`read_entry`. Oversized / bomb entries now error instead of allocating unbounded.

### C2 — `archive_open` accepts any path (Low)
`archive_open(path)` (`archive.rs:38`) opens any filesystem path as a ZIP. Normally the
path comes from the native dialog, but the IPC command trusts whatever the WebView
sends — so a compromised WebView gets an arbitrary-ZIP enumerate/read primitive.
**Fix:** validate the path (e.g. only accept the dialog-selected archive, or paths
under an allowed root).

### C3 — `db_select` arbitrary SQL (Medium)
`db_select(sql, params)` (`src-tauri/src/db.rs`) executes arbitrary SQL supplied by
the WebView. Today all callers use static, parameterized queries, and the blast radius
is only the user's own local DB — but it's a generic "run any SQL" endpoint, so any
future XSS gains full read/write of the index (all DMs, contacts, etc.).
**Fix:** replace with typed query commands (returning structs); retire the generic
endpoint. (Tracked as a candidate Rust move.)
**Status: addressed 2026-05-22** — `db_select` removed. All reads now go through a
fixed set of typed `query_*` commands (`src-tauri/src/db.rs`) returning structs and
bound server-side with parameters, so the WebView can no longer submit SQL. Registered
in `lib.rs`; `src/ui/lib/queries.ts` invokes them (the UI mappers are unchanged). Rust
unit tests cover overview / saved-collection-filter / thread-detail join / share-rows.

### C4 — `run_download` trusts the WebView URL (Medium)
`run_download` (`src-tauri/src/downloader.rs`) passes the WebView-supplied `url`
straight to yt-dlp. The UI gates downloads through `isDownloadableShare`, but Rust
does not re-validate, so a compromised WebView could make yt-dlp fetch an arbitrary
URL (and potentially attach the user's cookie jar).
**Fix:** validate host/path (Instagram/Facebook permalink) in Rust before spawning.
**Status: addressed 2026-05-21** — `run_download` now rejects any URL that isn't a
host-anchored Instagram/Facebook permalink (`is_downloadable_permalink`, unit-tested).

### C5 — `openExternal` not scheme-restricted (Low)
`openExternal` is called with archive-derived URLs: `Connections.tsx:45` (`c.href`),
`Reposts.tsx:106` (`source_url`), `MediaViewer.tsx:207` (`url`). No scheme check, so a
crafted archive could carry a `file://` or odd-scheme link. Tauri's `open` has some
built-in validation, but allowlist `http`/`https` (and the known media schemes) for
defense-in-depth.
**Status: addressed 2026-05-21** — archive-derived links now go through
`src/ui/lib/external.ts` `openExternal`, which opens only `http(s)` URLs. (Settings'
"open downloads folder" keeps the raw shell `open`, since it's an app-computed path.)

### C6 — Data unencrypted at rest (Info)
The SQLite index and downloaded media live unencrypted under `app_data_dir`. Expected
for a local viewer, but worth stating in the privacy docs (a local/shared-machine
attacker reads everything). Optional enhancement: at-rest encryption (e.g. SQLCipher).

### C7 — CSP minor items (Info)
`style-src 'unsafe-inline'` (required by Tailwind) — style injection only, low risk.
`img-src`/`media-src` permit `data:`/`blob:` — low risk. The rest of the CSP is tight.

### P3 — Dependencies (Info)
`pnpm audit --prod` reports **no known vulnerabilities** (2026-05-21). `cargo audit`
is not installed — install and run it (`cargo install cargo-audit`), and wire both into
CI so regressions surface.

## What's done well (strengths)

- **S1 — CSP exfiltration lockdown.** `connect-src 'self' ipc:` means even a
  hypothetical XSS can't phone home over the network; `script-src 'self'` blocks
  inline/eval scripts. (`tauri.conf.json:25`)
- **S2 — No HTML-injection sinks.** No `innerHTML` / `eval` / `document.write`
  anywhere; Solid auto-escapes text, so archive captions/messages/names render inert.
- **S3 — Path-traversal hardening.** `vmedia` indexes the ZIP by name (no FS
  traversal); `dmedia` rejects non-`Normal` path components, canonicalizes, and
  confirms containment under the downloads root — with unit tests.
- **S4 — Minimal capabilities.** Only `core:default`, `dialog:allow-open`,
  `shell:allow-open`. The broad `shell:allow-spawn`/`allow-execute` (`args: true`) was
  removed; yt-dlp now spawns from Rust with a fixed arg template.
- **S5 — Local-only, no servers, no telemetry.** Git history is clean of archives,
  databases, cookies, and secrets (full-history scan).
- **S6 — Parameterized SQL + typed ingest** on the write path.

## Pre-public checklist

1. [ ] **Code-sign + notarize** Windows + macOS builds; sign the updater if added. (P1)
2. [ ] **Pin + checksum the bundled yt-dlp**; document provenance; keep it updatable. (P2)
3. [ ] **Decide on internal docs** in the repo — `tasks/todo.md` (monetization, legal
   refs) and Meta identities in `CLAUDE.md`: scrub/relocate or accept as public.
4. [x] **Code-level hardening:** C1 (entry-size caps), C4 (validate URL in
   `run_download`), C5 (allowlist `http`/`https` in `openExternal`) — done 2026-05-21;
   C3 (`db_select` → typed `query_*` commands) — done 2026-05-22. C2 still open.
5. [ ] **Run `cargo audit`**; keep `pnpm audit` + `cargo audit` in CI. (P3)
6. [ ] **Legal review** (yt-dlp vs. Meta ToS, AGPL compliance) — already tracked in
   `docs/legal-brief.md`.

Bottom line: no critical code-level vulnerabilities found, and the architecture is
genuinely privacy-conscious. The blockers for responsible public release are
**process** (signing, supply chain) and a **docs decision**; the code findings are
low-cost hardening worth doing before the app grows.
