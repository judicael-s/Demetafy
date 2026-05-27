-- User-requested: downloadable reposts. Applied only when user_version < 5
-- (see db::open). Mirrors the saved_items download columns (0002/0003): a repost's
-- source is a permalink (reposts.source_url), so it downloads exactly like a saved
-- post or a DM share. Phase 0's src/storage/db.ts does NOT track these — Phase
-- 1-only columns, ignored by the CLI.
--
--   download_status: 'none' (default) | 'downloaded' | 'login_walled' | 'dead' | 'error'
--   local_path:      video/image path RELATIVE to the downloads root (_reposts/<id>.<ext>)
--   thumb_path:      yt-dlp poster, likewise relative; NULL when none was written
-- All three survive a re-ingest: reset_archive (db.rs) salvages them keyed by
-- source_url before the delete and re-applies them to the freshly inserted row.
ALTER TABLE reposts ADD COLUMN download_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE reposts ADD COLUMN local_path TEXT;
ALTER TABLE reposts ADD COLUMN thumb_path TEXT;
