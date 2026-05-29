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
use std::io::{Read, Seek, SeekFrom};
use std::sync::Mutex;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext};
use zip::{CompressionMethod, ZipArchive};

use crate::db::Db;

/// Hard ceiling on a single media entry we'll buffer into memory (zip-bomb / huge
/// declared-size defense). Above any realistic DYI media file.
const MAX_MEDIA_ENTRY: u64 = 2 * 1024 * 1024 * 1024;

/// Cache directive for media responses. Archive entries and downloaded files are
/// immutable — an entry's bytes never change, and a re-download reuses the same
/// `%(id)s` path — so the WebView may cache aggressively and skip the round-trip.
pub(crate) const CACHE_IMMUTABLE: &str = "private, max-age=31536000, immutable";

/// Max bytes returned for a single 206. The WebView media stack opens video with
/// an open-ended `Range: bytes=0-`; without a cap that means reading the WHOLE
/// file (e.g. the Saved grid's `#t=0.1` poster trick would pull an entire video
/// into memory just to paint a thumbnail). Capping makes `preload="metadata"`,
/// poster frames, and seeking fetch bounded chunks; Chromium/WebKit request the
/// next chunk as playback advances.
const RANGE_CHUNK: usize = 4 * 1024 * 1024;

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

/// Central-directory metadata for one entry — enough to build cache validators and
/// serve a byte range without first reading the entry. `data_start` is the offset
/// of the entry's raw bytes within its part, used for random access on `Stored`
/// entries (Meta stores already-compressed media uncompressed).
#[derive(Clone, Copy)]
struct EntryMeta {
    part_idx: usize,
    size: u64,
    crc32: u32,
    compression: CompressionMethod,
    data_start: u64,
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

    /// Read an entry's central-directory metadata (size, crc, compression, data
    /// offset) without reading its bytes. Enforces the size ceiling up front.
    fn entry_meta(&mut self, entry: &str) -> Result<EntryMeta, String> {
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
        Ok(EntryMeta {
            part_idx,
            size: zf.size(),
            crc32: zf.crc32(),
            compression: zf.compression(),
            data_start: zf.data_start(),
        })
    }

    /// Read the inclusive byte range [start, end] of an entry. `Stored` entries
    /// (Meta's media) are served by seeking the part file directly to the entry's
    /// data offset — no decompression, no whole-file read. `Deflated`/other entries
    /// (rare for media) fall back to decompressing the whole entry, then slicing.
    fn read_entry_range(
        &mut self,
        entry: &str,
        meta: &EntryMeta,
        start: usize,
        end: usize,
    ) -> Result<Vec<u8>, String> {
        match meta.compression {
            CompressionMethod::Stored => {
                let path = self
                    .parts
                    .get(meta.part_idx)
                    .map(|p| p.path.as_str())
                    .ok_or_else(|| format!("part {} out of range", meta.part_idx))?;
                let mut f = File::open(path).map_err(|e| format!("open {path}: {e}"))?;
                f.seek(SeekFrom::Start(meta.data_start + start as u64))
                    .map_err(|e| e.to_string())?;
                let mut buf = vec![0u8; end - start + 1];
                f.read_exact(&mut buf).map_err(|e| e.to_string())?;
                Ok(buf)
            }
            _ => {
                let full = self.read_entry_full(entry, meta.part_idx)?;
                let last = full.len().saturating_sub(1);
                if start > last || end > last {
                    return Err(format!("range {start}-{end} beyond entry {entry}"));
                }
                Ok(full[start..=end].to_vec())
            }
        }
    }

    /// Decompress an entry fully into memory (the `Deflated` fallback path).
    fn read_entry_full(&mut self, entry: &str, part_idx: usize) -> Result<Vec<u8>, String> {
        self.open_part(part_idx)?;
        let zip = self.parts[part_idx]
            .zip
            .as_mut()
            .ok_or_else(|| format!("part {part_idx} was not opened"))?;
        let zf = zip
            .by_name(entry)
            .map_err(|e| format!("entry {entry} in part {part_idx}: {e}"))?;
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

/// Split a `vmedia` request path into an optional archive-id segment and the still-encoded
/// entry. The frontend emits `<archiveId>/<encodeURIComponent(entry)>` when an account is
/// active (the entry never contains a raw `/`, since `encodeURIComponent` escapes it), or a
/// bare encoded entry otherwise. The id scopes which imported archive the entry resolves
/// against so media never crosses between accounts. A non-numeric (or absent) prefix means
/// no scope — the handler falls back to the newest archive.
pub(crate) fn split_archive_path(path: &str) -> (Option<i64>, &str) {
    if let Some((prefix, entry)) = path.split_once('/') {
        if let Ok(id) = prefix.parse::<i64>() {
            return (Some(id), entry);
        }
    }
    (None, path)
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

/// Does an `If-None-Match` header satisfy our (strong) `etag`? Accepts `*`, an
/// exact match, or a comma-separated list (optionally weak-prefixed) containing it.
fn etag_matches(if_none_match: &str, etag: &str) -> bool {
    if_none_match == "*"
        || if_none_match.split(',').any(|t| {
            let t = t.trim();
            t == etag || t.strip_prefix("W/").map(str::trim) == Some(etag)
        })
}

pub(crate) fn not_modified(etag: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_MODIFIED)
        .header(header::ETAG, etag)
        .header(header::CACHE_CONTROL, CACHE_IMMUTABLE)
        .body(Vec::new())
        .unwrap()
}

/// Build a media response, reading ONLY the bytes needed via `read_slice(start, end)`
/// (inclusive) rather than buffering the whole file. Honors `If-None-Match` (304, no
/// read), a single-range request (206, capped to `RANGE_CHUNK`), or serves the whole
/// body (200). Shared by the `vmedia` (zip) and `dmedia` (on-disk) scheme handlers.
pub(crate) fn respond_ranged(
    total: usize,
    etag: &str,
    ctype: &str,
    range_header: Option<&str>,
    if_none_match: Option<&str>,
    read_slice: impl FnOnce(usize, usize) -> Result<Vec<u8>, String>,
) -> Response<Vec<u8>> {
    if let Some(inm) = if_none_match {
        if etag_matches(inm, etag) {
            return not_modified(etag);
        }
    }
    match range_header.and_then(|v| parse_range(v, total)) {
        Some((start, requested_end)) => {
            let end = requested_end.min(start + RANGE_CHUNK - 1);
            match read_slice(start, end) {
                Ok(slice) => Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(header::CONTENT_TYPE, ctype)
                    .header(header::ACCEPT_RANGES, "bytes")
                    .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                    .header(header::CONTENT_LENGTH, slice.len().to_string())
                    .header(header::CACHE_CONTROL, CACHE_IMMUTABLE)
                    .header(header::ETAG, etag)
                    .body(slice)
                    .unwrap(),
                Err(e) => {
                    log::warn!("media range read: {e}");
                    not_found()
                }
            }
        }
        None => {
            let body = if total == 0 {
                Ok(Vec::new())
            } else {
                read_slice(0, total - 1)
            };
            match body {
                Ok(body) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, ctype)
                    .header(header::ACCEPT_RANGES, "bytes")
                    .header(header::CONTENT_LENGTH, body.len().to_string())
                    .header(header::CACHE_CONTROL, CACHE_IMMUTABLE)
                    .header(header::ETAG, etag)
                    .body(body)
                    .unwrap(),
                Err(e) => {
                    log::warn!("media full read: {e}");
                    not_found()
                }
            }
        }
    }
}

/// Resolve the ordered part paths for the *active account's* archive. The DB lock is
/// taken and released here, before any zip access, so we never hold the DB and media
/// locks at once (vmedia is the only two-lock path). `archive_id` scopes the lookup so
/// media never crosses between imports; `None` falls back to the newest archive (the
/// brief window before the UI sets the active account). Step 16A backfills single-zip
/// archives with one `archive_parts` row, so there is intentionally no `source_path`
/// fallback here.
fn resolve_paths<R: Runtime>(
    app: &tauri::AppHandle<R>,
    archive_id: Option<i64>,
) -> Result<Vec<String>, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let resolved_archive_id: i64 = conn
        .query_row(
            "SELECT id FROM archives WHERE (?1 IS NULL OR id = ?1) ORDER BY id DESC LIMIT 1",
            [archive_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("no archive ingested: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT path FROM archive_parts WHERE archive_id = ?1 ORDER BY idx")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([resolved_archive_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut paths = Vec::new();
    for row in rows {
        paths.push(row.map_err(|e| e.to_string())?);
    }
    if paths.is_empty() {
        return Err(format!(
            "archive {resolved_archive_id} has no archive_parts rows"
        ));
    }
    Ok(paths)
}

/// `vmedia://` scheme handler. Serves the requested archive entry with a guessed
/// content-type, a strong ETag (`size-crc32`) + immutable caching, and single-range
/// support (206, capped) so video/audio seek cheaply in the WebView without ever
/// reading the whole entry.
pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let (archive_id, encoded_entry) =
        split_archive_path(request.uri().path().trim_start_matches('/'));
    let entry = percent_decode(encoded_entry);
    if entry.is_empty() {
        return not_found();
    }
    let app = ctx.app_handle();
    let paths = match resolve_paths(app, archive_id) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("vmedia {entry}: {e}");
            return not_found();
        }
    };

    let media = app.state::<MediaArchive>();
    let mut guard = match media.0.lock() {
        Ok(g) => g,
        Err(e) => {
            log::warn!("vmedia lock: {e}");
            return not_found();
        }
    };
    let needs_refresh = guard
        .as_ref()
        .map(|open| open.paths != paths)
        .unwrap_or(true);
    if needs_refresh {
        *guard = Some(OpenArchive::new(paths));
    }
    let open = guard.as_mut().unwrap();

    let meta = match open.entry_meta(&entry) {
        Ok(m) => m,
        Err(e) => {
            log::warn!("vmedia {entry}: {e}");
            return not_found();
        }
    };
    let total = meta.size as usize;
    let etag = format!("\"{:x}-{:x}\"", meta.size, meta.crc32);
    let ctype = content_type(&entry);
    let headers = request.headers();
    let range_header = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let if_none_match = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok());

    respond_ranged(total, &etag, ctype, range_header, if_none_match, |start, end| {
        open.read_entry_range(&entry, &meta, start, end)
    })
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
    fn split_archive_path_separates_id_from_entry() {
        assert_eq!(
            split_archive_path("7/your_activity%2Fphotos%2F1.jpg"),
            (Some(7), "your_activity%2Fphotos%2F1.jpg")
        );
        assert_eq!(split_archive_path("12/x.png"), (Some(12), "x.png"));
        // No numeric prefix (legacy / single archive): the whole path is the entry,
        // since an encodeURIComponent-encoded entry never contains a raw slash.
        assert_eq!(
            split_archive_path("media%2Fprofile%2Fa.jpg"),
            (None, "media%2Fprofile%2Fa.jpg")
        );
    }

    #[test]
    fn respond_ranged_full_range_and_conditional() {
        let data: Vec<u8> = (0..1000u32).map(|i| i as u8).collect();
        let etag = "\"abc\"";
        let slice = |d: &[u8]| {
            let d = d.to_vec();
            move |s: usize, e: usize| Ok(d[s..=e].to_vec())
        };

        // No range → 200 full body, with cache validators.
        let r = respond_ranged(data.len(), etag, "video/mp4", None, None, slice(&data));
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.body().len(), 1000);
        assert_eq!(r.headers().get(header::ETAG).unwrap(), etag);
        assert!(r.headers().get(header::CACHE_CONTROL).is_some());

        // Explicit range → 206 with exact slice + Content-Range.
        let r = respond_ranged(data.len(), etag, "video/mp4", Some("bytes=10-19"), None, slice(&data));
        assert_eq!(r.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            r.headers().get(header::CONTENT_RANGE).unwrap().to_str().unwrap(),
            "bytes 10-19/1000"
        );
        assert_eq!(r.body(), &data[10..=19]);

        // Matching If-None-Match → 304 and the body reader is never invoked.
        let r = respond_ranged(data.len(), etag, "video/mp4", None, Some(etag), |_, _| {
            panic!("must not read on a 304")
        });
        assert_eq!(r.status(), StatusCode::NOT_MODIFIED);
        assert!(r.body().is_empty());
    }

    #[test]
    fn respond_ranged_caps_open_ended_range() {
        let total = RANGE_CHUNK * 3;
        let r = respond_ranged(total, "\"x\"", "video/mp4", Some("bytes=0-"), None, |s, e| {
            Ok(vec![0u8; e - s + 1])
        });
        assert_eq!(r.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(r.body().len(), RANGE_CHUNK);
        assert_eq!(
            r.headers().get(header::CONTENT_RANGE).unwrap().to_str().unwrap(),
            format!("bytes 0-{}/{}", RANGE_CHUNK - 1, total)
        );
    }

    #[test]
    fn stored_entry_meta_and_ranged_read() {
        use std::io::Write;
        use zip::write::{SimpleFileOptions, ZipWriter};

        let dir = std::env::temp_dir().join(format!("demetafy_vmedia_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let zip_path = dir.join("part.zip");
        let data: Vec<u8> = (0..20_000u32).map(|i| (i % 251) as u8).collect();
        {
            let f = File::create(&zip_path).unwrap();
            let mut w = ZipWriter::new(f);
            let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
            w.start_file("media/clip.mp4", opts).unwrap();
            w.write_all(&data).unwrap();
            w.finish().unwrap();
        }

        let mut open = OpenArchive::new(vec![zip_path.to_string_lossy().into_owned()]);
        let meta = open.entry_meta("media/clip.mp4").unwrap();
        assert_eq!(meta.size as usize, data.len());
        assert!(matches!(meta.compression, CompressionMethod::Stored));
        // A mid-file range must match the original bytes (validates data_start math).
        assert_eq!(
            open.read_entry_range("media/clip.mp4", &meta, 5000, 5099).unwrap(),
            data[5000..=5099]
        );
        // The (0, total-1) range — the 200 path — must reconstruct the whole entry.
        assert_eq!(
            open.read_entry_range("media/clip.mp4", &meta, 0, data.len() - 1).unwrap(),
            data
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
