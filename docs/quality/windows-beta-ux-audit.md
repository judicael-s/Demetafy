# Windows beta UX audit — native baseline

**Status:** pre-beta scope freeze, 2026-07-22. The native Tauri application was audited directly with a populated local Instagram archive. No screenshots or personal archive values are committed; all findings below are sanitized. Future committed evidence must use synthetic data only and temporary captures belong under ignored `data/qa/windows-beta/`.

## Definitions

### Severity

- **launch-blocker:** privacy, data loss, broken content, inaccessible critical flow, severe confusion, or serious performance failure.
- **launch-quality:** a visual, interaction, navigation, rediscovery, or filtering issue that prevents Demetafy from feeling like a credible private alternative.
- **post-beta:** valuable but not necessary to communicate and support the first Windows release.

### Required states

- **loading:** content or an import operation is in progress.
- **empty:** the service or route has no applicable archive content.
- **populated:** applicable archive content is available to browse.
- **partial-media:** metadata is present but referenced media is unavailable, pending, or failed.
- **failure:** the route or operation cannot complete and needs a clear recovery path.

## Evidence boundary

- **Native verified:** direct inspection of `demetafy-app.exe` at approximately 1280×800 on Windows, using mouse and a bounded keyboard pass. Light mode covered Home, Feed, Profile, Saved, Messages, Thread, Stories, MediaViewer, Reposts, Posts, Connections, Search, and Settings. Dark mode covered Settings and the shared shell.
- **Source reviewed:** import errors, playback failure handling, archive-open IPC, and media-control semantics were checked against the current code when the native UI could not safely produce a failure.
- **Not verified:** first-run/no-library onboarding, populated Facebook and Albums, active Downloads dock states, 960×600, Windows scaling at 100/125/150/200%, complete dark-mode route coverage, full screen-reader traversal, and destructive/failure scenarios.
- **Privacy handling:** native observations contained private archive content. None is quoted below, no capture is saved, and no evidence path points to a personal file.

## Baseline matrix

| ID | Route / flow | Service | State | Theme | Viewport / scale | Input mode | Finding | Severity | Evidence | Resolution commit | Verification |
|---|---|---|---|---|---|---|---|---|---|---|---|
| WB-01 | Onboarding / import | Instagram + Facebook | loading | Light | Native scaling not verified | Mouse + keyboard | Streaming progress, cancellation, and safe re-entry remain unverified on a clean Windows profile. | launch-quality | Existing library prevented a first-run pass. | — | Import a small synthetic multipart archive at every target scale; cancel once and verify the existing library remains intact. |
| WB-02 | Onboarding / import | Instagram + Facebook | empty | Light | 1280×800 and 960×600 not verified | Mouse + keyboard | The no-library explanation, picker cancellation, and keyboard route into archive selection remain unverified. | launch-quality | Existing library prevented a first-run pass. | — | Run a clean-profile first launch with synthetic archives and a cancelled picker. |
| WB-03 | Onboarding / import | Instagram + Facebook | failure | Light | 960×600 not verified | Mouse + keyboard | Unsupported, corrupt, incomplete multipart, permission, and storage failures do not yet have a complete typed recovery taxonomy. | launch-blocker | Source-reviewed baseline; import failure can expose private paths and leave recovery ambiguous. | — | Produce each synthetic failure and verify distinct privacy-safe copy, rollback, retry, and re-import actions. |
| WB-04 | Home | Instagram | populated | Light | ≈1280×800 | Mouse | “Browsable offline” is presented beside network-capable bulk download behavior without a single clear privacy/network contract. | launch-blocker | Native verified; source-reviewed network paths. | — | State local processing plus the two opt-in network paths before any network action. |
| WB-05 | Home | Instagram | populated | Light | ≈1280×800 | Mouse | Public-beta UI exposes a development path field and a full archive source path. | launch-blocker | Native verified; values redacted from this audit. | — | Remove development-only path entry and replace displayed paths with privacy-safe labels or an explicit reveal action. |
| WB-06 | Home | Facebook | populated | Light | 1280×800 | Mouse + keyboard | Facebook Home and the service switcher cannot be accepted without a populated synthetic Facebook pass. | launch-quality | Not verified. | — | Import the synthetic Facebook fixture and repeat Home, switcher, and route-state checks. |
| WB-07 | Feed | Instagram | loading | Light | ≈1280×800 | Mouse | Route entry temporarily replaces the content region with a black field and small “Loading…” text, producing a visually broken transition. | launch-quality | Native verified. | — | Preserve shell/surface hierarchy and use a reel-shaped loading state that does not resemble failed playback. |
| WB-08 | Feed | Instagram | populated | Light | ≈1280×800 | Mouse | Media begins playing immediately, with no visible persistent autoplay preference; this conflicts with the approved user-controlled playback model. | launch-quality | Native verified. | — | Default autoplay to off, persist the explicit preference locally, and honor reduced motion. |
| WB-09 | Feed | Instagram | populated | Light | ≈1280×800 | Mouse | “Shuffle” and “Recent” are the only discovery controls; chronological context, bounded date filtering, source route, and intentional continuation are missing. | launch-quality | Native verified. | — | Implement the approved chronological feed, date filters, continuation, and deliberate Surprise me action. |
| WB-10 | MediaReel | Instagram | populated | Light | ≈1280×800 | Mouse + keyboard | Playback is full-bleed but Play/Pause and Autoplay are not exposed as accessible controls with source context. | launch-blocker | Native visual pass plus accessibility-tree inspection. | — | Add named controls, counter/context, reduced-motion behavior, and keyboard-safe shortcuts. |
| WB-11 | Profile | Instagram | populated | Light | ≈1280×800 | Mouse | Sensitive profile fields are shown together; conceal/reveal controls would improve shoulder-surfing privacy but are outside the approved launch feature scope. | post-beta | Native verified; values redacted. | — | Re-evaluate deliberate reveal/copy controls after the Windows beta. |
| WB-12 | Saved | Instagram | populated | Light | ≈1280×800 | Mouse | A multi-row wall of collection chips dominates the viewport and provides neither compact overflow nor sort/search hierarchy. | launch-quality | Native verified. | — | Use a compact collection filter with overflow/search and preserve virtualized results below it. |
| WB-13 | Saved | Instagram | partial-media | Light | ≈1280×800 | Mouse + keyboard | Downloaded, login-required, text-only, and unavailable cards do not share a sufficiently clear recovery/status language. | launch-quality | Native verified for mixed statuses; unavailable edge cases source reviewed. | — | Standardize status, reason, next action, and “no longer available” presentation. |
| WB-14 | Messages | Instagram | populated | Light | ≈1280×800 | Mouse | Conversation-list search could improve large-library navigation, but it is not part of the approved beta feature scope. | post-beta | Native verified. | — | Re-evaluate scoped conversation search after the Windows beta. |
| WB-15 | Thread | Instagram | loading | Light | ≈1280×800 | Mouse | A plain “Loading…” heading and “Loading messages…” text cause a large layout jump before the virtualized thread appears. | launch-quality | Native verified. | — | Reserve thread header/list geometry and use a thread-specific skeleton. |
| WB-16 | Thread | Instagram | populated | Light | ≈1280×800 | Mouse | Large saturated message bubbles and embedded download actions create low-contrast, high-density reading blocks. | launch-quality | Native verified. | — | Improve contrast, line length, grouping, and secondary-action hierarchy while preserving chronology. |
| WB-17 | Thread | Instagram + Facebook | partial-media | Light | 960×600 not verified | Keyboard + screen reader | Native audio/inline media semantics and failure recovery are not yet proven accessible across message types. | launch-quality | Verification gap; no destructive failure injected. | — | Test image/video/audio × available/missing/failed with keyboard and a screen reader; promote observed critical defects to blockers. |
| WB-18 | Stories | Instagram | populated | Light | ≈1280×800 | Mouse | Month grouping is clear, but two narrow portrait cards leave most desktop width unused and make archive scanning inefficient. | launch-quality | Native verified. | — | Introduce an adaptive, consistently sized grid while keeping chronological groups. |
| WB-19 | Stories | Instagram | partial-media | Light | ≈1280×800 | Mouse + keyboard | Cards transition from blank gray placeholders to media without explicit missing/failed differentiation. | launch-quality | Native loading/populated transition verified; failure state not forced. | — | Give loading, missing, unsupported, and failed cards distinct non-alarming treatments. |
| WB-20 | MediaViewer | Instagram | populated | Light | ≈1280×800 | Mouse + keyboard | The close button is named, but pause is exposed as text and there are no accessible previous/next controls, position counter, or return-to-source action. | launch-blocker | Native viewer plus accessibility-tree inspection. | — | Implement named controls, disabled end states, live counter, source route, Escape, and focus restoration. |
| WB-21 | MediaViewer | Instagram + Facebook | failure | Light | 960×600 not verified | Mouse + keyboard | Archive-missing, downloaded-file-missing, unsupported-format, and runtime playback errors are not visibly classified. | launch-quality | Source-reviewed verification gap. | — | Inject each synthetic failure and verify distinct copy and recovery; promote any broken critical flow to a blocker. |
| WB-22 | Reposts | Instagram | populated | Light | ≈1280×800 | Mouse | Long text cards consume the page while media status and preview are secondary; per-item and bulk Download actions compete with browsing. | launch-quality | Native verified. | — | Rebalance metadata, preview/status, and download hierarchy. |
| WB-23 | Posts | Instagram | populated | Light | ≈1280×800 | Mouse | Recovered media renders, but raw numeric filenames are presented as primary card labels when captions and timestamps are unavailable. | launch-quality | Native verified. | — | Prefer media type/date context and demote implementation filenames. |
| WB-24 | Albums | Facebook | empty | Light | 1280×800 | Mouse + keyboard | Albums and its empty/populated/failure states are not verified because no Facebook fixture is loaded. | launch-quality | Not verified. | — | Run the complete album grid/viewer pass with the synthetic Facebook fixture. |
| WB-25 | Connections | Instagram | populated | Light | ≈1280×800 | Mouse | Tabs, search, and virtualized rows are credible; tighter date alignment and secondary metadata can remain post-beta polish. | post-beta | Native verified. | — | Recheck contrast and row alignment after shared primitives land. |
| WB-26 | Search | Instagram | empty | Light | ≈1280×800 | Keyboard | The no-results state is clear but offers only “try a different word,” without removable facets, content-type guidance, or recovery shortcuts. | launch-quality | Native verified with a synthetic no-match query. | — | Add the approved facets and one-step filter reset while retaining calm empty copy. |
| WB-27 | Search | Instagram | populated | Light | ≈1280×800 | Keyboard | Results are large, repetitive grouped cards with no facets or match highlighting; generic participant labels obscure destination context. | launch-quality | Native verified with a generic local query; personal results redacted. | — | Add service/type/date facets, highlights, stable deep links, and concise result rows. |
| WB-28 | Search / shell shortcut | Instagram | populated | Light | ≈1280×800 | Keyboard | Windows displays `⌘K`, and a native Ctrl+K pass did not move focus into Search. | launch-quality | Native verified; Search remained usable by mouse. | — | Display `Ctrl K` on Windows and test focus, query synchronization, Escape, and return focus. |
| WB-29 | Settings / shared theme | Instagram | populated | Dark | ≈1280×800 | Mouse | Dark mode works, but body/help text and secondary metadata appear weak; no measured contrast result exists yet. | launch-quality | Native visual warning, not a measured WCAG failure. | — | Apply semantic tokens and measure WCAG AA contrast in both themes; promote confirmed critical failures. |
| WB-30 | Settings / network disclosure | Instagram | populated | Light + Dark | ≈1280×800 | Mouse + keyboard | Avatar copy calls itself Demetafy’s only network feature while saved/repost/message downloads are also network-capable. | launch-blocker | Native verified; source-reviewed network paths. | — | Replace the false claim with one consistent network disclosure and consent model. |
| WB-31 | Settings / accounts | Instagram | populated | Light + Dark | ≈1280×800 | Mouse + keyboard | Full filesystem paths and development path import controls are exposed beside destructive account removal. | launch-blocker | Native verified; paths redacted. | — | Remove dev controls, mask paths, separate destructive actions, and provide clear confirmation/recovery. |
| WB-32 | Downloads dock | Instagram | loading | Light + Dark | 1280×800 | Mouse + keyboard | Queue, completion, retry, and failed-download states were not exercised because starting network downloads was outside this audit. | launch-quality | Not verified. | — | Run a synthetic/controlled queue pass without personal media and verify focus order plus recovery. |
| WB-33 | Responsive shell and route errors | Instagram + Facebook | failure | Light + Dark | 960×600 and 100/125/150/200% not verified | Mouse + keyboard | The minimum window, Windows scaling matrix, full keyboard traversal, and persistent route-error recovery remain unverified. | launch-quality | Native resize was attempted but the Computer Use bridge retained the original window size; source baseline reviewed. | — | Run the manual Windows display/VM matrix and verify skip link, focus visibility, nonblank route errors, and recovery. |
| WB-34 | Archive selection IPC | Instagram + Facebook | failure | Light + Dark | All Windows viewports | Mouse + keyboard | The WebView can pass an arbitrary filesystem path string to `archive_open`, and Rust opens it directly; the native picker is not the security boundary. | launch-blocker | `src/ui/lib/archive.ts:35-36`; `src-tauri/src/archive.rs:89-91`; command registered in `src-tauri/src/lib.rs:57`. | — | Make the Rust picker return opaque unguessable session identifiers and reject arbitrary frontend paths. |

## Totals by severity

| Severity | Total | Finding IDs |
|---|---:|---|
| launch-blocker | 8 | WB-03, WB-04, WB-05, WB-10, WB-20, WB-30, WB-31, WB-34 |
| launch-quality | 23 | WB-01, WB-02, WB-06, WB-07, WB-08, WB-09, WB-12, WB-13, WB-15, WB-16, WB-17, WB-18, WB-19, WB-21, WB-22, WB-23, WB-24, WB-26, WB-27, WB-28, WB-29, WB-32, WB-33 |
| post-beta | 3 | WB-11, WB-14, WB-25 |
| **All findings** | **34** | **19 surfaces** |

## Totals by route / flow

| Route / flow | Launch blocker | Launch quality | Post-beta | Total |
|---|---:|---:|---:|---:|
| Onboarding / import | 1 | 2 | 0 | 3 |
| Home | 2 | 1 | 0 | 3 |
| Feed | 0 | 3 | 0 | 3 |
| MediaReel | 1 | 0 | 0 | 1 |
| Profile | 0 | 0 | 1 | 1 |
| Saved | 0 | 2 | 0 | 2 |
| Messages | 0 | 0 | 1 | 1 |
| Thread | 0 | 3 | 0 | 3 |
| Stories | 0 | 2 | 0 | 2 |
| MediaViewer | 1 | 1 | 0 | 2 |
| Reposts | 0 | 1 | 0 | 1 |
| Posts | 0 | 1 | 0 | 1 |
| Albums | 0 | 1 | 0 | 1 |
| Connections | 0 | 0 | 1 | 1 |
| Search / shell shortcut | 0 | 3 | 0 | 3 |
| Settings | 2 | 1 | 0 | 3 |
| Downloads dock | 0 | 1 | 0 | 1 |
| Responsive shell and route errors | 0 | 1 | 0 | 1 |
| Archive selection IPC | 1 | 0 | 0 | 1 |
| **Total** | **8** | **23** | **3** | **34** |

## Route/state coverage

Legend: **V** native verified, **S** source reviewed only, **N** not verified, **N/A** not applicable. A source review does not count as a native pass.

| Route / flow | Loading | Empty | Populated | Partial-media | Failure |
|---|---|---|---|---|---|
| Onboarding / import | N | N | N | N/A | S |
| Home | S | N | V | S | S |
| Feed | V | N | V | S | S |
| MediaReel | V | N/A | V | S | S |
| Profile | V | S | V | N/A | S |
| Saved | V | S | V | V | S |
| Messages | S | S | V | S | S |
| Thread | V | N/A | V | V | S |
| Stories | V | S | V | S | S |
| MediaViewer | S | N/A | V | S | S |
| Reposts | S | S | V | S | S |
| Posts | S | S | V | S | S |
| Albums | N | N | N | N | N |
| Connections | S | S | V | N/A | S |
| Search | S | V | V | N/A | S |
| Settings | N/A | N/A | V | N/A | S |
| Downloads dock | N | N | N | N | N |
| Responsive shell and route errors | N/A | N/A | V | N/A | S |
| Archive selection IPC | N/A | N/A | S | N/A | S |

## Responsive audit report — full app, provisional

### Summary

- Pass: 7/24 launch-relevant checks.
- Warnings: 5.
- Failures: 4.
- Not verified: 8.
- Score: **40/100 provisional**, calculated as `(passes + 0.5 × warnings) ÷ 24`; failures and unverified checks score zero.

This is deliberately not a release score. Unverified 960×600, scaling, accessibility, and performance checks prevent responsive acceptance.

| Check | Status | Evidence / follow-up |
|---|---|---|
| Viewport meta is present | Pass | Source reviewed. |
| Persistent shell remains visible across routes | Pass | Native verified. |
| No horizontal overflow at observed ≈1280×800 | Pass | Native verified on audited routes. |
| Route heading hierarchy remains legible | Pass | Native verified. |
| Images and video stay within the observed viewport | Pass | Native verified. |
| Search receives a visible focus treatment when clicked | Pass | Native verified. |
| Theme switching preserves route content | Pass | Native verified. |
| Heading/body spacing patterns are not yet unified | Warning | Route-wide primitives must normalize rhythm. |
| Saved filter chips consume excessive vertical space | Warning | WB-12. |
| Stories underuse desktop width | Warning | WB-18. |
| Dark-theme contrast is visually weak but unmeasured | Warning | WB-29. |
| Pointer target dimensions are not measured | Warning | Measure shared and icon-only controls. |
| Windows shortcut cue and Ctrl+K behavior are incorrect | Fail | WB-28. |
| Media playback controls lack required accessible semantics | Fail | WB-10 and WB-20. |
| Autoplay is enabled without the approved explicit preference | Fail | WB-08. |
| Feed loading state resembles a failed black media surface | Fail | WB-07. |
| 960×600 reflow | Not verified | Required native/manual pass. |
| Windows scaling 100% | Not verified | Required native/manual pass. |
| Windows scaling 125% | Not verified | Required native/manual pass. |
| Windows scaling 150% | Not verified | Required native/manual pass. |
| Windows scaling 200% | Not verified | Required native/manual pass. |
| Complete keyboard traversal and focus restoration | Not verified | Required native/manual pass. |
| Screen reader and axe-core checks | Not verified | Required accessibility pass. |
| LCP, INP, CLS, route timing, and reference-VM performance | Not verified | Required evidence-driven performance pass. |

## Verified strengths

- The persistent sidebar and top bar keep orientation stable across route changes.
- Saved uses a route-specific grid skeleton before populated content appears.
- Messages and Connections present large local archives in scannable lists without visibly blocking the window.
- Stories group content chronologically by month and year.
- Search provides a calm, understandable zero-results state.
- Theme switching is immediate and does not blank the route.
- The MediaViewer close action has an accessible name.

## Scope freeze

Before the Windows public beta:

1. Resolve every launch blocker and populate its `Resolution commit` and `Verification` cells.
2. Implement and verify the approved launch feature scope exactly: **Home rediscovery, feed/date filtering, search facets, route-wide design-system polish, media-viewer consistency, and evidence-driven performance work**.
3. Complete the 960×600, 100/125/150/200%, keyboard, screen-reader, synthetic Facebook, first-run, Downloads dock, failure-injection, and clean-VM passes.
4. Preserve the service-aware route set and existing list virtualization.
5. Keep autoplay off by default and do not add engagement metrics, recommendations, streaks, fake notifications, ranking, or telemetry.
6. Treat typed import/recovery, opaque archive sessions, network disclosure, privacy-safe diagnostics, and Windows release hardening as acceptance work, not additional user-facing feature scope.
7. Keep unapproved feature ideas such as profile-field reveal controls and conversation-list search in post-beta unless new evidence meets the feature admission rule.
