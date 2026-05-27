//! On-demand media serving from the archive zip via the `vmedia://` URI scheme.
//!
//! DM photos/videos/gifs/voice-notes are referenced in the DB by their relative
//! zip entry path (e.g. `your_instagram_activity/messages/inbox/<thread>/photos/<id>.jpg`).
//! Re-extracting them all to disk would undercut the privacy/footprint story, so the
//! WebView fetches each entry lazily through this scheme instead. The archive handle
//! from ingest is closed, so we keep our own lazily-opened, cached `ZipArchive`.
//!
//! URL shape (mirrors Tauri's `convertFileSrc`): the frontend builds
//! `http://vmedia.localhost/<encodeURIComponent(entry)>` on Windows and
//! `vmedia://localhost/<…>` elsewhere. The entry path therefore arrives
//! percent-encoded (slashes included) in the request path; we decode it back.
//!
//! No path-traversal risk: we index into the zip's central directory via
//! `by_name`, not the filesystem, so `../` simply fails to match an entry.

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::sync::Mutex;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext};
use zip::ZipArchive;

use crate::db::Db;

/// Hard ceiling on a single media entry we'll buffer into memory (zip-bomb / huge
/// declared-size defense). Above any realistic DYI media file.
const MAX_MEDIA_ENTRY: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Default)]
pub struct MediaArchive(pub Mutex<Option<OpenArchive>>);

pub struct OpenArchive {
    paths: Vec<String>,
    parts: Vec<ArchivePart>,
    name_to_part: Option<HashMap<String, usize>>,
}

pub struct ArchivePart {
    path: String,
    zip: Option<ZipArchive<File>>,
}

impl OpenArchive {
    fn new(paths: Vec<String>) -> Self {
        let parts = paths
            .iter()
            .cloned()
            .map(|path| ArchivePart { path, zip: None })
            .collect();
        Self {
            paths,
            parts,
            name_to_part: None,
        }
    }

    fn open_part(&mut self, idx: usize) -> Result<(), String> {
        let part = self
            .parts
            .get_mut(idx)
            .ok_or_else(|| format!("part {idx} out of range"))?;
        if part.zip.is_none() {
            let file = File::open(&part.path).map_err(|e| format!("open {}: {e}", part.path))?;
            let zip = ZipArchive::new(file).map_err(|e| format!("read zip {}: {e}", part.path))?;
            part.zip = Some(zip);
        }
        Ok(())
    }

    fn ensure_index(&mut self) -> Result<&HashMap<String, usize>, String> {
        if self.name_to_part.is_none() {
            let mut by_name = HashMap::new();
            for part_idx in 0..self.parts.len() {
                self.open_part(part_idx)?;
                let zip = self.parts[part_idx]
                    .zip
                    .as_mut()
                    .ok_or_else(|| format!("part {part_idx} was not opened"))?;
                for entry_idx in 0..zip.len() {
                    let zf = zip
                        .by_index(entry_idx)
                        .map_err(|e| format!("read central directory entry {entry_idx}: {e}"))?;
                    let name = zf.name().to_string();
                    select_part_for_name(&mut by_name, name, part_idx)?;
                }
            }
            self.name_to_part = Some(by_name);
        }
        Ok(self.name_to_part.as_ref().unwrap())
    }

    fn read_entry(&mut self, entry: &str) -> Result<Vec<u8>, String> {
        let part_idx = select_part_for_entry(self.ensure_index()?, entry)
            .ok_or_else(|| format!("entry {entry}: not found in any archive part"))?;
        self.open_part(part_idx)?;
        let zip = self.parts[part_idx]
            .zip
            .as_mut()
            .ok_or_else(|| format!("part {part_idx} was not opened"))?;
        let zf = zip
            .by_name(entry)
            .map_err(|e| format!("entry {entry} in part {part_idx}: {e}"))?;
        if zf.size() > MAX_MEDIA_ENTRY {
            return Err(format!("entry {entry} too large ({} bytes)", zf.size()));
        }
        let cap = zf.size().min(MAX_MEDIA_ENTRY) as usize;
        let mut buf = Vec::with_capacity(cap);
        zf.take(MAX_MEDIA_ENTRY + 1)
            .read_to_end(&mut buf)
            .map_err(|e| e.to_string())?;
        if buf.len() as u64 > MAX_MEDIA_ENTRY {
            return Err(format!("entry {entry} exceeded size limit"));
        }
        Ok(buf)
    }
}

/// Pure helper used by the browse-time merged archive index. It records which
/// part owns a zip entry name and rejects cross-part path collisions — a collision
/// means the selected files are not one clean logical Meta export.
pub(crate) fn select_part_for_name(
    by_name: &mut HashMap<String, usize>,
    name: String,
    part_idx: usize,
) -> Result<(), String> {
    if let Some(existing) = by_name.get(&name) {
        return Err(format!(
            "entry {name} appears in both archive part {existing} and archive part {part_idx}"
        ));
    }
    by_name.insert(name, part_idx);
    Ok(())
}

/// Pure lookup helper: given a prebuilt `name → part-index` map, choose the part
/// that should serve `entry`.
pub(crate) fn select_part_for_entry(
    by_name: &HashMap<String, usize>,
    entry: &str,
) -> Option<usize> {
    by_name.get(entry).copied()
}

/// Split a `vmedia` request path into an optional service segment and the still-encoded
/// entry. The frontend emits `<service>/<encodeURIComponent(entry)>` when a service is
/// active (the entry never contains a raw `/`, since `encodeURIComponent` escapes it),
/// or a bare encoded entry otherwise. The service scopes which logical archive the entry
/// resolves against so Instagram and Facebook media don't cross once both are imported.
pub(crate) fn split_service_path(path: &str) -> (Option<&str>, &str) {
    match path.split_once('/') {
        Some((service, entry)) => (Some(service), entry),
        None => (None, path),
    }
}

pub(crate) fn content_type(entry: &str) -> &'static str {
    let ext = entry.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" | "heif" => "image/heic",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "m4a" | "aac" => "audio/mp4",
        "mp3" => "audio/mpeg",
        "ogg" | "opus" => "audio/ogg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

/// Decode a percent-encoded URL path back to a zip entry name. The frontend uses
/// `encodeURIComponent`, so slashes arrive as `%2F`. No `+`→space handling — that
/// is form encoding, which `encodeURIComponent` never emits.
pub(crate) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Parse a single `Range: bytes=start-end` header into an inclusive (start, end)
/// clamped to `total`. Returns None for absent/empty/multi-range/unsatisfiable
/// specs — the caller then serves the full body (200), which is a fine fallback.
pub(crate) fn parse_range(spec: &str, total: usize) -> Option<(usize, usize)> {
    if total == 0 {
        return None;
    }
    let spec = spec.strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None; // multi-range unsupported
    }
    let (a, b) = spec.split_once('-')?;
    let last = total - 1;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", "") => return None,
        ("", suffix) => {
            let n: usize = suffix.parse().ok()?;
            (total.saturating_sub(n.min(total)), last)
        }
        (s, "") => (s.parse().ok()?, last),
        (s, e) => (s.parse().ok()?, e.parse::<usize>().ok()?.min(last)),
    };
    if start > end || start > last {
        return None;
    }
    Some((start, end))
}

pub(crate) fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Vec::new())
        .unwrap()
}

/// Build a media response from a full body, honoring a single-range request
/// (206) or serving the whole body (200). Shared by the `vmedia` (zip) and
/// `dmedia` (on-disk download) scheme handlers — both read the bytes their own
/// way, then hand off the byte/content-type/range plumbing here.
pub(crate) fn respond(bytes: Vec<u8>, ctype: &str, range_header: Option<&str>) -> Response<Vec<u8>> {
    let total = bytes.len();
    let range = range_header.and_then(|v| parse_range(v, total));
    match range {
        Some((start, end)) => {
            let slice = bytes[start..=end].to_vec();
            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, ctype)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                .header(header::CONTENT_LENGTH, slice.len().to_string())
                .body(slice)
                .unwrap()
        }
        None => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, ctype)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_LENGTH, total.to_string())
            .body(bytes)
            .unwrap(),
    }
}

fn read_entry<R: Runtime>(
    app: &tauri::AppHandle<R>,
    service: Option<&str>,
    entry: &str,
) -> Result<Vec<u8>, String> {
    // Resolve the part set for the *active service's* archive first, releasing the DB
    // lock before touching zip files so we never hold two locks at once (vmedia is the
    // only two-lock path). The service scopes the lookup so that, with both Instagram
    // and Facebook imported, IG media never resolves against the newer FB archive (or
    // vice versa); `None` falls back to the newest archive (single-service installs).
    // Step 16A backfills single-zip archives with one row in `archive_parts`, so there
    // is intentionally no `source_path` fallback here.
    let paths: Vec<String> = {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let latest_archive_id: i64 = conn
            .query_row(
                "SELECT id FROM archives WHERE (?1 IS NULL OR service = ?1) ORDER BY id DESC LIMIT 1",
                [service],
                |r| r.get(0),
            )
            .map_err(|e| format!("no archive ingested: {e}"))?;
        let mut stmt = conn
            .prepare("SELECT path FROM archive_parts WHERE archive_id = ?1 ORDER BY idx")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([latest_archive_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut paths = Vec::new();
        for row in rows {
            paths.push(row.map_err(|e| e.to_string())?);
        }
        if paths.is_empty() {
            return Err(format!(
                "archive {latest_archive_id} has no archive_parts rows"
            ));
        }
        paths
    };

    let media = app.state::<MediaArchive>();
    let mut guard = media.0.lock().map_err(|e| e.to_string())?;
    let needs_refresh = guard
        .as_ref()
        .map(|open| open.paths != paths)
        .unwrap_or(true);
    if needs_refresh {
        *guard = Some(OpenArchive::new(paths));
    }
    guard.as_mut().unwrap().read_entry(entry)
}

/// `vmedia://` scheme handler. Reads the requested archive entry and returns it
/// with a guessed content-type, honoring single-range requests (206) so video
/// and audio can seek in WebView2.
pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let (service, encoded_entry) = split_service_path(request.uri().path().trim_start_matches('/'));
    let service = service.map(percent_decode);
    let entry = percent_decode(encoded_entry);
    if entry.is_empty() {
        return not_found();
    }
    let bytes = match read_entry(ctx.app_handle(), service.as_deref(), &entry) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("vmedia {entry}: {e}");
            return not_found();
        }
    };
    let ctype = content_type(&entry);
    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok());
    respond(bytes, ctype, range_header)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_type_by_ext() {
        assert_eq!(content_type("a/b/c.JPG"), "image/jpeg");
        assert_eq!(content_type("x.png"), "image/png");
        assert_eq!(content_type("clip.mp4"), "video/mp4");
        assert_eq!(content_type("voice.m4a"), "audio/mp4");
        assert_eq!(content_type("anim.gif"), "image/gif");
        assert_eq!(content_type("noext"), "application/octet-stream");
    }

    #[test]
    fn percent_decode_slashes_and_utf8() {
        assert_eq!(
            percent_decode("your_instagram_activity%2Fmessages%2Finbox%2Fx%2Fphotos%2F1.jpg"),
            "your_instagram_activity/messages/inbox/x/photos/1.jpg"
        );
        assert_eq!(percent_decode("a/b.png"), "a/b.png");
        assert_eq!(percent_decode("caf%C3%A9.jpg"), "café.jpg");
        assert_eq!(percent_decode("trailing%2"), "trailing%2"); // malformed → passthrough
    }

    #[test]
    fn range_parsing() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=100-", 1000), Some((100, 999)));
        assert_eq!(parse_range("bytes=-50", 1000), Some((950, 999)));
        assert_eq!(parse_range("bytes=0-5000", 1000), Some((0, 999))); // end clamped
        assert_eq!(parse_range("bytes=0-99,200-299", 1000), None); // multi-range
        assert_eq!(parse_range("bytes=abc", 1000), None);
        assert_eq!(parse_range("bytes=500-100", 1000), None); // start > end
        assert_eq!(parse_range("bytes=0-0", 0), None); // empty body
    }

    #[test]
    fn part_selection_maps_entries_to_owning_part() {
        let mut index = HashMap::new();
        select_part_for_name(&mut index, "a/photo.jpg".to_string(), 0).unwrap();
        select_part_for_name(&mut index, "b/video.mp4".to_string(), 2).unwrap();

        assert_eq!(select_part_for_entry(&index, "a/photo.jpg"), Some(0));
        assert_eq!(select_part_for_entry(&index, "b/video.mp4"), Some(2));
        assert_eq!(select_part_for_entry(&index, "missing.png"), None);
    }

    #[test]
    fn part_selection_rejects_cross_part_collisions() {
        let mut index = HashMap::new();
        select_part_for_name(&mut index, "dup.jpg".to_string(), 0).unwrap();
        let err = select_part_for_name(&mut index, "dup.jpg".to_string(), 1).unwrap_err();

        assert!(err.contains("dup.jpg"));
        assert!(err.contains("part 0"));
        assert!(err.contains("part 1"));
    }

    #[test]
    fn split_service_path_separates_service_from_entry() {
        assert_eq!(
            split_service_path("instagram/your_activity%2Fphotos%2F1.jpg"),
            (Some("instagram"), "your_activity%2Fphotos%2F1.jpg")
        );
        assert_eq!(
            split_service_path("facebook/x.png"),
            (Some("facebook"), "x.png")
        );
        // No service prefix (legacy / single archive): the whole path is the entry,
        // since an encodeURIComponent-encoded entry never contains a raw slash.
        assert_eq!(
            split_service_path("media%2Fprofile%2Fa.jpg"),
            (None, "media%2Fprofile%2Fa.jpg")
        );
    }
}
