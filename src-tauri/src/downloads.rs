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

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use tauri::http::{header, Request, Response};
use tauri::{Manager, Runtime, UriSchemeContext};

use crate::media::{content_type, not_found, respond_ranged};

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

/// Strong cache validator for a downloaded file: length + mtime. The bytes never
/// change once written (a re-download reuses the same `%(id)s` path), so this is a
/// stable, immutable validator.
fn file_etag(meta: &fs::Metadata) -> String {
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("\"{:x}-{:x}\"", meta.len(), mtime)
}

/// Read the inclusive byte range [start, end] from `path` without loading the whole
/// file — seek to `start`, read exactly `end - start + 1` bytes.
fn read_file_range(path: &Path, start: usize, end: usize) -> Result<Vec<u8>, String> {
    let mut f = File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    f.seek(SeekFrom::Start(start as u64)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; end - start + 1];
    f.read_exact(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// `dmedia://` scheme handler. Serves a downloaded file under the fixed downloads
/// root with a guessed content-type, an immutable ETag, and capped Range support
/// (so video seeks read only the requested chunk), reusing `vmedia`'s response
/// plumbing.
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
    let meta = match fs::metadata(&path) {
        Ok(m) => m,
        Err(e) => {
            log::warn!("dmedia stat {}: {e}", path.display());
            return not_found();
        }
    };
    let total = meta.len() as usize;
    let etag = file_etag(&meta);
    let ctype = content_type(&rel);
    let headers = request.headers();
    let range_header = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let if_none_match = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok());

    respond_ranged(total, &etag, ctype, range_header, if_none_match, |start, end| {
        read_file_range(&path, start, end)
    })
}

#[cfg(test)]
mod tests {
    use super::{file_etag, read_file_range, resolve_within};
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

    #[test]
    fn reads_inclusive_byte_ranges() {
        let root = std::env::temp_dir().join(format!("demetafy_range_{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let p = root.join("f.bin");
        let data: Vec<u8> = (0..5000u32).map(|i| (i % 256) as u8).collect();
        fs::write(&p, &data).unwrap();

        assert_eq!(read_file_range(&p, 0, 9).unwrap(), data[0..=9]);
        assert_eq!(read_file_range(&p, 1000, 1999).unwrap(), data[1000..=1999]);
        assert_eq!(read_file_range(&p, 0, data.len() - 1).unwrap(), data);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn file_etag_is_quoted_and_stable() {
        let root = std::env::temp_dir().join(format!("demetafy_etag_{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let p = root.join("f.bin");
        fs::write(&p, b"hello").unwrap();

        let e1 = file_etag(&fs::metadata(&p).unwrap());
        assert!(e1.starts_with('"') && e1.ends_with('"'));
        assert_eq!(e1, file_etag(&fs::metadata(&p).unwrap()));

        let _ = fs::remove_dir_all(&root);
    }
}
