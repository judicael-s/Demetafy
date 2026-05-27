//! On-disk serving of yt-dlp-downloaded media via the `dmedia://` scheme, plus
//! the download-root resolver command.
//!
//! Saved videos fetched by the bundled yt-dlp sidecar land on the FILESYSTEM,
//! not in the archive zip (the zip is read-only), under a fixed root:
//!   `app_data_dir()/downloads/<collection-slug>/<id>.<ext>`
//! so the `vmedia` scheme (zip-only) can't serve them — this is the parallel
//! on-disk path. The URL shape mirrors `vmedia` (and Tauri's `convertFileSrc`):
//! `http://dmedia.localhost/<enc>` on Windows, `dmedia://localhost/<enc>`
//! elsewhere, where `<enc>` is `encodeURIComponent(<slug>/<id>.<ext>)`.
//!
//! Security: the request path is a RELATIVE path under the fixed root. We reject
//! absolute paths and any non-`Normal` component (`..`, root, prefix), then
//! canonicalize and confirm containment before reading — no arbitrary FS read.

use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::http::{header, Request, Response};
use tauri::{Manager, Runtime, UriSchemeContext};

use crate::media::{content_type, not_found, respond};

/// Absolute path to the (created-on-demand) downloads root: app_data_dir/downloads.
/// `pub(crate)` so the avatar fetcher can store cached images under it (and have
/// them served by the same `dmedia://` handler).
pub(crate) fn downloads_root<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("downloads");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The absolute downloads root as a string, for the JS side to build yt-dlp `-o`
/// output templates. Created if missing.
#[tauri::command]
pub fn download_dir<R: Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    let dir = downloads_root(&app)?;
    dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "downloads dir path is not valid UTF-8".into())
}

/// Reject absolute paths and any non-`Normal` component, then join under `root`
/// and confirm the canonicalized target stays within the canonicalized root.
/// Returns None (→ 404) on any rejection or if the file doesn't exist.
fn resolve_within(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return None;
    }
    for c in rel_path.components() {
        if !matches!(c, Component::Normal(_)) {
            return None; // ParentDir, RootDir, Prefix, CurDir → reject
        }
    }
    let joined = root.join(rel_path);
    let canon_root = fs::canonicalize(root).ok()?;
    let canon_target = fs::canonicalize(&joined).ok()?;
    canon_target.starts_with(&canon_root).then_some(canon_target)
}

/// `dmedia://` scheme handler. Reads a downloaded file under the fixed downloads
/// root and serves it with a guessed content-type and Range support (so video
/// can seek), reusing the same response plumbing as `vmedia`.
pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let rel = crate::media::percent_decode(request.uri().path().trim_start_matches('/'));
    if rel.is_empty() {
        return not_found();
    }
    let app = ctx.app_handle();
    let root = match downloads_root(app) {
        Ok(r) => r,
        Err(e) => {
            log::warn!("dmedia root: {e}");
            return not_found();
        }
    };
    let path = match resolve_within(&root, &rel) {
        Some(p) => p,
        None => {
            log::warn!("dmedia reject/miss: {rel}");
            return not_found();
        }
    };
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("dmedia read {}: {e}", path.display());
            return not_found();
        }
    };
    let ctype = content_type(&rel);
    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok());
    respond(bytes, ctype, range_header)
}

#[cfg(test)]
mod tests {
    use super::resolve_within;
    use std::fs;

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        let root = std::env::temp_dir().join("demetafy_dmedia_reject");
        let _ = fs::create_dir_all(&root);
        assert!(resolve_within(&root, "../etc/passwd").is_none());
        assert!(resolve_within(&root, "a/../../b").is_none());
        assert!(resolve_within(&root, "C:/Windows/System32/cmd.exe").is_none());
        assert!(resolve_within(&root, "/etc/passwd").is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolves_real_file_within_root() {
        let root = std::env::temp_dir().join(format!("demetafy_dmedia_ok_{}", std::process::id()));
        let sub = root.join("conspri");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("abc.mp4"), b"data").unwrap();
        assert!(resolve_within(&root, "conspri/abc.mp4").is_some());
        assert!(resolve_within(&root, "conspri/missing.mp4").is_none());
        let _ = fs::remove_dir_all(&root);
    }
}
