//! Zip archive bridge. The WebView's TypeScript parsers (reused from Phase 0)
//! consume archive entries through these commands instead of yauzl. Mirrors the
//! `ArchiveReader` surface: open → list/has/read → close. Handles are kept in a
//! Mutex-guarded map so the same archive can be read across many IPC calls
//! without re-parsing the central directory each time.

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
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

#[tauri::command]
pub fn archive_read_text(
    state: State<Archives>,
    handle: u32,
    name: String,
) -> Result<String, String> {
    let mut store = state.0.lock().map_err(|e| e.to_string())?;
    let zip = store.open.get_mut(&handle).ok_or_else(invalid_handle)?;
    let f = zip
        .by_name(&name)
        .map_err(|e| format!("entry {name}: {e}"))?;
    if f.size() > MAX_TEXT_ENTRY {
        return Err(format!("entry {name} too large ({} bytes)", f.size()));
    }
    let cap = f.size().min(MAX_TEXT_ENTRY) as usize;
    let mut buf = Vec::with_capacity(cap);
    // Bound the read too — a compression bomb can exceed its declared size.
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

#[tauri::command]
pub fn archive_has_entry(
    state: State<Archives>,
    handle: u32,
    name: String,
) -> Result<bool, String> {
    let mut store = state.0.lock().map_err(|e| e.to_string())?;
    let zip = store.open.get_mut(&handle).ok_or_else(invalid_handle)?;
    let exists = zip.by_name(&name).is_ok();
    Ok(exists)
}

#[tauri::command]
pub fn archive_close(state: State<Archives>, handle: u32) -> Result<(), String> {
    let mut store = state.0.lock().map_err(|e| e.to_string())?;
    store.open.remove(&handle);
    Ok(())
}
