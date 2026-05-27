//! Opt-in Instagram friend-avatar fetch — the ONE feature in Demetafy that makes
//! network calls to Meta. It is OFF by default and gated on the user's cookie jar.
//!
//! yt-dlp can't return profile pictures, so this is a bespoke fetch against
//! Instagram's private `web_profile_info` endpoint (parse `profile_pic_url_hd`,
//! then download the CDN image). That endpoint is unofficial and changes without
//! notice — when it breaks, fetches return `error` and the UI keeps the monogram.
//! Facebook is unsupported: its connections export carries no handle to look up.

use std::fs;
use std::io::Read;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::{Emitter, Manager, Runtime};

use crate::db::{upsert_avatar, Db};

const IG_APP_ID: &str = "936619743392459";
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) \
     Chrome/120.0.0.0 Safari/537.36";
/// Throttle between batch fetches; a longer pause after a rate-limit signal so we
/// back off instead of hammering the endpoint into a harder block.
const THROTTLE_MS: u64 = 1500;
const BACKOFF_MS: u64 = 10_000;
/// Hard ceiling on a fetched avatar image. A profile pic is tens of KB; capping the
/// read keeps a malicious/oversized response from exhausting memory (mirrors the
/// bounded reads in media.rs / archive.rs).
const MAX_AVATAR_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AvatarProgress {
    done: usize,
    total: usize,
    handle: String,
    status: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AvatarStatus {
    Ok,
    Unavailable,
    LoginWalled,
    RateLimited,
    Error,
}

impl AvatarStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Unavailable => "unavailable",
            Self::LoginWalled => "login_walled",
            Self::RateLimited => "rate_limited",
            Self::Error => "error",
        }
    }
}

fn web_profile_info_url(handle: &str) -> String {
    format!("https://i.instagram.com/api/v1/users/web_profile_info/?username={handle}")
}

/// Instagram handles are `[A-Za-z0-9._]`, ≤30 chars. Validating before we interpolate
/// an archive-derived handle into the request URL stops it from injecting query
/// params or a fragment, and short-circuits obviously bogus lookups.
fn is_valid_ig_handle(handle: &str) -> bool {
    !handle.is_empty()
        && handle.len() <= 30
        && handle
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_')
}

/// Restrict the image fetch to Meta's CDN over HTTPS. `profile_pic_url_hd` comes from
/// a parsed API response we don't fully trust, so without this an attacker who can
/// shape that response could point the fetch at an internal/arbitrary host (SSRF).
fn is_allowed_cdn_url(url: &str) -> bool {
    let rest = match url.strip_prefix("https://") {
        Some(r) => r,
        None => return false,
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or(authority); // strip any userinfo
    let host = host.split(':').next().unwrap_or(host); // strip any port
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "cdninstagram.com"
        || host.ends_with(".cdninstagram.com")
        || host == "fbcdn.net"
        || host.ends_with(".fbcdn.net")
}

/// Magic-byte sniff for the image types Instagram serves. A non-image body (an HTML
/// error page, a redirect blob) must not be cached on disk as a `.jpg`.
fn looks_like_image(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xFF, 0xD8, 0xFF]) // JPEG
        || bytes.starts_with(b"\x89PNG\r\n\x1a\n") // PNG
        || bytes.starts_with(b"GIF8") // GIF
        || (bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP") // WebP
}

/// Pull the best profile-pic URL from a `web_profile_info` body. None when the
/// user is null (not found / private shape) or the body isn't the expected JSON.
fn extract_pic_url(body: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).ok()?;
    let user = v.get("data")?.get("user")?;
    if user.is_null() {
        return None;
    }
    user.get("profile_pic_url_hd")
        .and_then(Value::as_str)
        .or_else(|| user.get("profile_pic_url").and_then(Value::as_str))
        .map(str::to_string)
}

/// Map a non-2xx HTTP status to a terminal-ish fetch status.
fn classify_status(code: u16) -> AvatarStatus {
    match code {
        401 | 403 => AvatarStatus::LoginWalled,
        404 => AvatarStatus::Unavailable,
        429 => AvatarStatus::RateLimited,
        _ => AvatarStatus::Error,
    }
}

/// Parse a Netscape `cookies.txt`, returning instagram.com cookies as (name, value).
/// Tolerates the `#HttpOnly_` prefix (a real cookie line, not a comment).
fn instagram_cookies(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.trim_end();
        let line = line.strip_prefix("#HttpOnly_").unwrap_or(line);
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 7 {
            continue;
        }
        if !cols[0].contains("instagram.com") {
            continue;
        }
        let (name, value) = (cols[5], cols[6]);
        if !name.is_empty() {
            out.push((name.to_string(), value.to_string()));
        }
    }
    out
}

fn cookie_header(cookies: &[(String, String)]) -> String {
    cookies
        .iter()
        .map(|(n, v)| format!("{n}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

/// Sanitize a handle into a safe single-segment filename (alphanumerics plus
/// `. _ -`; everything else → `_`; no leading/trailing dots). Defence-in-depth on
/// top of the dmedia path-traversal guard.
fn safe_handle(handle: &str) -> String {
    let mapped: String = handle
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = mapped.trim_matches('.');
    if trimmed.is_empty() {
        "_".to_string()
    } else {
        trimmed.to_string()
    }
}

struct FetchResult {
    status: AvatarStatus,
    bytes: Option<Vec<u8>>,
}

/// One network round-trip: resolve the profile-pic URL, then download the image.
/// Never panics — every failure maps to a status. (Not unit-tested: needs a live
/// Instagram session; the pure helpers it composes are tested below.)
fn fetch_avatar_once(handle: &str, cookie_hdr: &str) -> FetchResult {
    if !is_valid_ig_handle(handle) {
        return FetchResult { status: AvatarStatus::Unavailable, bytes: None };
    }
    let mut req = ureq::get(&web_profile_info_url(handle))
        .set("User-Agent", USER_AGENT)
        .set("x-ig-app-id", IG_APP_ID)
        .set("Accept", "*/*");
    if !cookie_hdr.is_empty() {
        req = req.set("Cookie", cookie_hdr);
    }

    let body = match req.call() {
        Ok(r) => match r.into_string() {
            Ok(b) => b,
            Err(_) => return FetchResult { status: AvatarStatus::Error, bytes: None },
        },
        Err(ureq::Error::Status(code, _)) => {
            return FetchResult { status: classify_status(code), bytes: None }
        }
        Err(_) => return FetchResult { status: AvatarStatus::Error, bytes: None },
    };

    let pic_url = match extract_pic_url(&body) {
        Some(u) => u,
        None => return FetchResult { status: AvatarStatus::Unavailable, bytes: None },
    };
    if !is_allowed_cdn_url(&pic_url) {
        return FetchResult { status: AvatarStatus::Error, bytes: None };
    }

    match ureq::get(&pic_url).set("User-Agent", USER_AGENT).call() {
        Ok(r) => {
            let mut buf = Vec::new();
            if r.into_reader()
                .take(MAX_AVATAR_BYTES)
                .read_to_end(&mut buf)
                .is_ok()
                && looks_like_image(&buf)
            {
                FetchResult { status: AvatarStatus::Ok, bytes: Some(buf) }
            } else {
                FetchResult { status: AvatarStatus::Error, bytes: None }
            }
        }
        Err(_) => FetchResult { status: AvatarStatus::Error, bytes: None },
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Read the user's cookie jar (same file Settings points yt-dlp at) into a
/// `Cookie` header value. Empty when no jar is configured → fetches will fall to
/// `login_walled`, which is the correct outcome to surface.
fn read_cookie_header(cookies_path: Option<&str>) -> Result<String, String> {
    match cookies_path {
        Some(p) if !p.is_empty() => {
            let text = fs::read_to_string(p).map_err(|e| e.to_string())?;
            Ok(cookie_header(&instagram_cookies(&text)))
        }
        _ => Ok(String::new()),
    }
}

/// Write a successful image under `<downloads_root>/avatars/ig/<handle>.jpg` and
/// record the outcome in the `avatars` table. A 429 is transient — leave no row so
/// the handle retries on a later run. Returns the status. Pulls the DB from the app
/// state so the batch worker (a detached thread) can reuse it.
fn store_and_persist<R: Runtime>(
    app: &tauri::AppHandle<R>,
    handle: &str,
    result: &FetchResult,
) -> Result<AvatarStatus, String> {
    let mut local_path: Option<String> = None;
    if let (AvatarStatus::Ok, Some(bytes)) = (result.status, result.bytes.as_ref()) {
        let dir = crate::downloads::downloads_root(app)?
            .join("avatars")
            .join("ig");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let fname = format!("{}.jpg", safe_handle(handle));
        fs::write(dir.join(&fname), bytes).map_err(|e| e.to_string())?;
        local_path = Some(format!("avatars/ig/{fname}"));
    }
    if result.status != AvatarStatus::RateLimited {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        upsert_avatar(
            &conn,
            "instagram",
            handle,
            result.status.as_str(),
            local_path.as_deref(),
            now_ms(),
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(result.status)
}

/// Fetch one Instagram avatar and cache it. Returns the status string. Instagram only.
#[tauri::command]
pub fn fetch_ig_avatar<R: Runtime>(
    app: tauri::AppHandle<R>,
    handle: String,
    cookies_path: Option<String>,
) -> Result<String, String> {
    let cookie_hdr = read_cookie_header(cookies_path.as_deref())?;
    let result = fetch_avatar_once(&handle, &cookie_hdr);
    let status = store_and_persist(&app, &handle, &result)?;
    Ok(status.as_str().to_string())
}

/// Fetch many avatars on a detached worker thread, throttled (~1.5s apart, longer
/// after a 429), emitting `avatar://progress` per handle and `avatar://done` at the
/// end. Returns immediately; the UI tracks progress via the events and re-reads
/// `query_avatars`. The caller is expected to pass only handles not already cached.
#[tauri::command]
pub fn fetch_ig_avatars<R: Runtime>(
    app: tauri::AppHandle<R>,
    handles: Vec<String>,
    cookies_path: Option<String>,
) -> Result<(), String> {
    let cookie_hdr = read_cookie_header(cookies_path.as_deref())?;
    std::thread::spawn(move || {
        let total = handles.len();
        for (i, handle) in handles.iter().enumerate() {
            let result = fetch_avatar_once(handle, &cookie_hdr);
            let status = result.status;
            if let Err(e) = store_and_persist(&app, handle, &result) {
                log::warn!("avatar persist {handle}: {e}");
            }
            let _ = app.emit(
                "avatar://progress",
                AvatarProgress {
                    done: i + 1,
                    total,
                    handle: handle.clone(),
                    status: status.as_str().to_string(),
                },
            );
            if i + 1 < total {
                let pause = if status == AvatarStatus::RateLimited {
                    BACKOFF_MS
                } else {
                    THROTTLE_MS
                };
                std::thread::sleep(std::time::Duration::from_millis(pause));
            }
        }
        let _ = app.emit("avatar://done", total);
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_pic_url_prefers_hd_and_handles_missing() {
        let hd = r#"{"data":{"user":{"profile_pic_url_hd":"https://x/hd.jpg","profile_pic_url":"https://x/sd.jpg"}}}"#;
        assert_eq!(extract_pic_url(hd).as_deref(), Some("https://x/hd.jpg"));

        let sd = r#"{"data":{"user":{"profile_pic_url":"https://x/sd.jpg"}}}"#;
        assert_eq!(extract_pic_url(sd).as_deref(), Some("https://x/sd.jpg"));

        assert_eq!(extract_pic_url(r#"{"data":{"user":null}}"#), None);
        assert_eq!(extract_pic_url(r#"{"data":{"user":{}}}"#), None);
        assert_eq!(extract_pic_url("not json"), None);
    }

    #[test]
    fn classify_status_maps_codes() {
        assert_eq!(classify_status(401), AvatarStatus::LoginWalled);
        assert_eq!(classify_status(403), AvatarStatus::LoginWalled);
        assert_eq!(classify_status(404), AvatarStatus::Unavailable);
        assert_eq!(classify_status(429), AvatarStatus::RateLimited);
        assert_eq!(classify_status(500), AvatarStatus::Error);
    }

    #[test]
    fn instagram_cookies_filters_domain_and_handles_httponly() {
        let jar = "\
# Netscape HTTP Cookie File
.instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\tSESS123
#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t0\tcsrftoken\tCSRF456
.facebook.com\tTRUE\t/\tTRUE\t0\tc_user\tFB789
# a comment line
malformed line without tabs";
        let cookies = instagram_cookies(jar);
        assert_eq!(
            cookies,
            vec![
                ("sessionid".to_string(), "SESS123".to_string()),
                ("csrftoken".to_string(), "CSRF456".to_string()),
            ]
        );
        assert_eq!(cookie_header(&cookies), "sessionid=SESS123; csrftoken=CSRF456");
    }

    #[test]
    fn safe_handle_strips_path_chars_and_leading_dots() {
        assert_eq!(safe_handle("user.name"), "user.name");
        assert_eq!(safe_handle("a/b"), "a_b");
        assert_eq!(safe_handle("../evil"), "_evil");
        assert_eq!(safe_handle("....."), "_");
        assert_eq!(safe_handle("Café_user!"), "Caf__user_");
    }

    #[test]
    fn web_profile_info_url_includes_handle() {
        assert!(web_profile_info_url("adrienbroner").ends_with("username=adrienbroner"));
    }

    #[test]
    fn is_valid_ig_handle_accepts_real_rejects_injection() {
        assert!(is_valid_ig_handle("adrienbroner"));
        assert!(is_valid_ig_handle("user.name_1"));
        assert!(!is_valid_ig_handle("")); // empty
        assert!(!is_valid_ig_handle("victim?ext_param=x")); // query injection
        assert!(!is_valid_ig_handle("a b")); // space
        assert!(!is_valid_ig_handle("a/b")); // path char
        assert!(!is_valid_ig_handle(&"x".repeat(31))); // over length cap
    }

    #[test]
    fn is_allowed_cdn_url_locks_to_meta_https() {
        assert!(is_allowed_cdn_url(
            "https://scontent-xyz.cdninstagram.com/v/t51.2885-19/abc.jpg"
        ));
        assert!(is_allowed_cdn_url("https://static.xx.fbcdn.net/abc.jpg"));
        assert!(!is_allowed_cdn_url("http://scontent.cdninstagram.com/abc.jpg")); // not https
        assert!(!is_allowed_cdn_url("https://169.254.169.254/latest/meta-data")); // SSRF target
        assert!(!is_allowed_cdn_url("https://localhost/abc.jpg"));
        assert!(!is_allowed_cdn_url("https://cdninstagram.com.evil.com/abc.jpg")); // look-alike host
        assert!(!is_allowed_cdn_url("https://evil.com/cdninstagram.com")); // CDN string in path, not host
    }

    #[test]
    fn looks_like_image_sniffs_magic_bytes() {
        assert!(looks_like_image(&[0xFF, 0xD8, 0xFF, 0xE0])); // JPEG
        assert!(looks_like_image(b"\x89PNG\r\n\x1a\n----")); // PNG
        assert!(looks_like_image(b"RIFF????WEBPVP8 ")); // WebP
        assert!(!looks_like_image(b"<!DOCTYPE html>")); // HTML error page
        assert!(!looks_like_image(b"")); // empty
    }
}
