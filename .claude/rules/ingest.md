---
paths:
  - "src/ui/lib/ingest.ts"
  - "src/ui/lib/archive.ts"
---

# Archive ingest

### Bound concurrency on archive-entry reads — never unbounded `Promise.all`
- **Why:** importing the 7-part / 17 GB Facebook archive (~1700 threads) froze the WebView — an unbounded `Promise.all(tfs.map(readEntry))` fired thousands of concurrent `archive_read_text` IPC reads + `JSON.parse` in one burst (2026-05-26).
- **How:** route bulk entry reads through `mapWithConcurrency`/`loadThreads` (limit ~8) and throttle progress callbacks; applies to any new loop reading many entries.

### Ingest is still load-everything-then-one-`ingest_write` — watch memory at scale
- **Why:** the whole parsed archive is held in memory and sent as one IPC payload; big archives may still stall at the write step even with bounded reads (CLAUDE.md #8).
- **How:** if a large import stalls at "Saving to index…", escalate to chunked writes (append batches) or move ingest into Rust — don't just raise the concurrency limit.

### "Database disk image is malformed" is usually a corrupt WAL — move it aside, don't re-import blind
- **Why:** the one-shot `ingest_write` left a 175 MB un-checkpointed `index.sqlite-wal`; repeated hard-kills (Ctrl-C) of the app mid-write corrupted the WAL → malformed on every read/import, while the checkpointed main DB was intact (2026-05-26).
- **How:** with the app CLOSED, move `index.sqlite{,-wal,-shm}` to a backup dir, reopen and run `PRAGMA integrity_check` on the main file — if `ok`, the data survived (no re-import). Never hard-kill during/after a big import; fix the root cause via the chunked-write escalation above.
