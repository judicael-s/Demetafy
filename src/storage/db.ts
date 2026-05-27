import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { SavedItem, SavedCollection } from '../parsers/instagram/saved.js';
import type { Thread } from '../parsers/instagram/messages.js';
import type { Story } from '../parsers/instagram/stories.js';
import type { Repost } from '../parsers/instagram/reposts.js';
import type { OwnPost } from '../parsers/instagram/posts.js';
import type { Profile, ProfileChange } from '../parsers/instagram/profile.js';

/**
 * Open (or create) the Demetafy SQLite index at `dbPath`. Runs migrations on
 * first open via `IF NOT EXISTS`. Uses Node 24's built-in `node:sqlite`
 * (SQLite 3.51, FTS5) — no native module compilation needed.
 *
 * Caller is responsible for `db.close()` when done.
 */
export function openDb(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
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

    -- FTS5: self-contained virtual tables (no content='source_table'). We tried the
    -- external-content variant first; it breaks snippet() whenever the FTS column
    -- names don't match the source columns (e.g. reposts_fts.caption vs
    -- reposts.source_caption). Self-contained is ~2x the indexed-text storage
    -- but simpler to reason about and lets us rename source columns freely.
    -- Caller inserts with explicit rowid matching the source row's id so we can
    -- still join back. On re-ingest we DELETE FROM these tables (see resetArchive).
    CREATE VIRTUAL TABLE IF NOT EXISTS saved_items_fts USING fts5(caption);
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content);
    CREATE VIRTUAL TABLE IF NOT EXISTS reposts_fts USING fts5(caption, user_text);
  `);
}

/** Atomic transaction wrapper. Aborts the transaction on any thrown error. */
export function transactional<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Get-or-create the archive row keyed by source_path. On re-ingest, deletes
 * dependent rows (via ON DELETE CASCADE) and bumps `ingested_at`. Returns the
 * archive id either way.
 */
export function resetArchive(db: DatabaseSync, sourcePath: string, service: string): number {
  const existing = db
    .prepare('SELECT id FROM archives WHERE source_path = ?')
    .get(sourcePath) as { id: number } | undefined;
  if (existing) {
    // FTS5 external-content tables don't auto-cascade — clear them manually
    // before the source rows get deleted by the cascading FK.
    db.prepare(
      `DELETE FROM saved_items_fts WHERE rowid IN (SELECT id FROM saved_items WHERE archive_id = ?)`,
    ).run(existing.id);
    db.prepare(
      `DELETE FROM messages_fts WHERE rowid IN (
         SELECT m.id FROM messages m JOIN threads t ON m.thread_id = t.id WHERE t.archive_id = ?
       )`,
    ).run(existing.id);
    db.prepare(
      `DELETE FROM reposts_fts WHERE rowid IN (SELECT id FROM reposts WHERE archive_id = ?)`,
    ).run(existing.id);
    // Cascading FK deletes the source rows
    db.prepare(`DELETE FROM profile WHERE archive_id = ?`).run(existing.id);
    db.prepare(`DELETE FROM profile_changes WHERE archive_id = ?`).run(existing.id);
    db.prepare(`DELETE FROM saved_items WHERE archive_id = ?`).run(existing.id);
    db.prepare(`DELETE FROM saved_collections WHERE archive_id = ?`).run(existing.id);
    db.prepare(`DELETE FROM threads WHERE archive_id = ?`).run(existing.id);
    db.prepare(`DELETE FROM stories WHERE archive_id = ?`).run(existing.id);
    db.prepare(`DELETE FROM reposts WHERE archive_id = ?`).run(existing.id);
    db.prepare(`DELETE FROM own_posts WHERE archive_id = ?`).run(existing.id);
    db.prepare(`UPDATE archives SET ingested_at = ? WHERE id = ?`).run(Date.now(), existing.id);
    return existing.id;
  }
  const result = db
    .prepare('INSERT INTO archives (source_path, service, ingested_at) VALUES (?, ?, ?)')
    .run(sourcePath, service, Date.now());
  return Number(result.lastInsertRowid);
}

// ──────────────────────────────────────────────────────────────────────────
// Inserts (each per-content-type. Caller wraps the whole ingest in transactional.)
// ──────────────────────────────────────────────────────────────────────────

export function insertProfile(
  db: DatabaseSync,
  archiveId: number,
  profile: Profile,
  changes: ProfileChange[],
): void {
  db.prepare(
    `INSERT INTO profile (
       archive_id, username, display_name, email, phone, gender, date_of_birth,
       is_private, country_code, fbid, profile_photo_uri, profile_photo_taken_at,
       first_story_at, last_story_at, last_login_at, last_logout_at, has_archived_reels
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    archiveId,
    profile.username,
    profile.displayName,
    profile.email ?? null,
    profile.phone ?? null,
    profile.gender ?? null,
    profile.dateOfBirth ?? null,
    profile.isPrivateAccount ? 1 : 0,
    profile.countryCode ?? null,
    profile.fbid ?? null,
    profile.profilePhotoUri ?? null,
    profile.profilePhotoTakenAt ? profile.profilePhotoTakenAt.getTime() : null,
    profile.firstStoryAt ? profile.firstStoryAt.getTime() : null,
    profile.lastStoryAt ? profile.lastStoryAt.getTime() : null,
    profile.lastLoginAt ? profile.lastLoginAt.getTime() : null,
    profile.lastLogoutAt ? profile.lastLogoutAt.getTime() : null,
    profile.hasArchivedReels === undefined ? null : profile.hasArchivedReels ? 1 : 0,
  );

  const stmt = db.prepare(
    `INSERT INTO profile_changes (archive_id, field, previous_value, new_value, changed_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const c of changes) {
    stmt.run(archiveId, c.field, c.previousValue, c.newValue, c.changedAt.getTime());
  }
}

export function insertSaved(
  db: DatabaseSync,
  archiveId: number,
  items: SavedItem[],
  collections: SavedCollection[],
): void {
  const itemStmt = db.prepare(
    `INSERT INTO saved_items (archive_id, url, caption, saved_at, collection_names)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const ftsStmt = db.prepare(`INSERT INTO saved_items_fts (rowid, caption) VALUES (?, ?)`);
  for (const item of items) {
    const result = itemStmt.run(
      archiveId,
      item.url,
      item.caption,
      item.savedAt.getTime(),
      JSON.stringify(item.collections),
    );
    ftsStmt.run(Number(result.lastInsertRowid), item.caption);
  }
  const colStmt = db.prepare(
    `INSERT INTO saved_collections (archive_id, name, type, privacy, created_at, updated_at, item_count, item_urls)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of collections) {
    colStmt.run(
      archiveId,
      c.name,
      c.type,
      c.privacy,
      c.createdAt.getTime(),
      c.updatedAt.getTime(),
      c.itemUrls.length,
      JSON.stringify(c.itemUrls),
    );
  }
}

export interface ThreadIngestInput {
  source: string; // 'inbox' | 'message_requests' | 'broadcast'
  slug: string;
  thread: Thread;
}

export function insertThread(db: DatabaseSync, archiveId: number, input: ThreadIngestInput): void {
  const first = input.thread.messages[0];
  const last = input.thread.messages[input.thread.messages.length - 1];
  const result = db
    .prepare(
      `INSERT INTO threads (
         archive_id, thread_path, source, slug, title, participants,
         is_still_participant, message_count, first_message_at, last_message_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      archiveId,
      input.thread.threadPath,
      input.source,
      input.slug,
      input.thread.title,
      JSON.stringify(input.thread.participants),
      input.thread.isStillParticipant ? 1 : 0,
      input.thread.messages.length,
      first ? first.timestampMs : null,
      last ? last.timestampMs : null,
    );
  const threadId = Number(result.lastInsertRowid);

  const msgStmt = db.prepare(
    `INSERT INTO messages (thread_id, sender, timestamp_ms, content, reactions, media)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const ftsStmt = db.prepare(`INSERT INTO messages_fts (rowid, content) VALUES (?, ?)`);
  for (const m of input.thread.messages) {
    const mediaObj = {
      audio: m.audioFiles,
      photos: m.photos,
      videos: m.videos,
      gifs: m.gifs,
      share: m.share ?? null,
    };
    const res = msgStmt.run(
      threadId,
      m.sender,
      m.timestampMs,
      m.content ?? '',
      JSON.stringify(m.reactions),
      JSON.stringify(mediaObj),
    );
    ftsStmt.run(Number(res.lastInsertRowid), m.content ?? '');
  }
}

export function insertStories(db: DatabaseSync, archiveId: number, stories: Story[]): void {
  const stmt = db.prepare(
    `INSERT INTO stories (archive_id, uri, created_at, title, source_app, device_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const s of stories) {
    stmt.run(
      archiveId,
      s.uri,
      s.createdAt.getTime(),
      s.title,
      s.sourceApp ?? null,
      s.deviceId ?? null,
    );
  }
}

export function insertReposts(db: DatabaseSync, archiveId: number, reposts: Repost[]): void {
  const stmt = db.prepare(
    `INSERT INTO reposts (
       archive_id, reposted_at, expires_at, user_text,
       source_url, source_caption, source_title, source_owner_name, source_owner_username, fbid
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ftsStmt = db.prepare(
    `INSERT INTO reposts_fts (rowid, caption, user_text) VALUES (?, ?, ?)`,
  );
  for (const r of reposts) {
    const result = stmt.run(
      archiveId,
      r.repostedAt.getTime(),
      r.expiresAt.getTime(),
      r.userText,
      r.source.url,
      r.source.caption,
      r.source.title,
      r.source.ownerName,
      r.source.ownerUsername,
      r.fbid ?? null,
    );
    ftsStmt.run(Number(result.lastInsertRowid), r.source.caption, r.userText);
  }
}

export function insertOwnPosts(db: DatabaseSync, archiveId: number, posts: OwnPost[]): void {
  const stmt = db.prepare(
    `INSERT INTO own_posts (archive_id, uri, media_id, ext, size_bytes) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const p of posts) {
    stmt.run(archiveId, p.uri, p.mediaId, p.ext, p.sizeBytes);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────────────────────────

export interface Stats {
  archives: { id: number; sourcePath: string; service: string; ingestedAt: Date }[];
  counts: Record<string, number>;
}

export function getStats(db: DatabaseSync): Stats {
  const archives = (
    db
      .prepare('SELECT id, source_path, service, ingested_at FROM archives ORDER BY id')
      .all() as Array<{
      id: number;
      source_path: string;
      service: string;
      ingested_at: number;
    }>
  ).map((r) => ({
    id: r.id,
    sourcePath: r.source_path,
    service: r.service,
    ingestedAt: new Date(r.ingested_at),
  }));

  const tables = [
    'saved_items',
    'saved_collections',
    'threads',
    'messages',
    'stories',
    'reposts',
    'own_posts',
    'profile_changes',
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
    counts[t] = row.n;
  }
  return { archives, counts };
}

export interface SearchHit {
  table: 'saved_items' | 'messages' | 'reposts';
  rowid: number;
  /** Short label for the result: URL, sender + thread, owner. */
  label: string;
  /** Snippet of the matched text. */
  snippet: string;
  timestamp: number;
}

/**
 * FTS5 search across saved_items.caption, messages.content, reposts.caption + user_text.
 * Returns up to `limit` hits per table, ordered by FTS rank.
 *
 * Query is passed through to FTS5 as-is. Users can use FTS5 syntax (quoted
 * phrases, NEAR/, etc.); for plain words, just type the word.
 */
export function search(db: DatabaseSync, query: string, limit = 10): Record<string, SearchHit[]> {
  const saved = (
    db
      .prepare(
        `SELECT s.id, s.url, s.caption, s.saved_at,
                snippet(saved_items_fts, 0, '«', '»', '…', 16) AS snip
         FROM saved_items s
         JOIN saved_items_fts ON s.id = saved_items_fts.rowid
         WHERE saved_items_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as Array<{
      id: number;
      url: string;
      caption: string;
      saved_at: number;
      snip: string;
    }>
  ).map(
    (r): SearchHit => ({
      table: 'saved_items',
      rowid: r.id,
      label: r.url,
      snippet: r.snip,
      timestamp: r.saved_at,
    }),
  );

  const messages = (
    db
      .prepare(
        `SELECT m.id, m.sender, m.timestamp_ms, m.content,
                t.slug, t.source,
                snippet(messages_fts, 0, '«', '»', '…', 16) AS snip
         FROM messages m
         JOIN messages_fts ON m.id = messages_fts.rowid
         JOIN threads t ON m.thread_id = t.id
         WHERE messages_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as Array<{
      id: number;
      sender: string;
      timestamp_ms: number;
      content: string;
      slug: string;
      source: string;
      snip: string;
    }>
  ).map(
    (r): SearchHit => ({
      table: 'messages',
      rowid: r.id,
      label: `${r.sender} (${r.source}/${r.slug})`,
      snippet: r.snip,
      timestamp: r.timestamp_ms,
    }),
  );

  const reposts = (
    db
      .prepare(
        `SELECT r.id, r.source_url, r.source_owner_username, r.reposted_at,
                snippet(reposts_fts, 0, '«', '»', '…', 16) AS snip
         FROM reposts r
         JOIN reposts_fts ON r.id = reposts_fts.rowid
         WHERE reposts_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as Array<{
      id: number;
      source_url: string;
      source_owner_username: string;
      reposted_at: number;
      snip: string;
    }>
  ).map(
    (r): SearchHit => ({
      table: 'reposts',
      rowid: r.id,
      label: r.source_owner_username ? `@${r.source_owner_username}` : r.source_url,
      snippet: r.snip,
      timestamp: r.reposted_at,
    }),
  );

  return { saved_items: saved, messages, reposts };
}
