-- Step 16E: Facebook content. Applied only when user_version < 7.
--
-- `posts` is the user's own timeline posts — text + media refs + external links.
-- Distinct from `own_posts` (which is IG orphan media only, no metadata): FB
-- posts are rich, so they get a dedicated table. This matches the `posts` table
-- the high-level schema in .claude/plans/architecture.md always anticipated.
--
-- `albums` holds Facebook photo albums (+ a synthetic "Uncategorized" album for
-- the loose photos). Photos ride as a JSON array on the row, mirroring how
-- `messages.media` stores its media JSON — no separate album_photos table/join.
--
-- Both tag by archive_id; the IG/FB split is `archives.service`. Neither carries
-- download columns: FB post/album media lives in-zip and is served via vmedia,
-- not fetched by yt-dlp (unlike saved_items/reposts/message_downloads). Cleared
-- per-archive on re-ingest by reset_archive's explicit delete loop (the archives
-- row is updated, not deleted, so ON DELETE CASCADE doesn't fire).

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id  INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT 0,
  text        TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL DEFAULT '',
  media       TEXT NOT NULL DEFAULT '[]',
  links       TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_posts_archive ON posts(archive_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS albums (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id       INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  name             TEXT NOT NULL DEFAULT '',
  description      TEXT,
  cover_photo_uri  TEXT,
  last_modified    INTEGER NOT NULL DEFAULT 0,
  photo_count      INTEGER NOT NULL DEFAULT 0,
  photos           TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_albums_archive ON albums(archive_id);

-- Facebook-only profile facts with no Instagram equivalent. Nullable, so the
-- existing Instagram profile row simply leaves them NULL. ADD COLUMN is NOT
-- idempotent, hence the version<7 gate in db.rs::open.
ALTER TABLE profile ADD COLUMN current_city TEXT;
ALTER TABLE profile ADD COLUMN hometown TEXT;
ALTER TABLE profile ADD COLUMN relationship_status TEXT;
