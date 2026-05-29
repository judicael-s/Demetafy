//! Zip archive bridge. The WebView's TypeScript parsers (reused from Phase 0)
//! consume archive entries through these commands instead of yauzl. Mirrors the
//! `ArchiveReader` surface: open → list/has/read → close. Handles are kept in a
//! Mutex-guarded map so the same archive can be read across many IPC calls
//! without re-parsing the central directory each time.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek};
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;
use zip::ZipArchive;

/// Hard ceiling on a single text entry we'll buffer. Defends against a malicious ZIP
/// whose central directory declares a huge uncompressed size, or a compression bomb.
/// DYI JSON files run to tens of MB at most; 512 MB is far above any legitimate one.
const MAX_TEXT_ENTRY: u64 = 512 * 1024 * 1024;

#[derive(Default)]
pub struct Archives(pub Mutex<ArchiveStore>);

#[derive(Default)]
pub struct ArchiveStore {
    next_id: u32,
    open: HashMap<u32, ZipArchive<File>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryHeader {
    file_name: String,
    uncompressed_size: u64,
    compressed_size: u64,
}

fn invalid_handle() -> String {
    "invalid archive handle".to_string()
}

// ── Testable helpers ────────────────────────────────────────────────────────
// Generic over the reader so unit tests can pass a `Cursor<Vec<u8>>` instead
// of a real `File`, making the zip-crate wrapper testable without touching the
// Tauri `State<Archives>` machinery (which can't be constructed in unit tests).

fn list_entries_from<R: Read + Seek>(zip: &mut ZipArchive<R>) -> Result<Vec<EntryHeader>, String> {
    let mut out = Vec::with_capacity(zip.len());
    for i in 0..zip.len() {
        let f = zip.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() {
            continue;
        }
        out.push(EntryHeader {
            file_name: f.name().to_string(),
            uncompressed_size: f.size(),
            compressed_size: f.compressed_size(),
        });
    }
    Ok(out)
}

fn read_text_from<R: Read + Seek>(zip: &mut ZipArchive<R>, name: &str) -> Result<String, String> {
    let f = zip
        .by_name(name)
        .map_err(|e| format!("entry {name}: {e}"))?;
    if f.size() > MAX_TEXT_ENTRY {
        return Err(format!("entry {name} too large ({} bytes)", f.size()));
    }
    let cap = f.size().min(MAX_TEXT_ENTRY) as usize;
    let mut buf = Vec::with_capacity(cap);
    f.take(MAX_TEXT_ENTRY + 1)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    if buf.len() as u64 > MAX_TEXT_ENTRY {
        return Err(format!("entry {name} exceeded size limit"));
    }
    // Meta JSON files are ASCII (every multibyte char is a \u00XX escape), so
    // UTF-8 decoding is lossless here. from_utf8_lossy is a safety net for any
    // stray raw bytes. The mojibake fix runs later, in the TS parsers.
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn has_entry_from<R: Read + Seek>(zip: &mut ZipArchive<R>, name: &str) -> bool {
    zip.by_name(name).is_ok()
}

#[tauri::command]
pub fn archive_open(state: State<Archives>, path: String) -> Result<u32, String> {
    let file = File::open(&path).map_err(|e| format!("open {path}: {e}"))?;
    let zip = ZipArchive::new(file).map_err(|e| format!("read zip {path}: {e}"))?;
    let mut store = state.0.lock().map_err(|e| e.to_string())?;
    store.next_id += 1;
    let id = store.next_id;
    store.open.insert(id, zip);
    Ok(id)
}

#[tauri::command]
pub fn archive_list_entries(
    state: State<Archives>,
    handle: u32,
) -> Result<Vec<EntryHeader>, String> {
    let mut store = state.0.lock().map_err(|e| e.to_string())?;
    let zip = store.open.get_mut(&handle).ok_or_else(invalid_handle)?;
    list_entries_from(zip)
}

#[tauri::command]
pub fn archive_read_text(
    state: State<Archives>,
    handle: u32,
    name: String,
) -> Result<String, String> {
    let mut store = state.0.lock().map_err(|e| e.to_string())?;
    let zip = store.open.get_mut(&handle).ok_or_else(invalid_handle)?;
    read_text_from(zip, &name)
}

#[tauri::command]
pub fn archive_has_entry(
    state: State<Archives>,
    handle: u32,
    name: String,
) -> Result<bool, String> {
    let mut store = state.0.lock().map_err(|e| e.to_string())?;
    let zip = store.open.get_mut(&handle).ok_or_else(invalid_handle)?;
    Ok(has_entry_from(zip, &name))
}

#[tauri::command]
pub fn archive_close(state: State<Archives>, handle: u32) -> Result<(), String> {
    let mut store = state.0.lock().map_err(|e| e.to_string())?;
    store.open.remove(&handle);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::{SimpleFileOptions, ZipWriter};
    use zip::CompressionMethod;

    /// Build an in-memory zip from `(entry_name, bytes)` pairs.
    fn zip_from_files(files: &[(&str, &[u8])]) -> ZipArchive<Cursor<Vec<u8>>> {
        let cursor = Cursor::new(Vec::new());
        let mut w = ZipWriter::new(cursor);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, data) in files {
            w.start_file(*name, opts).unwrap();
            w.write_all(data).unwrap();
        }
        ZipArchive::new(w.finish().unwrap()).unwrap()
    }

    /// Like `zip_from_files` but also inserts explicit directory entries.
    fn zip_with_dir(files: &[(&str, &[u8])], dirs: &[&str]) -> ZipArchive<Cursor<Vec<u8>>> {
        let cursor = Cursor::new(Vec::new());
        let mut w = ZipWriter::new(cursor);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for dir in dirs {
            w.add_directory(*dir, opts).unwrap();
        }
        for (name, data) in files {
            w.start_file(*name, opts).unwrap();
            w.write_all(data).unwrap();
        }
        ZipArchive::new(w.finish().unwrap()).unwrap()
    }

    #[test]
    fn list_entries_returns_files_and_skips_directories() {
        let mut zip = zip_with_dir(
            &[("a.json", b"{}"), ("sub/b.json", b"[]")],
            &["empty_dir/"],
        );
        let entries = list_entries_from(&mut zip).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.file_name.as_str()).collect();
        assert_eq!(names.len(), 2, "expected 2 file entries, got: {names:?}");
        assert!(names.contains(&"a.json"));
        assert!(names.contains(&"sub/b.json"));
        assert!(!names.contains(&"empty_dir/"), "directory must be skipped");
    }

    #[test]
    fn read_text_round_trips_utf8() {
        // "café" encodes as 5 bytes in UTF-8 — ensures the lossless-decode path
        // works correctly for multibyte characters.
        let mut zip = zip_from_files(&[("test.txt", "café".as_bytes())]);
        let text = read_text_from(&mut zip, "test.txt").unwrap();
        assert_eq!(text, "café");
    }

    #[test]
    fn read_text_errors_on_missing_entry_and_names_it() {
        let mut zip = zip_from_files(&[("present.txt", b"hello")]);
        let err = read_text_from(&mut zip, "missing.txt").unwrap_err();
        assert!(
            err.contains("missing.txt"),
            "error message should name the missing entry; got: {err}"
        );
    }

    #[test]
    fn has_entry_distinguishes_present_from_absent() {
        let mut zip = zip_from_files(&[("present.json", b"{}")]);
        assert!(has_entry_from(&mut zip, "present.json"));
        assert!(!has_entry_from(&mut zip, "absent.json"));
    }
}
