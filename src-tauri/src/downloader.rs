//! Rust-side yt-dlp download engine.
//!
//! The WebView used to spawn the bundled yt-dlp sidecar directly via the shell
//! plugin's JS `Command` API, which required `shell:allow-spawn`/`allow-execute`
//! with `args: true` — the broadest permission in the app (arbitrary args to a
//! spawned process). Spawning HERE, from trusted Rust with a FIXED arg template,
//! let us drop those capabilities.
//!
//! The whole queue lives in Rust: a `DownloadEngine` state with a Tokio worker
//! pump (bounded by `max_parallel`), result classification (`categorize` /
//! `parse_destination` / `parse_thumbnail` / `classify`) and `run_with_retry`,
//! exposed through four commands (`enqueue_downloads`, `download_queue_snapshot`,
//! `clear_finished_downloads`, `retry_failed_downloads`). Terminal outcomes
//! persist via `crate::db::write_download_status`; every change emits a
//! `download://update` event (one item per event) that the WebView mirrors into
//! its read-only store (`src/ui/lib/download-queue.ts`). `ytdlp_status` (the
//! sidecar version probe + staleness check, used by Settings) is the only other
//! command here.
//!
//! History: increment 1 moved the spawn to Rust while TS kept the queue/retry;
//! 2a added this Rust queue alongside; 2b (current) deleted the TS engine, so the
//! WebView is now a pure event mirror.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, Runtime, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::db::Db;

/// Sidecar BASENAME. Tauri resolves this next to the executable
/// (`<exe_dir>/yt-dlp<ext>`), where the build drops the matching-triple sidecar.
/// Do NOT use the `binaries/yt-dlp` config path here — that prefix only tells
/// `externalBin` (tauri.conf.json) where the SOURCE files live; passing it to
/// `sidecar()` makes the runtime look in a nonexistent `<exe_dir>/binaries/` and
/// the spawn fails with "path not found" (os error 3).
const SIDECAR: &str = "yt-dlp";

/// yt-dlp version this build was tested + shipped against, date-based `YYYY.MM.DD`
/// so a plain lexicographic `<` compare is chronological. Bumping this is a RELEASE
/// STEP: refresh the bundled `src-tauri/binaries/yt-dlp-<triple>` sidecar AND update
/// this constant together (they're expected to match in a release build). A running
/// sidecar OLDER than this flags `stale` in `ytdlp_status`, which Settings surfaces.
/// We can't compare against the latest UPSTREAM version without a network call
/// (privacy-first — the IG avatar fetch is the only sanctioned egress), so this pin
/// plus the failure-signature arm in `categorize` are the two staleness signals.
const YTDLP_PINNED_VERSION: &str = "2026.03.17";

/// Raw outcome of one sidecar run, fed to `classify`.
struct RunOutput {
    code: i32,
    stdout: String,
    stderr: String,
}

/// Parse a yt-dlp `[download]  12.3% of …` line → percent (0–100), else None.
/// Port of the TS `parseProgressLine` (kept behaviourally aligned, incl. clamping).
fn parse_progress_line(line: &str) -> Option<f64> {
    let after = line.split("[download]").nth(1)?.trim_start();
    let pct_end = after.find('%')?;
    let num: String = after[..pct_end]
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let pct: f64 = num.parse().ok()?;
    if !pct.is_finite() {
        return None;
    }
    Some(pct.clamp(0.0, 100.0))
}

/// Defense-in-depth: the WebView already gates downloads through `isDownloadableShare`,
/// but re-validate here so a compromised web layer can't make yt-dlp fetch an arbitrary
/// URL (and possibly attach the user's cookie jar). Mirrors `links.ts`: an Instagram
/// p/reel/tv permalink, or a Facebook video/reel / fb.watch link. Host-anchored, so
/// `evil.com/instagram.com/...` and `www.instagram.com.evil.com` are rejected.
fn is_downloadable_permalink(url: &str) -> bool {
    let u = url.to_ascii_lowercase();
    let rest = match u.strip_prefix("https://").or_else(|| u.strip_prefix("http://")) {
        Some(r) => r,
        None => return false,
    };
    let (host, raw_path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = host.split('@').last().unwrap_or(host); // drop any userinfo
    let host = host.split(':').next().unwrap_or(host); // drop any port
    let path = format!("/{}", raw_path.split(['?', '#']).next().unwrap_or(""));
    let is_ig = matches!(host, "instagram.com" | "www.instagram.com")
        && (path.contains("/p/")
            || path.contains("/reel/")
            || path.contains("/reels/")
            || path.contains("/tv/"));
    let is_fb = (matches!(host, "facebook.com" | "www.facebook.com")
        && (path.contains("/videos/") || path.contains("/reel/")))
        || host == "fb.watch";
    is_ig || is_fb
}

/// One real download attempt. Spawns the bundled yt-dlp with a FIXED arg template
/// (the only caller-controlled values are the url, output dir and optional cookies
/// path — never raw flags), calls `on_progress(pct)` for each parsed `[download] N%`
/// line (it emits NOTHING itself — the caller decides whether/how to surface
/// progress), and returns the raw exit/stdout/stderr for classification.
///
/// Called by the queue `worker`, which patches the item's progress and emits
/// `download://update` from `on_progress`.
async fn run_attempt<R: Runtime>(
    app: &tauri::AppHandle<R>,
    url: &str,
    output_dir: &str,
    cookies_path: Option<&str>,
    on_progress: impl Fn(f64),
) -> Result<RunOutput, String> {
    if !is_downloadable_permalink(url) {
        return Err(format!("refusing to download a non-permalink URL: {url}"));
    }
    let mut args: Vec<String> = vec!["--no-warnings".into(), "--newline".into()];
    if let Some(c) = cookies_path {
        args.push("--cookies".into());
        args.push(c.into());
    }
    args.push("--no-overwrites".into());
    args.push("--write-thumbnail".into());
    args.push("-o".into());
    args.push(format!("{}/%(id)s.%(ext)s", output_dir.replace('\\', "/")));
    args.push(url.into());

    let sidecar = app.shell().sidecar(SIDECAR).map_err(|e| e.to_string())?;
    let (mut rx, _child) = sidecar.args(args).spawn().map_err(|e| e.to_string())?;

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code: i32 = -1;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                if let Some(percent) = parse_progress_line(&line) {
                    on_progress(percent);
                }
                stdout.push_str(&line);
                stdout.push('\n');
            }
            CommandEvent::Stderr(bytes) => {
                stderr.push_str(&String::from_utf8_lossy(&bytes));
                stderr.push('\n');
            }
            CommandEvent::Error(err) => {
                stderr.push_str(&format!("sidecar error: {err}\n"));
            }
            CommandEvent::Terminated(payload) => {
                code = payload.code.unwrap_or(-1);
            }
            _ => {}
        }
    }

    Ok(RunOutput {
        code,
        stdout,
        stderr,
    })
}

/// Sidecar probe result for Settings: the running `--version`, the version this
/// build pins, and whether the running sidecar predates the pin.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtdlpStatus {
    /// Trimmed `--version` of the running sidecar, or None if the probe failed
    /// (sidecar missing / not executable / nonzero exit).
    version: Option<String>,
    /// The version this build expects (`YTDLP_PINNED_VERSION`).
    pinned: String,
    /// True when a version was read AND it predates the pin (date-string compare).
    stale: bool,
}

/// True when `version` predates `pinned`. yt-dlp's stable versions are zero-padded
/// `YYYY.MM.DD`, so a plain lexicographic `<` is chronological; nightlies append
/// `.NNNNNN`, which sorts AFTER the same-day stable — correctly treated as "newer".
fn is_stale_version(version: &str, pinned: &str) -> bool {
    version < pinned
}

/// Probe the bundled sidecar's version and compare it to the pinned expectation.
/// Returns `version: None` (not an `Err`) when the sidecar can't be run, so Settings
/// can render "Not found" without the call rejecting.
#[tauri::command]
pub async fn ytdlp_status<R: Runtime>(app: tauri::AppHandle<R>) -> Result<YtdlpStatus, String> {
    let sidecar = app.shell().sidecar(SIDECAR).map_err(|e| e.to_string())?;
    let (mut rx, _child) = sidecar.arg("--version").spawn().map_err(|e| e.to_string())?;
    let mut out = String::new();
    let mut code: i32 = -1;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => out.push_str(&String::from_utf8_lossy(&bytes)),
            CommandEvent::Terminated(payload) => code = payload.code.unwrap_or(-1),
            _ => {}
        }
    }
    let version = if code == 0 {
        let v = out.trim().to_string();
        (!v.is_empty()).then_some(v)
    } else {
        None
    };
    let stale = version
        .as_deref()
        .is_some_and(|v| is_stale_version(v, YTDLP_PINNED_VERSION));
    Ok(YtdlpStatus {
        version,
        pinned: YTDLP_PINNED_VERSION.to_string(),
        stale,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Result classification — ported verbatim (in behaviour) from `ytdlp-core.ts`
// (`categorize`, `parseDestination`, `parseThumbnail`, `runWithRetry`) and
// `ytdlp.ts` (`classify`). Kept here so the Rust queue can own the full
// decide-then-persist flow, and so the unit coverage survives the TS deletion.
// ─────────────────────────────────────────────────────────────────────────────

/// Outcome of one yt-dlp invocation (Rust port of the TS `DownloadResult` union).
/// Only `Transient` is retried; everything else short-circuits.
#[derive(Debug, Clone, PartialEq)]
enum DownloadResult {
    Ok {
        output_path: String,
        thumb_path: Option<String>,
    },
    Skipped {
        output_path: String,
        thumb_path: Option<String>,
    },
    Dead {
        reason: String,
    },
    LoginWalled {
        reason: String,
    },
    Transient {
        reason: String,
    },
    /// Failure signature that means the bundled yt-dlp is too old to parse the page
    /// (extractor drift — gotcha #3). Terminal like `Unknown` (maps to `error`), but
    /// carries an actionable "update yt-dlp" reason instead of the raw stderr.
    Outdated {
        reason: String,
    },
    Unknown {
        reason: String,
        #[allow(dead_code)] // mirrors the TS shape; not read on the Rust side yet
        exit_code: i32,
    },
}

/// Classify a yt-dlp failure by scanning stderr. Conservative — anything we don't
/// recognize is `Unknown` rather than guessed. Precedence: dead → loginWalled →
/// transient → outdated → Unknown (most specific / most actionable first; the
/// outdated arm catches extractor-staleness signatures just before the fallback).
fn categorize(stderr: &str, exit_code: i32) -> DownloadResult {
    let lower = stderr.to_lowercase();
    // TS: stderr.trim().split("\n").pop()?.slice(0, 300) — last line, capped at 300 chars.
    let reason: String = stderr
        .trim()
        .split('\n')
        .last()
        .unwrap_or("")
        .chars()
        .take(300)
        .collect();

    let is_dead = lower.contains("video unavailable")
        || lower.contains("post is no longer available")
        || lower.contains("has been deleted")
        || lower.contains("content is not available")
        || lower.contains("does not exist")
        || lower.contains("http error 404")
        || lower.contains("http error 410");
    if is_dead {
        return DownloadResult::Dead { reason };
    }

    let is_login_walled = lower.contains("login required")
        || lower.contains("login_required")
        || lower.contains("requested content is not available")
        || lower.contains("restricted video")
        || lower.contains("sign in")
        || lower.contains("private")
        || lower.contains("use --cookies")
        || lower.contains("cookies")
        || lower.contains("rate-limit reached")
        || lower.contains("login to access");
    if is_login_walled {
        return DownloadResult::LoginWalled { reason };
    }

    let is_transient = lower.contains("connection")
        || lower.contains("timeout")
        || lower.contains("temporarily unavailable")
        || lower.contains("network")
        || lower.contains("http error 5")
        || lower.contains("http error 429")
        || lower.contains("too many requests");
    if is_transient {
        return DownloadResult::Transient { reason };
    }

    // yt-dlp falls behind Instagram/Facebook HTML changes every few weeks (gotcha #3);
    // these signatures mean the extractor itself couldn't parse the page — almost always
    // "the bundled yt-dlp is too old", not a bad URL (we host-validate URLs upstream).
    // Last before Unknown so dead/login/transient still win; swaps the raw stderr for an
    // actionable reason the dock renders verbatim.
    let is_outdated = lower.contains("unable to extract")
        || lower.contains("unsupported url")
        || lower.contains("no video formats")
        || lower.contains("please report this issue")
        || lower.contains("out of date");
    if is_outdated {
        return DownloadResult::Outdated {
            reason: "Downloader may be out of date — update yt-dlp.".into(),
        };
    }

    DownloadResult::Unknown { reason, exit_code }
}

/// The output path yt-dlp wrote (or skipped), recovered from stdout.
struct Destination {
    path: String,
    already_downloaded: bool,
}

/// Recover the output file path from yt-dlp stdout on a successful exit. Order
/// matters (mirrors TS `parseDestination`): the "already downloaded" skip and the
/// post-merge `[Merger]` line both win over the initial `Destination:` line (a
/// pre-merge temp file). Hand-rolled scan instead of regex (no regex dep here).
fn parse_destination(stdout: &str) -> Option<Destination> {
    // `[download] <path> has already been downloaded` (case-insensitive marker).
    for line in stdout.lines() {
        let lower = line.to_lowercase();
        if let Some(dl_at) = lower.find("[download]") {
            if let Some(rel) = lower[dl_at..].find("has already been downloaded") {
                // Slice the ORIGINAL (case-preserving) line between the two markers.
                let start = dl_at + "[download]".len();
                let end = dl_at + rel;
                let path = line[start..end].trim().to_string();
                if !path.is_empty() {
                    return Some(Destination {
                        path,
                        already_downloaded: true,
                    });
                }
            }
        }
    }
    // `[Merger] Merging formats into "<path>"`.
    for line in stdout.lines() {
        if let Some(idx) = line.find("Merging formats into \"") {
            let after = &line[idx + "Merging formats into \"".len()..];
            if let Some(end) = after.find('"') {
                let path = after[..end].trim().to_string();
                if !path.is_empty() {
                    return Some(Destination {
                        path,
                        already_downloaded: false,
                    });
                }
            }
        }
    }
    // `[download] Destination: <path>`.
    for line in stdout.lines() {
        let lower = line.to_lowercase();
        if let Some(idx) = lower.find("[download] destination:") {
            let path = line[idx + "[download] destination:".len()..].trim().to_string();
            if !path.is_empty() {
                return Some(Destination {
                    path,
                    already_downloaded: false,
                });
            }
        }
    }
    None
}

/// Recover the `--write-thumbnail` poster path from yt-dlp stdout, e.g.
/// `[info] Writing video thumbnail original to: /downloads/_dm/abc.jpg`. Mirrors
/// the TS `parseThumbnail` regex `/Writing\s+(?:video\s+)?thumbnail\b[^\n]*?\bto:\s+(.+)/i`.
fn parse_thumbnail(stdout: &str) -> Option<String> {
    for line in stdout.lines() {
        let lower = line.to_lowercase();
        // Require "writing" … "thumbnail" … "to:" in order on one line.
        let Some(w) = lower.find("writing") else {
            continue;
        };
        let Some(t) = lower[w..].find("thumbnail") else {
            continue;
        };
        let thumb_at = w + t + "thumbnail".len();
        // `\bto:` — the ` to: ` separator after the (optional) "original" qualifier.
        let Some(to_rel) = lower[thumb_at..].find("to:") else {
            continue;
        };
        let path_start = thumb_at + to_rel + "to:".len();
        let path = line[path_start..].trim().to_string();
        if !path.is_empty() {
            return Some(path);
        }
    }
    None
}

/// Classify a finished sidecar run into a `DownloadResult` — Rust port of the TS
/// `classify` in `ytdlp.ts`: exit 0 → parse the destination (+ thumbnail) into
/// `Ok`/`Skipped`; nonzero → `categorize` the stderr.
fn classify(out: &RunOutput) -> DownloadResult {
    if out.code == 0 {
        let thumb_path = parse_thumbnail(&out.stdout);
        match parse_destination(&out.stdout) {
            None => DownloadResult::Unknown {
                reason: "yt-dlp exited 0 but no output path found".into(),
                exit_code: 0,
            },
            Some(dest) if dest.already_downloaded => DownloadResult::Skipped {
                output_path: dest.path,
                thumb_path,
            },
            Some(dest) => DownloadResult::Ok {
                output_path: dest.path,
                thumb_path,
            },
        }
    } else {
        categorize(&out.stderr, out.code)
    }
}

/// Run `run` with exponential backoff on `Transient` results only. Permanent
/// outcomes short-circuit (retrying wastes cycles + risks extra rate-limit
/// penalties). Mirrors the TS `runWithRetry` (maxAttempts=3, baseDelayMs=1000,
/// delay = base * 2^(attempt-1)). `sleep` is injected so tests pass a no-op and
/// production passes `tokio::time::sleep`.
async fn run_with_retry<RunFut, SleepFut>(
    run: impl Fn() -> RunFut,
    max_attempts: u32,
    base_delay_ms: u64,
    sleep: impl Fn(u64) -> SleepFut,
) -> DownloadResult
where
    RunFut: std::future::Future<Output = DownloadResult>,
    SleepFut: std::future::Future<Output = ()>,
{
    let mut last = DownloadResult::Transient {
        reason: "never ran".into(),
    };
    for attempt in 1..=max_attempts {
        last = run().await;
        if !matches!(last, DownloadResult::Transient { .. }) {
            return last;
        }
        if attempt < max_attempts {
            sleep(base_delay_ms * 2u64.pow(attempt - 1)).await;
        }
    }
    last
}

// ─────────────────────────────────────────────────────────────────────────────
// Rust-owned download queue (the engine). State + worker pump + commands.
// The shapes match `src/ui/lib/download-queue.ts` exactly (camelCase serde) so
// the TS mirror (increment 2b) can read the same store with no consumer changes.
// ─────────────────────────────────────────────────────────────────────────────

/// Output subdir under the downloads root for DM-shared downloads
/// (mirrors `DM_SLUG` in download-queue.ts). Used only for documentation parity;
/// the slug arrives per-item from the enqueue caller.
#[allow(dead_code)]
const DM_SLUG: &str = "_dm";

/// One queue entry. Matches the TS `DownloadItem` field-for-field (camelCase),
/// omitting `reason`/`localPath`/`thumbPath` when absent (TS leaves them `undefined`).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadItem {
    /// Namespaced unique key, `${source}:${refId}`.
    key: String,
    /// "saved" | "message" | "repost" — selects the persistence table + subdir.
    source: String,
    /// Row id within the source table.
    ref_id: i64,
    url: String,
    /// Output subdir under the downloads root (collection slug, `_dm`, `_reposts`).
    slug: String,
    /// "queued" | "running" | "ok" | "skipped" | "dead" | "loginWalled" | "error".
    status: String,
    progress: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    local_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thumb_path: Option<String>,
}

/// Snapshot of the whole queue (matches the TS `QueueState`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueState {
    items: HashMap<String, DownloadItem>,
    order: Vec<String>,
    running: usize,
}

/// Enqueue input from the WebView (matches the TS `EnqueueInput`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueItem {
    source: String,
    ref_id: i64,
    url: String,
    slug: String,
}

/// Inner, mutex-guarded queue state. `workers` is the count of live worker tasks
/// (the concurrency gate); `max_parallel`/`cookies_path` are the most recent
/// settings handed in via `enqueue_downloads`/`retry_failed_downloads`.
#[derive(Default)]
struct QueueInner {
    items: HashMap<String, DownloadItem>,
    order: Vec<String>,
    workers: usize,
    max_parallel: usize,
    cookies_path: Option<String>,
}

/// Tauri-managed download engine. A `std::sync::Mutex` (not tokio's) so the lock
/// is cheap and never held across an `.await` — the worker explicitly drops the
/// guard before awaiting the sidecar (the compiler enforces `!Send` guards can't
/// cross await points anyway).
#[derive(Default)]
pub struct DownloadEngine(Mutex<QueueInner>);

/// In-flight statuses: never re-enqueued, never cleared by `clear_finished`.
fn is_active(status: &str) -> bool {
    status == "queued" || status == "running"
}

/// Successful terminal statuses: skipped on re-enqueue (don't redo work).
fn is_success(status: &str) -> bool {
    status == "ok" || status == "skipped"
}

/// Terminal mapping of a `DownloadResult` → (queue status, DB status, relative
/// local path, relative thumb path, reason). Mirrors the TS `mapResult`: paths
/// are stored as `<slug>/<basename>` relative to the downloads root.
fn map_result(
    result: &DownloadResult,
    slug: &str,
) -> (String, String, Option<String>, Option<String>, Option<String>) {
    let rel = |p: &str| -> Option<String> {
        let base = basename(p);
        if base.is_empty() {
            None
        } else {
            Some(format!("{slug}/{base}"))
        }
    };
    match result {
        DownloadResult::Ok {
            output_path,
            thumb_path,
        }
        | DownloadResult::Skipped {
            output_path,
            thumb_path,
        } => {
            let status = if matches!(result, DownloadResult::Skipped { .. }) {
                "skipped"
            } else {
                "ok"
            };
            let local = rel(output_path);
            let thumb = thumb_path.as_deref().and_then(rel);
            (status.into(), "downloaded".into(), local, thumb, None)
        }
        DownloadResult::Dead { reason } => (
            "dead".into(),
            "dead".into(),
            None,
            None,
            Some(reason.clone()),
        ),
        DownloadResult::LoginWalled { reason } => (
            "loginWalled".into(),
            "login_walled".into(),
            None,
            None,
            Some(reason.clone()),
        ),
        DownloadResult::Transient { reason }
        | DownloadResult::Outdated { reason }
        | DownloadResult::Unknown { reason, .. } => (
            "error".into(),
            "error".into(),
            None,
            None,
            Some(reason.clone()),
        ),
    }
}

/// Last path segment (mirrors the TS `basename`: normalize `\`→`/`, drop empties).
fn basename(p: &str) -> String {
    p.replace('\\', "/")
        .split('/')
        .filter(|s| !s.is_empty())
        .next_back()
        .unwrap_or("")
        .to_string()
}

/// Emit one changed item to the WebView (`download://update`). Best-effort.
fn emit_update<R: Runtime>(app: &tauri::AppHandle<R>, item: &DownloadItem) {
    let _ = app.emit("download://update", item);
}

/// Spawn workers until the concurrency budget is full or no queued item remains.
/// Increments `workers` under the SAME lock that confirms a queued item exists,
/// so concurrent callers can't over-spawn past `max_parallel`.
fn ensure_workers<R: Runtime>(app: &tauri::AppHandle<R>, engine: &DownloadEngine) {
    loop {
        {
            let mut inner = match engine.0.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            let cap = inner.max_parallel.max(1);
            if inner.workers >= cap {
                return;
            }
            let has_queued = inner
                .order
                .iter()
                .any(|k| inner.items.get(k).is_some_and(|it| it.status == "queued"));
            if !has_queued {
                return;
            }
            inner.workers += 1;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            worker(app).await;
        });
    }
}

/// One worker task: claims queued items until none remain, then retires. Holds the
/// engine lock ONLY around state reads/writes — never across the sidecar await.
async fn worker<R: Runtime>(app: tauri::AppHandle<R>) {
    loop {
        // Claim the first queued item (mark running, progress 0), or retire.
        let claimed = {
            let engine = app.state::<DownloadEngine>();
            let mut inner = match engine.0.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            let next = inner
                .order
                .iter()
                .find(|k| inner.items.get(*k).is_some_and(|it| it.status == "queued"))
                .cloned();
            match next {
                None => {
                    inner.workers = inner.workers.saturating_sub(1);
                    return;
                }
                Some(key) => {
                    let cookies = inner.cookies_path.clone();
                    let it = inner.items.get_mut(&key).expect("just found");
                    it.status = "running".into();
                    it.progress = 0.0;
                    it.reason = None;
                    let snapshot = it.clone();
                    (
                        key,
                        snapshot.url.clone(),
                        snapshot.slug.clone(),
                        snapshot.source.clone(),
                        cookies,
                        snapshot,
                    )
                }
            }
        };
        let (key, url, slug, source, cookies, running_item) = claimed;
        emit_update(&app, &running_item);

        // Resolve the per-item output dir = <app_data>/downloads/<slug>.
        let output_dir = match app.path().app_data_dir() {
            Ok(dir) => dir.join("downloads").join(&slug),
            Err(e) => {
                log::warn!("download worker: app_data_dir failed: {e}");
                finish_item(&app, &key, &slug, &source, &DownloadResult::Unknown {
                    reason: format!("app_data_dir failed: {e}"),
                    exit_code: -1,
                });
                continue;
            }
        };
        let output_dir = output_dir.to_string_lossy().to_string();

        // Run the attempt with retry; progress updates patch the item + emit live.
        let cookies_ref = cookies.as_deref();
        let progress_app = app.clone();
        let progress_key = key.clone();
        let result = run_with_retry(
            || {
                let on_progress = |pct: f64| {
                    let engine = progress_app.state::<DownloadEngine>();
                    let updated = {
                        let Ok(mut inner) = engine.0.lock() else {
                            return;
                        };
                        match inner.items.get_mut(&progress_key) {
                            Some(it) => {
                                it.progress = pct;
                                Some(it.clone())
                            }
                            None => None,
                        }
                    };
                    if let Some(it) = updated {
                        emit_update(&progress_app, &it);
                    }
                };
                let app = app.clone();
                let url = url.clone();
                let output_dir = output_dir.clone();
                async move {
                    match run_attempt(&app, &url, &output_dir, cookies_ref, on_progress).await {
                        Ok(out) => classify(&out),
                        Err(e) => DownloadResult::Unknown {
                            reason: format!("download command failed: {e}"),
                            exit_code: -1,
                        },
                    }
                }
            },
            3,
            1000,
            |ms| tokio::time::sleep(std::time::Duration::from_millis(ms)),
        )
        .await;

        finish_item(&app, &key, &slug, &source, &result);
    }
}

/// Apply a terminal `DownloadResult` to the queue item (status/paths/reason +
/// progress 100 on success), emit `download://update`, then persist (best-effort).
fn finish_item<R: Runtime>(
    app: &tauri::AppHandle<R>,
    key: &str,
    slug: &str,
    source: &str,
    result: &DownloadResult,
) {
    let (status, db_status, local_path, thumb_path, reason) = map_result(result, slug);
    let (ref_id, terminal_item) = {
        let engine = app.state::<DownloadEngine>();
        let Ok(mut inner) = engine.0.lock() else {
            return;
        };
        match inner.items.get_mut(key) {
            Some(it) => {
                it.status = status.clone();
                it.reason = reason;
                it.local_path = local_path.clone();
                it.thumb_path = thumb_path.clone();
                if is_success(&status) {
                    it.progress = 100.0;
                }
                (it.ref_id, Some(it.clone()))
            }
            None => (0, None),
        }
    };
    if let Some(it) = &terminal_item {
        emit_update(app, it);
    }

    // Persist the terminal outcome through the single DB source of truth.
    let db = app.state::<Db>();
    let persisted = (|| -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::write_download_status(
            &conn,
            source,
            ref_id,
            &db_status,
            local_path.as_deref(),
            thumb_path.as_deref(),
        )
        .map_err(|e| e.to_string())
    })();
    if let Err(e) = persisted {
        log::warn!("download persistence failed (key={key}, source={source}): {e}");
    }
}

/// Enqueue downloads into the Rust queue. Stores the latest settings, applies the
/// same dedup the WebView used to do (skip items already active/successful;
/// failures may re-queue), emits a `download://update` per newly-queued item,
/// then spins up workers.
#[tauri::command]
pub fn enqueue_downloads<R: Runtime>(
    app: tauri::AppHandle<R>,
    engine: State<DownloadEngine>,
    items: Vec<EnqueueItem>,
    cookies_path: Option<String>,
    max_parallel: usize,
) -> Result<(), String> {
    let mut newly_queued: Vec<DownloadItem> = Vec::new();
    {
        let mut inner = engine.0.lock().map_err(|e| e.to_string())?;
        inner.cookies_path = cookies_path;
        inner.max_parallel = max_parallel;
        for input in items {
            let key = format!("{}:{}", input.source, input.ref_id);
            if let Some(existing) = inner.items.get(&key) {
                if is_active(&existing.status) || is_success(&existing.status) {
                    continue;
                }
            } else {
                inner.order.push(key.clone());
            }
            let item = DownloadItem {
                key: key.clone(),
                source: input.source,
                ref_id: input.ref_id,
                url: input.url,
                slug: input.slug,
                status: "queued".into(),
                progress: 0.0,
                reason: None,
                local_path: None,
                thumb_path: None,
            };
            inner.items.insert(key, item.clone());
            newly_queued.push(item);
        }
    }
    for item in &newly_queued {
        emit_update(&app, item);
    }
    ensure_workers(&app, &engine);
    Ok(())
}

/// Snapshot the current queue (for WebView hydration on load). `running` is the
/// live count of items in the `running` status (matches the TS `QueueState.running`).
#[tauri::command]
pub fn download_queue_snapshot(engine: State<DownloadEngine>) -> Result<QueueState, String> {
    let inner = engine.0.lock().map_err(|e| e.to_string())?;
    let running = inner
        .items
        .values()
        .filter(|it| it.status == "running")
        .count();
    Ok(QueueState {
        items: inner.items.clone(),
        order: inner.order.clone(),
        running,
    })
}

/// Drop all non-active items (mirrors the TS `clearFinished`: keep only
/// queued/running). Leaves in-flight downloads alone.
#[tauri::command]
pub fn clear_finished_downloads(engine: State<DownloadEngine>) -> Result<(), String> {
    let mut inner = engine.0.lock().map_err(|e| e.to_string())?;
    // Disjoint borrows: retain on `order` must read `items`, so bind both fields
    // to separate locals (the borrow checker can't split through one `inner.x`).
    let QueueInner { order, items, .. } = &mut *inner;
    order.retain(|k| items.get(k).is_some_and(|it| is_active(&it.status)));
    items.retain(|_, it| is_active(&it.status));
    Ok(())
}

/// Cancel a bulk fetch: drop every still-`queued` item so each worker retires once
/// its current download finishes. In-flight (`running`) items are left to complete
/// — we don't kill the live yt-dlp child — and terminal items stay so the dock keeps
/// showing results. The WebView mirrors this optimistically via `dropQueued`.
#[tauri::command]
pub fn cancel_downloads(engine: State<DownloadEngine>) -> Result<(), String> {
    let mut inner = engine.0.lock().map_err(|e| e.to_string())?;
    let QueueInner { order, items, .. } = &mut *inner;
    order.retain(|k| items.get(k).is_some_and(|it| it.status != "queued"));
    items.retain(|_, it| it.status != "queued");
    Ok(())
}

/// Re-queue items whose status is `loginWalled` or `error` (NOT `dead` — 404s
/// won't recover and would waste live requests). Mirrors the dock's "Retry failed".
#[tauri::command]
pub fn retry_failed_downloads<R: Runtime>(
    app: tauri::AppHandle<R>,
    engine: State<DownloadEngine>,
    cookies_path: Option<String>,
    max_parallel: usize,
) -> Result<(), String> {
    let mut requeued: Vec<DownloadItem> = Vec::new();
    {
        let mut inner = engine.0.lock().map_err(|e| e.to_string())?;
        inner.cookies_path = cookies_path;
        inner.max_parallel = max_parallel;
        let keys: Vec<String> = inner.order.clone();
        for key in keys {
            if let Some(it) = inner.items.get_mut(&key) {
                if it.status == "loginWalled" || it.status == "error" {
                    it.status = "queued".into();
                    it.progress = 0.0;
                    it.reason = None;
                    requeued.push(it.clone());
                }
            }
        }
    }
    for item in &requeued {
        emit_update(&app, item);
    }
    ensure_workers(&app, &engine);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        basename, categorize, classify, is_downloadable_permalink, is_stale_version, map_result,
        parse_destination, parse_progress_line, parse_thumbnail, run_with_retry, DownloadResult,
        RunOutput,
    };
    use std::cell::Cell;

    #[test]
    fn validates_downloadable_permalinks() {
        assert!(is_downloadable_permalink("https://www.instagram.com/reel/DW3cSqIlB7O/"));
        assert!(is_downloadable_permalink("https://www.instagram.com/p/DYSSbo7kTKw/?x=1"));
        assert!(is_downloadable_permalink("https://www.instagram.com/someuser/reel/ABC/"));
        assert!(is_downloadable_permalink("https://fb.watch/abc123/"));
        assert!(is_downloadable_permalink("https://www.facebook.com/user/videos/123/"));
        // Rejected: profile pages, other hosts, look-alikes, non-web schemes.
        assert!(!is_downloadable_permalink("https://www.instagram.com/example_user/"));
        assert!(!is_downloadable_permalink("https://evil.example.com/reel/x/"));
        assert!(!is_downloadable_permalink("https://www.instagram.com.evil.com/reel/x/"));
        assert!(!is_downloadable_permalink("https://evil.com/instagram.com/reel/x/"));
        assert!(!is_downloadable_permalink("file:///etc/passwd"));
        assert!(!is_downloadable_permalink("javascript:alert(1)"));
    }

    #[test]
    fn parses_progress_percentages() {
        assert_eq!(
            parse_progress_line("[download]  12.3% of   8.62MiB at  1.20MiB/s ETA 00:06"),
            Some(12.3)
        );
        assert_eq!(
            parse_progress_line("[download] 100% of 8.62MiB in 00:07"),
            Some(100.0)
        );
        assert_eq!(
            parse_progress_line("[download]   0.0% of ~8.62MiB at Unknown B/s ETA Unknown"),
            Some(0.0)
        );
    }

    #[test]
    fn ignores_non_progress_lines() {
        assert_eq!(parse_progress_line("[download] Destination: /x/abc.mp4"), None);
        assert_eq!(
            parse_progress_line("[Merger] Merging formats into \"/x/abc.mp4\""),
            None
        );
        assert_eq!(parse_progress_line(""), None);
    }

    #[test]
    fn clamps_above_100() {
        assert_eq!(parse_progress_line("[download] 150% of x"), Some(100.0));
    }

    // ── categorize (mirrors ytdlp-core.test.ts) ──────────────────────────────

    #[test]
    fn categorize_flags_dead() {
        assert!(matches!(
            categorize("ERROR: [Instagram] Video unavailable", 1),
            DownloadResult::Dead { .. }
        ));
        assert!(matches!(
            categorize("ERROR: HTTP Error 404: Not Found", 1),
            DownloadResult::Dead { .. }
        ));
        assert!(matches!(
            categorize("ERROR: HTTP Error 410: Gone", 1),
            DownloadResult::Dead { .. }
        ));
    }

    #[test]
    fn categorize_flags_login_walled() {
        assert!(matches!(
            categorize("ERROR: Login required to access this content", 1),
            DownloadResult::LoginWalled { .. }
        ));
        assert!(matches!(
            categorize("ERROR: use --cookies for this", 1),
            DownloadResult::LoginWalled { .. }
        ));
    }

    #[test]
    fn categorize_flags_transient() {
        assert!(matches!(
            categorize("ERROR: read timeout", 1),
            DownloadResult::Transient { .. }
        ));
        assert!(matches!(
            categorize("ERROR: HTTP Error 503: Service Unavailable", 1),
            DownloadResult::Transient { .. }
        ));
        // Live Phase 0 finding: 429 is retryable.
        assert!(matches!(
            categorize("ERROR: HTTP Error 429: Too Many Requests", 1),
            DownloadResult::Transient { .. }
        ));
    }

    #[test]
    fn categorize_unknown_carries_exit_code() {
        match categorize("ERROR: something never seen before", 7) {
            DownloadResult::Unknown { exit_code, .. } => assert_eq!(exit_code, 7),
            other => panic!("expected Unknown, got {other:?}"),
        }
    }

    #[test]
    fn categorize_truncates_long_reason() {
        let stderr = format!("ERROR: {}", "x".repeat(1000));
        match categorize(&stderr, 1) {
            DownloadResult::Unknown { reason, .. } => assert!(reason.chars().count() <= 300),
            other => panic!("expected Unknown, got {other:?}"),
        }
    }

    #[test]
    fn categorize_flags_outdated_extractor() {
        for stderr in [
            "ERROR: Unable to extract shared data; please report this issue",
            "ERROR: Unsupported URL: https://www.instagram.com/reel/xyz/",
            "ERROR: No video formats found!",
            "ERROR: yt-dlp is out of date, update with `yt-dlp -U`",
        ] {
            match categorize(stderr, 1) {
                DownloadResult::Outdated { reason } => {
                    assert!(reason.contains("update yt-dlp"), "actionable reason for {stderr:?}")
                }
                other => panic!("expected Outdated for {stderr:?}, got {other:?}"),
            }
        }
    }

    #[test]
    fn categorize_outdated_loses_to_more_specific() {
        // A login wall whose message also says "unable to extract" stays loginWalled —
        // adding cookies is more actionable than updating the downloader.
        assert!(matches!(
            categorize("ERROR: Unable to extract data; login required", 1),
            DownloadResult::LoginWalled { .. }
        ));
    }

    // ── is_stale_version (date-string compare, pin injected) ─────────────────

    #[test]
    fn flags_only_older_sidecar_as_stale() {
        assert!(is_stale_version("2026.03.16", "2026.03.17"));
        assert!(!is_stale_version("2026.03.17", "2026.03.17"));
        assert!(!is_stale_version("2026.04.01", "2026.03.17"));
        // Same-day nightly (build suffix) is newer, not stale.
        assert!(!is_stale_version("2026.03.17.123456", "2026.03.17"));
    }

    // ── parse_destination (mirrors ytdlp-core.test.ts) ───────────────────────

    #[test]
    fn parse_destination_reads_destination_line() {
        let d = parse_destination("[download] Destination: /out/abc.mp4").unwrap();
        assert_eq!(d.path, "/out/abc.mp4");
        assert!(!d.already_downloaded);
    }

    #[test]
    fn parse_destination_prefers_merger_over_destination() {
        let stdout = "[download] Destination: /out/abc.f399.mp4\n\
             [download] Destination: /out/abc.f140.m4a\n\
             [Merger] Merging formats into \"/out/abc.mp4\"";
        let d = parse_destination(stdout).unwrap();
        assert_eq!(d.path, "/out/abc.mp4");
        assert!(!d.already_downloaded);
    }

    #[test]
    fn parse_destination_detects_already_downloaded() {
        let d = parse_destination("[download] /out/abc.mp4 has already been downloaded").unwrap();
        assert_eq!(d.path, "/out/abc.mp4");
        assert!(d.already_downloaded);
    }

    #[test]
    fn parse_destination_returns_none_when_no_match() {
        assert!(parse_destination("[info] nothing useful here").is_none());
    }

    // ── parse_thumbnail (mirrors ytdlp-core.test.ts) ─────────────────────────

    #[test]
    fn parse_thumbnail_reads_written_path() {
        assert_eq!(
            parse_thumbnail("[info] Writing video thumbnail original to: /out/abc.jpg").as_deref(),
            Some("/out/abc.jpg")
        );
    }

    #[test]
    fn parse_thumbnail_tolerates_short_phrasing() {
        assert_eq!(
            parse_thumbnail("[info] Writing thumbnail to: /out/x.webp").as_deref(),
            Some("/out/x.webp")
        );
    }

    #[test]
    fn parse_thumbnail_finds_line_among_others() {
        let stdout = "[download] Destination: /out/abc.mp4\n\
             [info] Writing video thumbnail 0 to: /out/abc.jpg\n\
             [download] 100%";
        assert_eq!(parse_thumbnail(stdout).as_deref(), Some("/out/abc.jpg"));
    }

    #[test]
    fn parse_thumbnail_returns_none_when_absent() {
        assert!(parse_thumbnail("[download] Destination: /out/abc.mp4").is_none());
    }

    // ── classify (mirrors ytdlp.ts) ──────────────────────────────────────────

    #[test]
    fn classify_ok_on_exit_zero_with_destination() {
        let out = RunOutput {
            code: 0,
            stdout: "[download] Destination: /out/abc.mp4\n\
                 [info] Writing video thumbnail original to: /out/abc.jpg"
                .into(),
            stderr: String::new(),
        };
        match classify(&out) {
            DownloadResult::Ok {
                output_path,
                thumb_path,
            } => {
                assert_eq!(output_path, "/out/abc.mp4");
                assert_eq!(thumb_path.as_deref(), Some("/out/abc.jpg"));
            }
            other => panic!("expected Ok, got {other:?}"),
        }
    }

    #[test]
    fn classify_skipped_on_already_downloaded() {
        let out = RunOutput {
            code: 0,
            stdout: "[download] /out/abc.mp4 has already been downloaded".into(),
            stderr: String::new(),
        };
        assert!(matches!(classify(&out), DownloadResult::Skipped { .. }));
    }

    #[test]
    fn classify_unknown_when_exit_zero_but_no_path() {
        let out = RunOutput {
            code: 0,
            stdout: "[info] nothing useful".into(),
            stderr: String::new(),
        };
        match classify(&out) {
            DownloadResult::Unknown { exit_code, .. } => assert_eq!(exit_code, 0),
            other => panic!("expected Unknown, got {other:?}"),
        }
    }

    #[test]
    fn classify_categorizes_nonzero_exit() {
        let out = RunOutput {
            code: 1,
            stdout: String::new(),
            stderr: "ERROR: HTTP Error 404: Not Found".into(),
        };
        assert!(matches!(classify(&out), DownloadResult::Dead { .. }));
    }

    // ── run_with_retry (mirrors ytdlp-core.test.ts, no-op sleep) ─────────────

    #[test]
    fn retry_succeeds_on_third_attempt_with_backoff() {
        let attempts = Cell::new(0u32);
        let delays = std::cell::RefCell::new(Vec::<u64>::new());
        let result = tauri::async_runtime::block_on(run_with_retry(
            || {
                let n = attempts.get() + 1;
                attempts.set(n);
                async move {
                    if n < 3 {
                        DownloadResult::Transient { reason: "flaky".into() }
                    } else {
                        DownloadResult::Ok {
                            output_path: "/x/abc.mp4".into(),
                            thumb_path: None,
                        }
                    }
                }
            },
            3,
            100,
            |ms| {
                delays.borrow_mut().push(ms);
                async {}
            },
        ));
        assert!(matches!(result, DownloadResult::Ok { .. }));
        assert_eq!(attempts.get(), 3);
        assert_eq!(*delays.borrow(), vec![100, 200]);
    }

    #[test]
    fn retry_short_circuits_on_dead() {
        let attempts = Cell::new(0u32);
        let slept = Cell::new(false);
        let result = tauri::async_runtime::block_on(run_with_retry(
            || {
                attempts.set(attempts.get() + 1);
                async { DownloadResult::Dead { reason: "gone".into() } }
            },
            3,
            1000,
            |_ms| {
                slept.set(true);
                async {}
            },
        ));
        assert!(matches!(result, DownloadResult::Dead { .. }));
        assert_eq!(attempts.get(), 1);
        assert!(!slept.get(), "must not sleep when short-circuiting");
    }

    #[test]
    fn retry_gives_up_after_max_attempts_of_transient() {
        let attempts = Cell::new(0u32);
        let result = tauri::async_runtime::block_on(run_with_retry(
            || {
                attempts.set(attempts.get() + 1);
                async { DownloadResult::Transient { reason: "flaky".into() } }
            },
            3,
            1000,
            |_ms| async {},
        ));
        assert!(matches!(result, DownloadResult::Transient { .. }));
        assert_eq!(attempts.get(), 3);
    }

    // ── map_result + basename (mirrors download-queue.ts mapResult) ───────────

    #[test]
    fn map_result_ok_builds_relative_paths() {
        let r = DownloadResult::Ok {
            output_path: "/downloads/conspri/abc.mp4".into(),
            thumb_path: Some("/downloads/conspri/abc.jpg".into()),
        };
        let (status, db_status, local, thumb, reason) = map_result(&r, "conspri");
        assert_eq!(status, "ok");
        assert_eq!(db_status, "downloaded");
        assert_eq!(local.as_deref(), Some("conspri/abc.mp4"));
        assert_eq!(thumb.as_deref(), Some("conspri/abc.jpg"));
        assert!(reason.is_none());
    }

    #[test]
    fn map_result_login_walled_and_dead_and_error() {
        let (s, db, lp, _tp, reason) =
            map_result(&DownloadResult::LoginWalled { reason: "login".into() }, "x");
        assert_eq!((s.as_str(), db.as_str()), ("loginWalled", "login_walled"));
        assert!(lp.is_none() && reason.as_deref() == Some("login"));

        let (s, db, ..) = map_result(&DownloadResult::Dead { reason: "gone".into() }, "x");
        assert_eq!((s.as_str(), db.as_str()), ("dead", "dead"));

        // Transient, outdated, and unknown all collapse to the "error" terminal status.
        let (s, db, ..) = map_result(&DownloadResult::Transient { reason: "net".into() }, "x");
        assert_eq!((s.as_str(), db.as_str()), ("error", "error"));
        let (s, db, .., reason) =
            map_result(&DownloadResult::Outdated { reason: "update yt-dlp".into() }, "x");
        assert_eq!((s.as_str(), db.as_str()), ("error", "error"));
        assert_eq!(reason.as_deref(), Some("update yt-dlp"));
        let (s, db, ..) =
            map_result(&DownloadResult::Unknown { reason: "huh".into(), exit_code: 9 }, "x");
        assert_eq!((s.as_str(), db.as_str()), ("error", "error"));
    }

    #[test]
    fn basename_handles_separators() {
        assert_eq!(basename("/downloads/conspri/abc.mp4"), "abc.mp4");
        assert_eq!(basename("conspri\\abc.mp4"), "abc.mp4");
        assert_eq!(basename(""), "");
    }
}
