-- Feature E: followers / following / close-friends / blocked, parsed from
-- connections/followers_and_following/*.json. Applied only when user_version < 4.
--
-- The DYI archive stores these as username + profile URL + timestamp only (no
-- profile picture — that's the other person's content). `kind` buckets the list
-- the row came from; `href` is the normalised profile URL; `followed_at` is the
-- recorded timestamp in seconds (0 when absent). Cleared per-archive on re-ingest
-- via the archive_id FK (reset_archive deletes it explicitly).
CREATE TABLE IF NOT EXISTS connections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id  INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  username    TEXT NOT NULL,
  href        TEXT NOT NULL DEFAULT '',
  followed_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_connections_archive ON connections(archive_id);
CREATE INDEX IF NOT EXISTS idx_connections_kind ON connections(archive_id, kind);
