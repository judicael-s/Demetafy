# Demetafy Windows Public Beta Design

**Status:** Approved design

**Date:** 2026-07-21

**Target:** Free Windows 11 x64 public beta distributed through the existing public GitHub repository

## Executive decision

Demetafy will launch as a quality-first Windows public beta. Release engineering provides the finish line, but the release is not considered ready merely because it compiles. The application must be usable by a non-technical person, visually coherent, fast on large archives, and emotionally compelling enough to replace the part of Meta people return to for their own memories.

The beta may include focused UX/UI improvements and a small number of high-value features. An addition belongs in the beta only when it materially improves first use, rediscovery, repeat use, accessibility, performance, or the public demonstration of the product without weakening privacy or destabilizing the release.

The repository is already public. Communication begins only when the Windows product and its release path satisfy the acceptance gates in this specification. The future manifesto/download website, social campaign, macOS/Linux builds, Threads, WhatsApp, and mobile applications remain separate workstreams.

## Product purpose

Demetafy combines useful activism with public craft:

1. Help people reclaim and browse memories returned by Meta as difficult raw exports.
2. Demonstrate strong product, web, desktop, Rust, TypeScript, privacy, and release-engineering skills through a genuinely useful open-source application.
3. Build a GitHub community through real usage, stars, forks, discussions, issues, and contributions rather than through a commercial funnel.

Demetafy is free, open source, publicly downloadable, and requires no Demetafy account. There is no paid edition, advertising model, telemetry business, or sales funnel.

## Product boundary

Demetafy does not recreate Meta's live social network. It replaces the reason people reopen Meta to revisit their own past: messages, photographs, saved posts, stories, connections, profile history, and personal activity.

The product may reuse familiar structures such as feeds, profile grids, stories/reels, direct messages, and saved collections. It must not reproduce manipulative ranking, fake notifications, streaks, ads, engagement traps, or invisible behavioral profiling. Chronology, filters, search, autoplay, and rediscovery remain understandable and user-controlled.

## Audience

The primary beta user is a non-technical Windows user who has requested a Meta Download Your Information archive and wants to browse it. The GitHub and developer audience is important for discovery and contribution, but development tools are not part of the user journey.

The beta must therefore provide:

- A conventional installer and launchable desktop application.
- Plain-language onboarding and errors.
- No requirement to install Node, pnpm, Rust, Visual Studio, Tauri, or `yt-dlp`.
- No requirement to understand JSON, ZIP internals, SQLite, terminals, or GitHub.
- Separate contributor documentation for source builds.

## Experience architecture

### Global shell and navigation

The existing desktop shell remains the product frame. Navigation must expose only supported routes for the active service/account, preserve the user's place when switching between areas, and behave consistently at the minimum window size and Windows scaling levels.

Every route uses the same design tokens and shared components for typography, spacing, surface elevation, focus treatment, buttons, inputs, skeletons, empty states, error states, toasts, media controls, and dialogs. Visual consistency is a launch requirement, not optional cleanup.

### Onboarding and import

Onboarding communicates three facts before import:

1. Processing happens locally.
2. Demetafy needs the JSON-format Meta export and every archive part.
3. Network access occurs only for explicit missing-media downloads and the separately enabled Instagram avatar feature.

The import flow uses a native picker, validates the archive group before destructive work, displays explicit phases, and explains incorrect HTML exports, corrupt ZIPs, mixed groups, incomplete multipart archives, unsupported services, empty archives, and storage/database failures.

A re-import must be atomic from the user's perspective. The currently working library remains available until parsing, validation, and database writes for the replacement succeed. Cancellation or failure cannot delete the last usable index.

### Home: rediscovery center

Home becomes the emotional center of the product rather than a statistics dashboard. It contains three restrained modules:

- **Continue browsing:** restores the last meaningful route for the current imported account. Only the local route/account key and timestamp are stored; no telemetry is emitted.
- **On this day:** shows eligible content matching the current local month/day across prior years, grouped chronologically by year. The module is hidden when there are no matches.
- **Surprise me:** a user-triggered random eligible memory. It does not auto-refresh, notify, rank, or create a streak.

The existing archive overview and import-another-account actions remain accessible without dominating the page.

### Feed

Feed remains the canonical chronological stream. It gains server-backed filters for:

- Imported account/service.
- Content type supported by the active archive.
- Bounded date range.

Filters are reflected visibly in the UI and can be cleared in one action. The feed does not introduce opaque ranking. Virtualization remains mandatory for large result sets.

### Search

Search remains global within the selected imported account and gains visible facets for result category and date range. Results remain grouped by their destination surface and deep-link to the most specific available context.

Search and filtering execute through fixed, typed Rust commands with bound parameters. The WebView never submits SQL.

### Existing content routes

Messages, Saved, Stories, Posts, Albums, Connections, Profile, and Reposts retain their existing information architecture. The finalization pass focuses on:

- Consistent titles, controls, density, loading, empty, and failure states.
- Clear chronology and context.
- Reliable account/service switching.
- Useful keyboard navigation and visible focus.
- Correct image, video, audio, and unavailable-content presentation.
- Responsive layouts at the supported window sizes and Windows scaling levels.

No simulated likes, comments, recommendations, public profiles, or live network features are added.

### Media viewer

The media viewer provides consistent controls across all routes:

- Escape closes the viewer.
- Arrow keys navigate when adjacent media exists.
- Space toggles playback when focus is not inside another control.
- Video/audio controls remain accessible by keyboard and screen readers.
- Autoplay is optional, visible, and persisted as a local preference.
- The viewer exposes the media's source route and chronological context.
- Failure distinguishes unavailable archive media, unsupported formats, missing downloaded media, and playback errors.

### Settings and privacy controls

Settings groups account/archive management, appearance, playback, download behavior, cookie-file configuration, Instagram avatar fetching, storage, and diagnostics.

Network-sensitive features state what data leaves the device, where it goes, and why. The Instagram avatar feature remains off by default. Cookie paths are never displayed outside the local settings surface or included in diagnostics.

### Diagnostics

Diagnostics are local and user-triggered. A user may preview and export a text report containing application version, Windows version, schema version, archive service/type, counts, timings, and categorized errors.

The report excludes archive paths, cookie paths, handles, participant names, message text, captions, URLs containing private identifiers, media, database contents, and raw stack traces that contain local paths. There is no automatic upload.

## Feature admission rule

The implementation begins with a route-by-route UX/UI audit. Findings are classified as:

- **Launch blocker:** privacy, data loss, broken content, inaccessible critical flow, severe confusion, or serious performance failure.
- **Launch-quality improvement:** a visual, interaction, navigation, rediscovery, or filtering issue that prevents Demetafy from feeling like a credible private alternative.
- **Post-beta:** valuable but not necessary to communicate and support the first Windows release.

New feature proposals must identify user value, affected flows, implementation cost, test cost, privacy impact, performance impact, and release risk. The approved launch feature scope is Home rediscovery, feed/date filtering, search facets, route-wide design-system polish, media-viewer consistency, and evidence-driven performance work. Everything else defaults to post-beta.

## Technical architecture

### Existing foundations

The beta keeps the current Solid.js, TypeScript, Tauri 2, Rust, SQLite, ZIP-backed media, custom `vmedia`/`dmedia` protocols, and bundled `yt-dlp` architecture. There is no framework rewrite.

### UI boundaries

- Route components render state and coordinate user actions.
- Shared UI components own repeated visual and interaction behavior.
- UI library modules own formatting, route-state helpers, and typed command adapters.
- Application state owns the selected imported account, theme/preferences, continuation route, and bounded cross-route state.
- Route components do not issue raw SQL or perform large in-memory archive scans.

### Query boundaries

Rediscovery, feed filters, and search facets are implemented as fixed Rust query commands returning typed rows. Filtering, date bounds, random selection, and pagination occur in SQLite whenever possible.

Queries remain archive/account scoped. A feature cannot accidentally mix two Instagram accounts or leak Facebook rows into an Instagram-only surface. New commands receive bounded inputs and return bounded result sets.

### Archive authorization boundary

The remaining raw-path `archive_open` surface is removed from the WebView contract. Archive selection and authorization become Rust-owned:

1. A Rust command opens the native picker and canonicalizes the selected ZIP paths.
2. Rust validates extensions and creates an opaque archive-session identifier.
3. The WebView receives the session identifier plus safe display names, not an arbitrary filesystem read capability.
4. Archive list/read/ingest operations accept the session identifier.
5. Persisted part paths are resolved and written server-side for later `vmedia` access.
6. Sessions expire when import completes, is cancelled, or the application closes.

This closes the arbitrary-ZIP IPC primitive while preserving multipart imports.

### Atomic imports and migrations

Archive parsing and validation complete before the existing usable archive is replaced. Database writes occur inside a transaction. A failed transaction leaves the prior archive/index intact. Migrations remain monotonic, idempotent, and tested against on-disk databases from every schema version retained in fixtures.

### Media and memory behavior

Range-capped `vmedia` and `dmedia` serving remains unchanged in principle. Open-ended media ranges may intentionally return capped chunks. New media code must preserve ETag, immutable caching, 206 behavior, stored-entry seeking, and the deflated-entry fallback.

Large lists remain virtualized. Queries paginate or bound results. The UX audit records actual memory and responsiveness before deciding whether ingest requires chunked writes or deeper streaming changes; those changes become launch work only if the acceptance dataset fails.

## Reliability and error model

Errors are categorized at their source and mapped to plain-language UI copy.

### Import categories

- Wrong format/HTML export.
- Corrupt or unreadable ZIP.
- Mixed archive groups.
- Missing multipart archive data.
- Unsupported Meta service/root.
- Empty but valid export.
- Insufficient disk or permission failure.
- Parser/schema incompatibility.
- Database/migration failure.
- Cancelled by user.

### Download categories

- Content unavailable/deleted.
- Login required.
- Rate limited/transient.
- Outdated extractor.
- Cancelled.
- Local storage failure.
- Unknown failure with a redacted diagnostic code.

Routes never collapse into a blank screen. Local retry, return-to-library, re-import, or troubleshooting actions appear when applicable. Offline browsing continues independently of GitHub, Meta, and the future website.

## Privacy and network model

Archive parsing, indexing, search, rediscovery, and playback are local. The two sanctioned network paths are:

1. User-requested recovery of missing linked media through the bundled downloader.
2. The separately enabled Instagram profile-picture fetch.

Public copy, onboarding, and settings must describe both accurately. No claim may state that Demetafy never contacts Meta under all conditions. There is no analytics, telemetry, crash upload, account system, or Demetafy server.

## Performance targets

Acceptance measurements use a clean Windows 11 x64 VM with 4 vCPUs, 8 GB RAM, SSD-backed storage, default power settings, and release builds.

- Cold launch to interactive shell: at most 5 seconds.
- Route navigation against an already-open index: 95th percentile at most 750 ms.
- Opening a 4,000-message thread: at most 750 ms to usable first paint.
- Search/filter response on 100,000 indexed searchable rows: 95th percentile at most 500 ms.
- Local media first frame: at most 2 seconds for supported media on SSD storage.
- Scrolling: no sustained interval below 50 frames per second during a 30-second feed, grid, or long-thread test on the reference VM.
- Import: visible phase/progress updates at least once per second while work advances; the window must not remain unresponsive for more than 2 seconds.
- Large synthetic import: completes without out-of-memory termination on the reference VM and keeps the Demetafy process working set below 5 GB.

The large synthetic dataset contains a multipart logical archive with 100,000 content records, a 10,000-message largest thread, cross-part media references, and enough stored media to exercise range serving without checking personal data into the repository.

## Accessibility and responsive targets

- All critical flows operate with keyboard only.
- Focus is visible and follows a logical order.
- Controls have accessible names and state.
- Text and interactive-control contrast meet WCAG 2.2 AA.
- Reduced-motion preferences disable nonessential motion and autoplay transitions.
- Layouts are verified at 960×600 minimum window size and 100%, 125%, 150%, and 200% Windows scaling.
- Zoom/scaling does not hide the import action, navigation, media close control, or error recovery actions.

## Windows release architecture

- Official beta platform: Windows 11 x64.
- Windows 10 is best-effort and is not advertised until it passes the same clean-machine suite.
- Primary artifact: NSIS `Demetafy-setup.exe`.
- Secondary artifact: MSI package for administrators and advanced users.
- Source of truth: tagged commits in the existing public GitHub repository.
- Tag format: `app-vMAJOR.MINOR.PATCH-beta.N`.
- Release workflow: Windows GitHub Actions runner, quality gates, pinned sidecar retrieval and checksum verification, native bundle creation, signing, signature verification, checksums, dependency inventory, and draft GitHub Release.
- Publication: a maintainer manually reviews and promotes the draft release.
- Auto-update: excluded from the first beta. Users deliberately install newer GitHub releases.

The public beta artifact must be signed. Signing credentials remain outside the repository and are exposed only to the protected release job. If signing is unavailable or signature verification fails, the workflow may create a private/draft candidate but cannot publish it as the public beta.

The release contains:

- Signed NSIS and MSI artifacts.
- `SHA256SUMS.txt`.
- Dependency inventory/SBOM.
- Release notes with known limitations and upgrade behavior.
- Provenance for the pinned `yt-dlp` binary and its verified checksum.

## Verification strategy

### Automated gates

- TypeScript typecheck for Node and UI projects.
- ESLint.
- Vitest unit/integration suite.
- Rust unit/integration suite.
- Production UI build.
- `pnpm audit --prod` and `cargo audit`.
- Version consistency, sidecar checksum, secret scan, and release-artifact checks.

### Synthetic integration fixtures

Synthetic fixtures cover Instagram/Facebook, single/multipart archives, two accounts of the same service, cross-part media, HTML/wrong-format exports, corrupt ZIPs, partial multipart sets, schema upgrades, failed re-imports, cancelled operations, and the large acceptance dataset.

### UI acceptance

Every route is checked in dark/light themes, keyboard-only use, minimum window size, four Windows scaling levels, loading, empty, populated, partial-media, and failure states. The audit records screenshots and actionable findings.

### Native release rehearsal

A clean Windows 11 standard-user VM installs the exact candidate artifact, imports synthetic archives, browses every route, searches, filters, plays media, restarts, upgrades from the previous beta fixture, operates offline, exports redacted diagnostics, and uninstalls. The rehearsal records artifact hashes, OS build, timings, screenshots, defects, signature state, Defender result, and SmartScreen behavior.

## Release acceptance gates

The Windows public beta is ready only when:

- All launch blockers from the UX/UI audit are resolved.
- The approved launch-quality feature scope is implemented and verified.
- No known data-loss, privacy, critical accessibility, or critical/high security defect remains.
- Automated gates and dependency audits pass on the release commit.
- Performance targets pass on the reference VM.
- Re-import and schema-upgrade tests preserve existing libraries on failure.
- Network behavior and diagnostics match this specification.
- `yt-dlp` is pinned and checksum verified.
- NSIS and MSI artifacts are signed and signatures verify after packaging.
- The clean-machine rehearsal passes.
- Release notes, limitations, troubleshooting, security reporting, checksums, dependency inventory, and contributor guidance are present.
- No real archive, cookie file, database, identity, message, caption, or personal media exists in Git history, fixtures, CI logs, or release artifacts.

## Explicit non-goals

- Marketing/manifesto website implementation.
- Social account creation or posting.
- macOS or Linux artifact production.
- Auto-updater infrastructure.
- Live Meta account mirroring.
- New Demetafy servers, accounts, cloud sync, analytics, or telemetry.
- Simulated likes/comments, ranking, fake notifications, or public social profiles.
- Threads, WhatsApp, and mobile applications.
- Broad feature work that does not pass the feature-admission rule.

## Documentation outputs

Implementation produces:

- A Windows beta UX/UI audit.
- Updated user-facing privacy and network disclosures.
- Public DYI/import instructions and troubleshooting.
- Contributor source-build documentation.
- Release workflow and signing/provenance documentation.
- Clean-machine QA report.
- Beta release notes and known limitations.
