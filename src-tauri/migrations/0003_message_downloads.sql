-- WS-C: video thumbnails + downloading posts/reels SHARED INTO a DM.
-- Applied only when user_version < 3 (see db::open).
--
-- saved_items.thumb_path: poster image RELATIVE to the downloads root, written by
--   yt-dlp `--write-thumbnail` alongside the video (<slug>/<id>.<thumbext>); NULL
--   when none was produced. Served via the dmedia:// scheme. CLI ignores it.
--
-- message_downloads: a SPARSE side table for posts/reels shared into a DM. Those
--   are a permalink in message.media.share.link (NOT extracted archive media), so
--   they download exactly like a saved post. Kept off the 24k-row messages table
--   (only attempted shares get a row). Keyed by messages.id with ON DELETE CASCADE,
--   so a re-ingest — which deletes+reinserts messages (via the threads cascade) —
--   would clear these; reset_archive (db.rs) salvages each outcome first (by share
--   link + timestamp + sender) and re-applies it to the new row, so a re-import
--   keeps downloaded DM shares — same carry-forward that covers saved_items' columns.
--   status: 'none' (default) | 'downloaded' | 'login_walled' | 'dead' | 'error'
ALTER TABLE saved_items ADD COLUMN thumb_path TEXT;

CREATE TABLE IF NOT EXISTS message_downloads (
  message_id  INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'none',
  local_path  TEXT,
  thumb_path  TEXT
);
