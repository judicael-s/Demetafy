---
paths:
  - "src/**/*.test.ts"
  - "src-tauri/src/*.rs"
---

# Testing

### Use `mojibake(clean)` helper for fixture text — never hand-type the Latin-1 escape sequences
- **Why:** `fixMojibake` bails (returns unchanged) on invalid UTF-8. `"pensÃ©e"` hand-typed as literals has a regular space (0x20) where `à` needs 0xA0 — `0xC3 0x20` is invalid UTF-8, so the whole string passes through unfixed and the assertion fails unexpectedly (2026-05-29).
- **How:** add `const mojibake = (clean: string): string => String.fromCharCode(...new TextEncoder().encode(clean));` to the test file; pass the clean string (`mojibake("une pensée")`) rather than the mojibaked version. The helper is the inverse of `fixMojibake` and always produces valid-UTF-8-encoded Latin-1.

### Tauri IPC tests: one mocked `invoke` serves both MergedArchiveReader and `ingest_write`
- **Why:** mocking only `ingest_write` (db.js) forces the reader to be mocked too; mocking the single Tauri `invoke` boundary lets the real reader, real `detectArchiveType`, and real parsers run end-to-end (more realistic, required for cross-part stitch tests).
- **How:** `vi.mock("@tauri-apps/api/core", () => ({ invoke: ... }))` with a `mock`-prefixed mutable holder; see `src/ui/lib/ingest.test.ts` for the `backArchives()` pattern.

### archive.rs helpers are generic over `R: Read + Seek` — tests use `Cursor<Vec<u8>>`
- **Why:** `State<Archives>` wraps a `Mutex<HashMap<u32, ZipArchive<File>>>` which can't be constructed in unit tests; extracting `list_entries_from`, `read_text_from`, `has_entry_from` as generics makes the zip-crate wrapper testable.
- **How:** build in-memory zips with `ZipWriter::new(Cursor::new(Vec::new()))` + `CompressionMethod::Stored`, then wrap with `ZipArchive::new(writer.finish().unwrap())`; see `archive::tests` in `src-tauri/src/archive.rs`.
