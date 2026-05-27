-- Step 13: per-saved-item download tracking. Applied only when user_version < 2
-- (see db::open). Phase 0's src/storage/db.ts does NOT track this — it's a
-- Phase 1-only column pair, harmless to the CLI (extra columns are ignored).
--
-- download_status: 'none' (default) | 'downloaded' | 'login_walled' | 'dead' | 'error'
-- local_path:      path RELATIVE to the downloads root (<collection-slug>/<id>.<ext>)
--                  when downloaded; NULL otherwise. Served via the dmedia:// scheme.
-- Both survive a re-ingest of the same archive: reset_archive (db.rs) salvages them
-- keyed by url before the delete and re-applies them to the freshly inserted row.
ALTER TABLE saved_items ADD COLUMN download_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE saved_items ADD COLUMN local_path TEXT;
