-- Demetafy initial schema. Mirrors src/storage/db.ts exactly so Phase 0 CLI
-- (node:sqlite) and Phase 1 Tauri (tauri-plugin-sql + rusqlite) read/write
-- the same shape. PRAGMAs are set in the Rust setup, not here, because they
-- are session-level. Re-ingest cascade logic lives in application code.

CREATE TABLE IF NOT EXISTS archives (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path   TEXT NOT NULL UNIQUE,
  service       TEXT NOT NULL,
  ingested_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profile (
  archive_id              INTEGER PRIMARY KEY REFERENCES archives(id) ON DELETE CASCADE,
  username                TEXT NOT NULL,
  display_name            TEXT NOT NULL,
  email                   TEXT,
  phone                   TEXT,
  gender                  TEXT,
  date_of_birth           TEXT,
  is_private              INTEGER NOT NULL,
  country_code            TEXT,
  fbid                    TEXT,
  profile_photo_uri       TEXT,
  profile_photo_taken_at  INTEGER,
  first_story_at          INTEGER,
  last_story_at           INTEGER,
  last_login_at           INTEGER,
  last_logout_at          INTEGER,
  has_archived_reels      INTEGER
);

CREATE TABLE IF NOT EXISTS profile_changes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id      INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  field           TEXT NOT NULL,
  previous_value  TEXT,
  new_value       TEXT,
  changed_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id        INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  url               TEXT NOT NULL,
  caption           TEXT NOT NULL DEFAULT '',
  saved_at          INTEGER NOT NULL,
  collection_names  TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_saved_items_archive ON saved_items(archive_id);
CREATE INDEX IF NOT EXISTS idx_saved_items_saved_at ON saved_items(saved_at DESC);

CREATE TABLE IF NOT EXISTS saved_collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id  INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT,
  privacy     TEXT,
  created_at  INTEGER,
  updated_at  INTEGER,
  item_count  INTEGER NOT NULL DEFAULT 0,
  item_urls   TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_saved_collections_archive ON saved_collections(archive_id);

CREATE TABLE IF NOT EXISTS threads (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id              INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  thread_path             TEXT NOT NULL,
  source                  TEXT NOT NULL,
  slug                    TEXT NOT NULL,
  title                   TEXT NOT NULL DEFAULT '',
  participants            TEXT NOT NULL DEFAULT '[]',
  is_still_participant    INTEGER NOT NULL DEFAULT 1,
  message_count           INTEGER NOT NULL DEFAULT 0,
  first_message_at        INTEGER,
  last_message_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_threads_archive ON threads(archive_id);
CREATE INDEX IF NOT EXISTS idx_threads_last_message ON threads(last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id     INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender        TEXT NOT NULL,
  timestamp_ms  INTEGER NOT NULL,
  content       TEXT NOT NULL DEFAULT '',
  reactions     TEXT NOT NULL DEFAULT '[]',
  media         TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp_ms DESC);

CREATE TABLE IF NOT EXISTS stories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id  INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  uri         TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  source_app  TEXT,
  device_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_stories_archive ON stories(archive_id);

CREATE TABLE IF NOT EXISTS reposts (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id             INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  reposted_at            INTEGER NOT NULL,
  expires_at             INTEGER,
  user_text              TEXT NOT NULL DEFAULT '',
  source_url             TEXT NOT NULL,
  source_caption         TEXT NOT NULL DEFAULT '',
  source_title           TEXT NOT NULL DEFAULT '',
  source_owner_name      TEXT,
  source_owner_username  TEXT,
  fbid                   TEXT
);
CREATE INDEX IF NOT EXISTS idx_reposts_archive ON reposts(archive_id);

CREATE TABLE IF NOT EXISTS own_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id  INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  uri         TEXT NOT NULL,
  media_id    TEXT NOT NULL,
  ext         TEXT,
  size_bytes  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_own_posts_archive ON own_posts(archive_id);

-- FTS5: self-contained virtual tables. Phase 0 tried external-content
-- (content='source_table') first; it broke snippet() whenever FTS column
-- names diverged from source columns (e.g. reposts_fts.caption vs
-- reposts.source_caption). Self-contained is ~2x indexed-text storage but
-- simpler and rename-safe. Caller inserts with explicit rowid = source row id.
CREATE VIRTUAL TABLE IF NOT EXISTS saved_items_fts USING fts5(caption);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content);
CREATE VIRTUAL TABLE IF NOT EXISTS reposts_fts USING fts5(caption, user_text);
