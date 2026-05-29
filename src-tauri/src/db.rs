//! SQLite data layer (rusqlite, bundled — FTS5 compiled in by default).
//!
//! Why rusqlite instead of tauri-plugin-sql: the plugin is sqlx-backed with a
//! connection pool, which (a) makes BEGIN/COMMIT unreliable across statements
//! and (b) doesn't guarantee FTS5. A single Mutex<Connection> gives us real
//! transactions and a fast atomic ingest, matching the Phase 0 CLI. Reads go
//! through a fixed set of typed `query_*` commands (no arbitrary WebView SQL —
//! security finding C3); the one heavy write goes through the typed `ingest_write`
//! (native last_insert_rowid, mirroring src/storage/db.ts exactly).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use tauri::State;

pub struct Db(pub Mutex<Connection>);

const MIGRATION_0001: &str = include_str!("../migrations/0001_initial.sql");
const MIGRATION_0002: &str = include_str!("../migrations/0002_downloads.sql");
const MIGRATION_0003: &str = include_str!("../migrations/0003_message_downloads.sql");
const MIGRATION_0004: &str = include_str!("../migrations/0004_connections.sql");
const MIGRATION_0005: &str = include_str!("../migrations/0005_repost_downloads.sql");
const MIGRATION_0006: &str = include_str!("../migrations/0006_archive_parts.sql");
const MIGRATION_0007: &str = include_str!("../migrations/0007_facebook_content.sql");
const MIGRATION_0008: &str = include_str!("../migrations/0008_avatars.sql");
const SCHEMA_VERSION: i64 = 8;

/// Open (or create) the index at `path` and apply migrations. `:memory:` is
/// supported for tests. Mirrors openDb() in src/storage/db.ts.
///
/// Migrations are gated on `PRAGMA user_version` so each runs at most once.
/// 0001 uses `CREATE TABLE IF NOT EXISTS`, so DBs created before versioning
/// existed (user_version 0, tables already present) re-run it harmlessly, then
/// pick up the later `ALTER TABLE ADD COLUMN`s (0002, 0003, 0007). `ADD COLUMN`
/// is NOT idempotent, so each must stay behind the version gate.
pub fn open(path: &str) -> rusqlite::Result<Connection> {
    let conn = if path == ":memory:" {
        Connection::open_in_memory()?
    } else {
        Connection::open(path)?
    };
    if path != ":memory:" {
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    }
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        conn.execute_batch(MIGRATION_0001)?;
    }
    if version < 2 {
        conn.execute_batch(MIGRATION_0002)?;
    }
    if version < 3 {
        conn.execute_batch(MIGRATION_0003)?;
    }
    if version < 4 {
        conn.execute_batch(MIGRATION_0004)?;
    }
    if version < 5 {
        conn.execute_batch(MIGRATION_0005)?;
    }
    if version < 6 {
        conn.execute_batch(MIGRATION_0006)?;
    }
    if version < 7 {
        conn.execute_batch(MIGRATION_0007)?;
    }
    if version < 8 {
        conn.execute_batch(MIGRATION_0008)?;
    }
    if version < SCHEMA_VERSION {
        // PRAGMA can't take a bound param; SCHEMA_VERSION is a trusted constant.
        conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
    }
    Ok(conn)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ── ingest payload (camelCase from the TS side; maps 1:1 to columns) ──────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestPayload {
    source_path: String,
    service: String,
    /// Every zip part of this logical archive (Instagram = 1; Facebook = many).
    /// Persisted to `archive_parts` so the media handler can resolve an entry
    /// across parts at browse time. `default` keeps older payloads deserializable.
    #[serde(default)]
    part_paths: Vec<String>,
    profile: Option<ProfileRow>,
    profile_changes: Vec<ProfileChangeRow>,
    saved_items: Vec<SavedItemRow>,
    saved_collections: Vec<SavedCollectionRow>,
    threads: Vec<ThreadRow>,
    stories: Vec<StoryRow>,
    reposts: Vec<RepostRow>,
    own_posts: Vec<OwnPostRow>,
    connections: Vec<ConnectionRow>,
    /// Facebook timeline posts + photo albums (16E). Empty for Instagram.
    posts: Vec<PostRow>,
    albums: Vec<AlbumRow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileRow {
    username: String,
    display_name: String,
    email: Option<String>,
    phone: Option<String>,
    gender: Option<String>,
    date_of_birth: Option<String>,
    is_private: bool,
    country_code: Option<String>,
    fbid: Option<String>,
    profile_photo_uri: Option<String>,
    profile_photo_taken_at: Option<i64>,
    first_story_at: Option<i64>,
    last_story_at: Option<i64>,
    last_login_at: Option<i64>,
    last_logout_at: Option<i64>,
    has_archived_reels: Option<bool>,
    // Facebook-only (migration 0007); NULL for Instagram profiles.
    current_city: Option<String>,
    hometown: Option<String>,
    relationship_status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileChangeRow {
    field: String,
    previous_value: Option<String>,
    new_value: Option<String>,
    changed_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedItemRow {
    url: String,
    caption: String,
    saved_at: i64,
    collection_names: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedCollectionRow {
    name: String,
    #[serde(rename = "type")]
    kind: Option<String>,
    privacy: Option<String>,
    created_at: Option<i64>,
    updated_at: Option<i64>,
    item_count: i64,
    item_urls: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadRow {
    thread_path: String,
    source: String,
    slug: String,
    title: String,
    participants: String,
    is_still_participant: bool,
    messages: Vec<MessageRow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessageRow {
    sender: String,
    timestamp_ms: i64,
    content: String,
    reactions: String,
    media: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoryRow {
    uri: String,
    created_at: i64,
    title: String,
    source_app: Option<String>,
    device_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepostRow {
    reposted_at: i64,
    expires_at: Option<i64>,
    user_text: String,
    source_url: String,
    source_caption: String,
    source_title: String,
    source_owner_name: Option<String>,
    source_owner_username: Option<String>,
    fbid: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnPostRow {
    uri: String,
    media_id: String,
    ext: Option<String>,
    size_bytes: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionRow {
    kind: String,
    username: String,
    href: String,
    followed_at: i64,
}

/// One Facebook timeline post (16E). `media`/`links` are opaque JSON the UI
/// parses (`[{uri, createdAt}]` / `[string]`); Rust just stores the text.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PostRow {
    created_at: i64,
    text: String,
    title: String,
    media: String,
    links: String,
}

/// One Facebook photo album (16E). `photos` is opaque JSON the UI parses
/// (`[{uri, createdAt, title, description}]`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlbumRow {
    name: String,
    description: Option<String>,
    cover_photo_uri: Option<String>,
    last_modified: i64,
    photo_count: i64,
    photos: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    saved_items: i64,
    saved_collections: i64,
    threads: i64,
    messages: i64,
    stories: i64,
    reposts: i64,
    own_posts: i64,
    profile_changes: i64,
    connections: i64,
    posts: i64,
    albums: i64,
}

// ── ingest core (testable; the command shell just locks + logs) ───────────────

/// Download outcomes salvaged from an archive's prior rows immediately before a
/// re-ingest deletes them, so they can be re-applied to the freshly inserted rows.
///
/// Why this exists: re-ingest of the same `source_path` deletes+reinserts every
/// row, handing each a new AUTOINCREMENT id. Without salvaging, `download_status`
/// and `local_path` reset to their column defaults, orphaning the already-fetched
/// videos on disk and making "Download all" re-pull everything from live Instagram
/// (HTTP 429 risk — see CLAUDE.md gotchas #3/#5). Keyed by stable natural keys
/// (saved: url; DM share: link + timestamp + sender) precisely because the row id
/// is what churns.
#[derive(Default)]
struct DownloadCarry {
    /// saved_items.url → (download_status, local_path, thumb_path)
    saved: HashMap<String, (String, Option<String>, Option<String>)>,
    /// reposts.source_url → (download_status, local_path, thumb_path)
    reposts: HashMap<String, (String, Option<String>, Option<String>)>,
    /// One per previously-downloaded DM share, re-matched by (link, ts, sender).
    messages: Vec<MessageCarry>,
}

struct MessageCarry {
    link: String,
    timestamp_ms: i64,
    sender: String,
    status: String,
    local_path: Option<String>,
    thumb_path: Option<String>,
}

fn reset_archive(
    tx: &Transaction,
    source_path: &str,
    service: &str,
) -> rusqlite::Result<(i64, DownloadCarry)> {
    let existing: Option<i64> = tx
        .query_row(
            "SELECT id FROM archives WHERE source_path = ?1",
            params![source_path],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = existing {
        // Salvage download outcomes BEFORE the deletes below wipe them; ingest_into
        // re-applies them to the new rows keyed by url / (link, ts, sender).
        let mut carry = DownloadCarry::default();
        {
            let mut stmt = tx.prepare(
                "SELECT url, download_status, local_path, thumb_path FROM saved_items
                 WHERE archive_id = ?1 AND download_status != 'none'
                 ORDER BY (download_status = 'downloaded') DESC",
            )?;
            let rows = stmt.query_map(params![id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })?;
            // First row per url wins; the ORDER BY floats 'downloaded' to the top so
            // a duplicate-url archive keeps the recoverable outcome.
            for row in rows {
                let (url, status, lp, tp) = row?;
                carry.saved.entry(url).or_insert((status, lp, tp));
            }
        }
        {
            let mut stmt = tx.prepare(
                "SELECT json_extract(m.media, '$.share.link'), m.timestamp_ms, m.sender,
                        d.status, d.local_path, d.thumb_path
                 FROM message_downloads d
                 JOIN messages m ON m.id = d.message_id
                 JOIN threads t ON t.id = m.thread_id
                 WHERE t.archive_id = ?1 AND json_extract(m.media, '$.share.link') IS NOT NULL",
            )?;
            let rows = stmt.query_map(params![id], |r| {
                Ok(MessageCarry {
                    link: r.get(0)?,
                    timestamp_ms: r.get(1)?,
                    sender: r.get(2)?,
                    status: r.get(3)?,
                    local_path: r.get(4)?,
                    thumb_path: r.get(5)?,
                })
            })?;
            for row in rows {
                carry.messages.push(row?);
            }
        }
        {
            let mut stmt = tx.prepare(
                "SELECT source_url, download_status, local_path, thumb_path FROM reposts
                 WHERE archive_id = ?1 AND download_status != 'none'
                 ORDER BY (download_status = 'downloaded') DESC",
            )?;
            let rows = stmt.query_map(params![id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })?;
            for row in rows {
                let (url, status, lp, tp) = row?;
                carry.reposts.entry(url).or_insert((status, lp, tp));
            }
        }

        // FTS tables aren't covered by ON DELETE CASCADE — clear them first.
        tx.execute(
            "DELETE FROM saved_items_fts WHERE rowid IN (SELECT id FROM saved_items WHERE archive_id = ?1)",
            params![id],
        )?;
        tx.execute(
            "DELETE FROM messages_fts WHERE rowid IN (SELECT m.id FROM messages m JOIN threads t ON m.thread_id = t.id WHERE t.archive_id = ?1)",
            params![id],
        )?;
        tx.execute(
            "DELETE FROM reposts_fts WHERE rowid IN (SELECT id FROM reposts WHERE archive_id = ?1)",
            params![id],
        )?;
        for tbl in [
            "profile",
            "profile_changes",
            "saved_items",
            "saved_collections",
            "threads", // cascades to messages via FK
            "stories",
            "reposts",
            "own_posts",
            "connections",
            "posts",
            "albums",
        ] {
            tx.execute(
                &format!("DELETE FROM {tbl} WHERE archive_id = ?1"),
                params![id],
            )?;
        }
        tx.execute(
            "UPDATE archives SET ingested_at = ?1 WHERE id = ?2",
            params![now_ms(), id],
        )?;
        Ok((id, carry))
    } else {
        tx.execute(
            "INSERT INTO archives (source_path, service, ingested_at) VALUES (?1, ?2, ?3)",
            params![source_path, service, now_ms()],
        )?;
        Ok((tx.last_insert_rowid(), DownloadCarry::default()))
    }
}

fn read_counts(tx: &Transaction) -> rusqlite::Result<Counts> {
    let count = |t: &str| -> rusqlite::Result<i64> {
        tx.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0))
    };
    Ok(Counts {
        saved_items: count("saved_items")?,
        saved_collections: count("saved_collections")?,
        threads: count("threads")?,
        messages: count("messages")?,
        stories: count("stories")?,
        reposts: count("reposts")?,
        own_posts: count("own_posts")?,
        profile_changes: count("profile_changes")?,
        connections: count("connections")?,
        posts: count("posts")?,
        albums: count("albums")?,
    })
}

/// Transactional ingest. Mirrors the insert helpers in src/storage/db.ts,
/// using native last_insert_rowid to keep FTS rowids aligned with source ids.
fn ingest_into(conn: &mut Connection, p: &IngestPayload) -> rusqlite::Result<Counts> {
    let tx = conn.transaction()?;
    let (archive_id, carry) = reset_archive(&tx, &p.source_path, &p.service)?;

    // Record every zip part of this archive, replacing any prior set on re-ingest.
    // The browse-time media handler resolves an entry across these parts.
    tx.execute(
        "DELETE FROM archive_parts WHERE archive_id = ?1",
        params![archive_id],
    )?;
    for (idx, path) in p.part_paths.iter().enumerate() {
        tx.execute(
            "INSERT INTO archive_parts (archive_id, idx, path) VALUES (?1, ?2, ?3)",
            params![archive_id, idx as i64, path],
        )?;
    }

    if let Some(pr) = &p.profile {
        tx.execute(
            "INSERT INTO profile (
                archive_id, username, display_name, email, phone, gender, date_of_birth,
                is_private, country_code, fbid, profile_photo_uri, profile_photo_taken_at,
                first_story_at, last_story_at, last_login_at, last_logout_at, has_archived_reels,
                current_city, hometown, relationship_status
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)",
            params![
                archive_id,
                pr.username,
                pr.display_name,
                pr.email,
                pr.phone,
                pr.gender,
                pr.date_of_birth,
                pr.is_private,
                pr.country_code,
                pr.fbid,
                pr.profile_photo_uri,
                pr.profile_photo_taken_at,
                pr.first_story_at,
                pr.last_story_at,
                pr.last_login_at,
                pr.last_logout_at,
                pr.has_archived_reels,
                pr.current_city,
                pr.hometown,
                pr.relationship_status,
            ],
        )?;
    }

    {
        let mut stmt = tx.prepare(
            "INSERT INTO profile_changes (archive_id, field, previous_value, new_value, changed_at)
             VALUES (?1,?2,?3,?4,?5)",
        )?;
        for c in &p.profile_changes {
            stmt.execute(params![
                archive_id,
                c.field,
                c.previous_value,
                c.new_value,
                c.changed_at
            ])?;
        }
    }

    {
        let mut item = tx.prepare(
            "INSERT INTO saved_items (archive_id, url, caption, saved_at, collection_names)
             VALUES (?1,?2,?3,?4,?5)",
        )?;
        let mut fts = tx.prepare("INSERT INTO saved_items_fts (rowid, caption) VALUES (?1,?2)")?;
        for s in &p.saved_items {
            item.execute(params![
                archive_id,
                s.url,
                s.caption,
                s.saved_at,
                s.collection_names
            ])?;
            let id = tx.last_insert_rowid();
            fts.execute(params![id, s.caption])?;
        }
    }

    // Restore salvaged saved-post download outcomes onto the new rows (same url).
    {
        let mut upd = tx.prepare(
            "UPDATE saved_items SET download_status = ?2, local_path = ?3, thumb_path = ?4
             WHERE archive_id = ?1 AND url = ?5",
        )?;
        for (url, (status, local_path, thumb_path)) in &carry.saved {
            upd.execute(params![archive_id, status, local_path, thumb_path, url])?;
        }
    }

    {
        let mut col = tx.prepare(
            "INSERT INTO saved_collections (archive_id, name, type, privacy, created_at, updated_at, item_count, item_urls)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        )?;
        for c in &p.saved_collections {
            col.execute(params![
                archive_id,
                c.name,
                c.kind,
                c.privacy,
                c.created_at,
                c.updated_at,
                c.item_count,
                c.item_urls
            ])?;
        }
    }

    {
        let mut thread = tx.prepare(
            "INSERT INTO threads (
                archive_id, thread_path, source, slug, title, participants,
                is_still_participant, message_count, first_message_at, last_message_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        )?;
        let mut msg = tx.prepare(
            "INSERT INTO messages (thread_id, sender, timestamp_ms, content, reactions, media)
             VALUES (?1,?2,?3,?4,?5,?6)",
        )?;
        let mut msg_fts = tx.prepare("INSERT INTO messages_fts (rowid, content) VALUES (?1,?2)")?;
        for t in &p.threads {
            let first = t.messages.first().map(|m| m.timestamp_ms);
            let last = t.messages.last().map(|m| m.timestamp_ms);
            thread.execute(params![
                archive_id,
                t.thread_path,
                t.source,
                t.slug,
                t.title,
                t.participants,
                t.is_still_participant,
                t.messages.len() as i64,
                first,
                last,
            ])?;
            let thread_id = tx.last_insert_rowid();
            for m in &t.messages {
                msg.execute(params![
                    thread_id,
                    m.sender,
                    m.timestamp_ms,
                    m.content,
                    m.reactions,
                    m.media
                ])?;
                let mid = tx.last_insert_rowid();
                msg_fts.execute(params![mid, m.content])?;
            }
        }
    }

    // Restore salvaged DM-share download outcomes. The message id churned, so re-match
    // the new row by its stable identity (archive + timestamp + sender + share link).
    // OR REPLACE guards the rare case of two identical share messages collapsing to one.
    {
        let mut ins = tx.prepare(
            "INSERT OR REPLACE INTO message_downloads (message_id, status, local_path, thumb_path)
             SELECT m.id, ?2, ?3, ?4
             FROM messages m JOIN threads t ON t.id = m.thread_id
             WHERE t.archive_id = ?1
               AND m.timestamp_ms = ?5
               AND m.sender = ?6
               AND json_extract(m.media, '$.share.link') = ?7",
        )?;
        for mc in &carry.messages {
            ins.execute(params![
                archive_id,
                mc.status,
                mc.local_path,
                mc.thumb_path,
                mc.timestamp_ms,
                mc.sender,
                mc.link
            ])?;
        }
    }

    {
        let mut stmt = tx.prepare(
            "INSERT INTO stories (archive_id, uri, created_at, title, source_app, device_id)
             VALUES (?1,?2,?3,?4,?5,?6)",
        )?;
        for s in &p.stories {
            stmt.execute(params![
                archive_id,
                s.uri,
                s.created_at,
                s.title,
                s.source_app,
                s.device_id
            ])?;
        }
    }

    {
        let mut stmt = tx.prepare(
            "INSERT INTO reposts (
                archive_id, reposted_at, expires_at, user_text,
                source_url, source_caption, source_title, source_owner_name, source_owner_username, fbid
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        )?;
        let mut fts =
            tx.prepare("INSERT INTO reposts_fts (rowid, caption, user_text) VALUES (?1,?2,?3)")?;
        for r in &p.reposts {
            stmt.execute(params![
                archive_id,
                r.reposted_at,
                r.expires_at,
                r.user_text,
                r.source_url,
                r.source_caption,
                r.source_title,
                r.source_owner_name,
                r.source_owner_username,
                r.fbid
            ])?;
            let id = tx.last_insert_rowid();
            fts.execute(params![id, r.source_caption, r.user_text])?;
        }
    }

    // Restore salvaged repost download outcomes onto the new rows (same source_url).
    {
        let mut upd = tx.prepare(
            "UPDATE reposts SET download_status = ?2, local_path = ?3, thumb_path = ?4
             WHERE archive_id = ?1 AND source_url = ?5",
        )?;
        for (url, (status, local_path, thumb_path)) in &carry.reposts {
            upd.execute(params![archive_id, status, local_path, thumb_path, url])?;
        }
    }

    {
        let mut stmt = tx.prepare(
            "INSERT INTO own_posts (archive_id, uri, media_id, ext, size_bytes) VALUES (?1,?2,?3,?4,?5)",
        )?;
        for o in &p.own_posts {
            stmt.execute(params![archive_id, o.uri, o.media_id, o.ext, o.size_bytes])?;
        }
    }

    {
        let mut stmt = tx.prepare(
            "INSERT INTO connections (archive_id, kind, username, href, followed_at) VALUES (?1,?2,?3,?4,?5)",
        )?;
        for c in &p.connections {
            stmt.execute(params![archive_id, c.kind, c.username, c.href, c.followed_at])?;
        }
    }

    {
        let mut stmt = tx.prepare(
            "INSERT INTO posts (archive_id, created_at, text, title, media, links)
             VALUES (?1,?2,?3,?4,?5,?6)",
        )?;
        for po in &p.posts {
            stmt.execute(params![
                archive_id,
                po.created_at,
                po.text,
                po.title,
                po.media,
                po.links
            ])?;
        }
    }

    {
        let mut stmt = tx.prepare(
            "INSERT INTO albums (archive_id, name, description, cover_photo_uri, last_modified, photo_count, photos)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
        )?;
        for a in &p.albums {
            stmt.execute(params![
                archive_id,
                a.name,
                a.description,
                a.cover_photo_uri,
                a.last_modified,
                a.photo_count,
                a.photos
            ])?;
        }
    }

    let counts = read_counts(&tx)?;
    tx.commit()?;
    Ok(counts)
}

#[tauri::command]
pub fn ingest_write(state: State<Db>, payload: IngestPayload) -> Result<Counts, String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let counts = ingest_into(&mut conn, &payload).map_err(|e| e.to_string())?;
    log::info!(
        "demetafy ingest counts: saved_items={} saved_collections={} threads={} messages={} stories={} reposts={} own_posts={} profile_changes={} connections={} posts={} albums={}",
        counts.saved_items,
        counts.saved_collections,
        counts.threads,
        counts.messages,
        counts.stories,
        counts.reposts,
        counts.own_posts,
        counts.profile_changes,
        counts.connections,
        counts.posts,
        counts.albums,
    );
    Ok(counts)
}

/// Single source of truth for persisting a download outcome, dispatched by
/// `source` to the right table. The download engine's worker
/// (`downloader::finish_item`) calls this on each item's terminal state, so the
/// persistence SQL lives in exactly one place. `local_path`/`thumb_path` are
/// relative to the downloads root, set only on success; NULL clears any prior value.
///
/// `source`: "message" → upsert the sparse `message_downloads` row (keyed by
/// message id); "repost" → UPDATE `reposts`' inline columns; anything else
/// ("saved") → UPDATE `saved_items`' inline columns.
pub(crate) fn write_download_status(
    conn: &rusqlite::Connection,
    source: &str,
    ref_id: i64,
    status: &str,
    local_path: Option<&str>,
    thumb_path: Option<&str>,
) -> rusqlite::Result<()> {
    match source {
        "message" => {
            conn.execute(
                "INSERT INTO message_downloads (message_id, status, local_path, thumb_path)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(message_id) DO UPDATE SET
                   status = excluded.status,
                   local_path = excluded.local_path,
                   thumb_path = excluded.thumb_path",
                params![ref_id, status, local_path, thumb_path],
            )?;
        }
        "repost" => {
            conn.execute(
                "UPDATE reposts SET download_status = ?1, local_path = ?2, thumb_path = ?3 WHERE id = ?4",
                params![status, local_path, thumb_path, ref_id],
            )?;
        }
        _ => {
            conn.execute(
                "UPDATE saved_items SET download_status = ?1, local_path = ?2, thumb_path = ?3 WHERE id = ?4",
                params![status, local_path, thumb_path, ref_id],
            )?;
        }
    }
    Ok(())
}

// ── typed read path (replaces the generic db_select; closes security C3) ──────
//
// Each UI query is a fixed, parameterized command instead of arbitrary
// WebView-supplied SQL. Row structs serialize with their snake_case field
// names so the TS mapping code (parseSavedRow / toThreadSummary / parseMedia …)
// reads the same shape it did from db_select — no consumer changes. The SQL is
// the verbatim, proven SQL that previously lived in src/ui/lib/queries.ts.
//
// Logic lives in free fns (testable with a borrowed &Connection); the #[command]
// shells just lock the Mutex and stringify errors — mirroring ingest_into/ingest_write.

#[derive(Serialize, Debug)]
pub struct Overview {
    archives: i64,
    saved_items: i64,
    collections: i64,
    threads: i64,
    messages: i64,
    stories: i64,
    reposts: i64,
    own_posts: i64,
    posts: i64,
    albums: i64,
}

#[derive(Serialize, Debug)]
pub struct ProfileOut {
    username: String,
    display_name: String,
    profile_photo_uri: Option<String>,
    is_private: i64,
    country_code: Option<String>,
    fbid: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    gender: Option<String>,
    date_of_birth: Option<String>,
    last_login_at: Option<i64>,
}

/// One imported archive as a selectable account. `username`/`display_name` come
/// from the joined profile row (NULL when an archive has no profile). The active
/// item's `id` is the scope passed to every content query.
#[derive(Serialize, Debug)]
pub struct ArchiveListItem {
    id: i64,
    service: String,
    source_path: String,
    ingested_at: i64,
    username: Option<String>,
    display_name: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct SavedItemOut {
    id: i64,
    url: String,
    caption: String,
    saved_at: i64,
    collection_names: String,
    download_status: String,
    local_path: Option<String>,
    thumb_path: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct CollectionCountOut {
    name: String,
    item_count: i64,
}

#[derive(Serialize, Debug)]
pub struct ThreadSummaryOut {
    id: i64,
    slug: String,
    source: String,
    title: String,
    participants: String,
    message_count: i64,
    last_message_at: Option<i64>,
    last_preview: Option<String>,
    last_sender: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct MessageOut {
    id: i64,
    sender: String,
    timestamp_ms: i64,
    content: String,
    reactions: String,
    media: String,
    download_status: String,
    local_path: Option<String>,
    thumb_path: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct ThreadDetailOut {
    thread: Option<ThreadSummaryOut>,
    messages: Vec<MessageOut>,
}

#[derive(Serialize, Debug)]
pub struct ProfileChangeOut {
    field: String,
    previous_value: Option<String>,
    new_value: Option<String>,
    changed_at: i64,
}

#[derive(Serialize, Debug)]
pub struct StoryOut {
    uri: String,
    created_at: i64,
    title: String,
    source_app: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct RepostOut {
    id: i64,
    reposted_at: i64,
    user_text: String,
    source_url: String,
    source_caption: String,
    source_owner_name: Option<String>,
    source_owner_username: Option<String>,
    download_status: String,
    local_path: Option<String>,
    thumb_path: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct OwnPostOut {
    uri: String,
    media_id: String,
    ext: Option<String>,
    size_bytes: Option<i64>,
}

#[derive(Serialize, Debug)]
pub struct PostOut {
    id: i64,
    created_at: i64,
    text: String,
    title: String,
    media: String,
    links: String,
}

#[derive(Serialize, Debug)]
pub struct AlbumOut {
    id: i64,
    name: String,
    description: Option<String>,
    cover_photo_uri: Option<String>,
    last_modified: i64,
    photo_count: i64,
    photos: String,
}

#[derive(Serialize, Debug)]
pub struct ConnectionOut {
    kind: String,
    username: String,
    href: String,
    followed_at: i64,
}

#[derive(Serialize, Debug)]
pub struct ShareRowOut {
    id: i64,
    link: Option<String>,
    status: String,
}

#[derive(Serialize, Debug)]
pub struct SavedDownloadStatsOut {
    total: i64,
    downloaded: i64,
    unavailable: i64,
}

/// One playable media item for the mixed feed. Either `uri` (an in-zip entry,
/// served via vmedia) or `local_path` (a downloaded file, served via dmedia) is
/// set; the frontend builds the actual URL. `source` is a short provenance label.
#[derive(Serialize, Debug)]
pub struct FeedItemOut {
    source: String,
    kind: String, // "image" | "video"
    uri: Option<String>,
    local_path: Option<String>,
    poster_path: Option<String>,
    caption: Option<String>,
    timestamp_ms: Option<i64>,
}

#[derive(Serialize, Debug)]
pub struct SearchResultOut {
    /// "saved" | "message" | "repost" — the UI groups + labels + routes on this.
    kind: String,
    /// Thread title for messages (may be ""); empty for saved/repost.
    title: String,
    /// Thread participants JSON for messages (so the UI can derive a name when the
    /// title is empty); empty for saved/repost.
    participants: String,
    /// The matched caption / message body.
    snippet: String,
    /// Thread slug for messages → `/dms/<slug>`; None for saved/repost.
    slug: Option<String>,
    timestamp: Option<i64>,
}

#[derive(Serialize, Debug)]
pub struct AvatarOut {
    handle: String,
    /// Relative path under the downloads root (served via dmedia://).
    local_path: String,
}

// Content counts are scoped to one service when `service` is Some (the
// `?1 IS NULL OR …` guard makes None mean "all", preserving the unscoped call).
// `archives` stays a global count — it gates "has anything been imported".
fn overview(conn: &Connection, archive_id: Option<i64>) -> rusqlite::Result<Overview> {
    const F: &str = "(?1 IS NULL OR archive_id = ?1)";
    let sql = format!(
        "SELECT
           (SELECT COUNT(*) FROM archives),
           (SELECT COUNT(*) FROM saved_items WHERE {F}),
           (SELECT COUNT(*) FROM saved_collections WHERE {F}),
           (SELECT COUNT(*) FROM threads WHERE {F}),
           (SELECT COUNT(*) FROM messages m JOIN threads t ON t.id = m.thread_id
              WHERE (?1 IS NULL OR t.archive_id = ?1)),
           (SELECT COUNT(*) FROM stories WHERE {F}),
           (SELECT COUNT(*) FROM reposts WHERE {F}),
           (SELECT COUNT(*) FROM own_posts WHERE {F}),
           (SELECT COUNT(*) FROM posts WHERE {F}),
           (SELECT COUNT(*) FROM albums WHERE {F})"
    );
    conn.query_row(&sql, params![archive_id], |r| {
        Ok(Overview {
            archives: r.get(0)?,
            saved_items: r.get(1)?,
            collections: r.get(2)?,
            threads: r.get(3)?,
            messages: r.get(4)?,
            stories: r.get(5)?,
            reposts: r.get(6)?,
            own_posts: r.get(7)?,
            posts: r.get(8)?,
            albums: r.get(9)?,
        })
    })
}

fn profile(conn: &Connection, archive_id: Option<i64>) -> rusqlite::Result<Option<ProfileOut>> {
    conn.query_row(
        "SELECT username, display_name, profile_photo_uri, is_private, country_code, fbid,
                email, phone, gender, date_of_birth, last_login_at
         FROM profile
         WHERE (?1 IS NULL OR archive_id = ?1)
         LIMIT 1",
        params![archive_id],
        |r| {
            Ok(ProfileOut {
                username: r.get(0)?,
                display_name: r.get(1)?,
                profile_photo_uri: r.get(2)?,
                is_private: r.get(3)?,
                country_code: r.get(4)?,
                fbid: r.get(5)?,
                email: r.get(6)?,
                phone: r.get(7)?,
                gender: r.get(8)?,
                date_of_birth: r.get(9)?,
                last_login_at: r.get(10)?,
            })
        },
    )
    .optional()
}

fn row_to_saved(r: &rusqlite::Row) -> rusqlite::Result<SavedItemOut> {
    Ok(SavedItemOut {
        id: r.get(0)?,
        url: r.get(1)?,
        caption: r.get(2)?,
        saved_at: r.get(3)?,
        collection_names: r.get(4)?,
        download_status: r.get(5)?,
        local_path: r.get(6)?,
        thumb_path: r.get(7)?,
    })
}

fn saved_items(
    conn: &Connection,
    archive_id: Option<i64>,
    collection: Option<&str>,
) -> rusqlite::Result<Vec<SavedItemOut>> {
    const COLS: &str =
        "id, url, caption, saved_at, collection_names, download_status, local_path, thumb_path";
    match collection {
        Some(c) => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {COLS} FROM saved_items
                 WHERE EXISTS (SELECT 1 FROM json_each(collection_names) WHERE value = ?1)
                   AND (?2 IS NULL OR archive_id = ?2)
                 ORDER BY saved_at DESC"
            ))?;
            let rows = stmt
                .query_map(params![c, archive_id], row_to_saved)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        }
        None => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {COLS} FROM saved_items
                 WHERE (?1 IS NULL OR archive_id = ?1)
                 ORDER BY saved_at DESC"
            ))?;
            let rows = stmt
                .query_map(params![archive_id], row_to_saved)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        }
    }
}

fn collections(
    conn: &Connection,
    archive_id: Option<i64>,
) -> rusqlite::Result<Vec<CollectionCountOut>> {
    let mut stmt = conn.prepare(
        "SELECT name, item_count FROM saved_collections
         WHERE (?1 IS NULL OR archive_id = ?1)
         ORDER BY item_count DESC, name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map(params![archive_id], |r| {
            Ok(CollectionCountOut {
                name: r.get(0)?,
                item_count: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Every imported archive, most-recently-ingested first, joined to its profile
/// for a display label. Drives the import switcher and the Settings list; each
/// row is one selectable account (the active scope for all content queries).
fn archives_list(conn: &Connection) -> rusqlite::Result<Vec<ArchiveListItem>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.service, a.source_path, a.ingested_at, p.username, p.display_name
         FROM archives a
         LEFT JOIN profile p ON p.archive_id = a.id
         ORDER BY a.ingested_at DESC, a.id DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ArchiveListItem {
                id: r.get(0)?,
                service: r.get(1)?,
                source_path: r.get(2)?,
                ingested_at: r.get(3)?,
                username: r.get(4)?,
                display_name: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Remove one imported archive and all its content from the index. FTS tables
/// aren't covered by ON DELETE CASCADE, so clear them first; content rows are
/// then deleted explicitly (the same set reset_archive clears) plus archive_parts
/// and the archives row. messages/message_downloads go via the threads→messages
/// FK cascade. On-disk yt-dlp downloads for this import are intentionally left in
/// place: they re-link by URL on re-import, and move under the per-vault root in
/// Phase 2.
fn delete_archive_rows(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM saved_items_fts WHERE rowid IN (SELECT id FROM saved_items WHERE archive_id = ?1)",
        params![id],
    )?;
    conn.execute(
        "DELETE FROM messages_fts WHERE rowid IN (SELECT m.id FROM messages m JOIN threads t ON m.thread_id = t.id WHERE t.archive_id = ?1)",
        params![id],
    )?;
    conn.execute(
        "DELETE FROM reposts_fts WHERE rowid IN (SELECT id FROM reposts WHERE archive_id = ?1)",
        params![id],
    )?;
    for tbl in [
        "profile",
        "profile_changes",
        "saved_items",
        "saved_collections",
        "threads", // cascades to messages → message_downloads via FK
        "stories",
        "reposts",
        "own_posts",
        "connections",
        "posts",
        "albums",
        "archive_parts",
    ] {
        conn.execute(
            &format!("DELETE FROM {tbl} WHERE archive_id = ?1"),
            params![id],
        )?;
    }
    conn.execute("DELETE FROM archives WHERE id = ?1", params![id])?;
    Ok(())
}

fn threads(conn: &Connection, archive_id: Option<i64>) -> rusqlite::Result<Vec<ThreadSummaryOut>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.slug, t.source, t.title, t.participants, t.message_count, t.last_message_at,
                (SELECT content FROM messages WHERE thread_id = t.id ORDER BY timestamp_ms DESC LIMIT 1) AS last_preview,
                (SELECT sender  FROM messages WHERE thread_id = t.id ORDER BY timestamp_ms DESC LIMIT 1) AS last_sender
         FROM threads t
         WHERE (?1 IS NULL OR t.archive_id = ?1)
         ORDER BY COALESCE(t.last_message_at, 0) DESC",
    )?;
    let rows = stmt
        .query_map(params![archive_id], |r| {
            Ok(ThreadSummaryOut {
                id: r.get(0)?,
                slug: r.get(1)?,
                source: r.get(2)?,
                title: r.get(3)?,
                participants: r.get(4)?,
                message_count: r.get(5)?,
                last_message_at: r.get(6)?,
                last_preview: r.get(7)?,
                last_sender: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Folds the old fetchThread() two-query path (thread row + messages) into one
/// round-trip. `thread` is None when the slug doesn't match (TS returns null then).
fn thread_detail(
    conn: &Connection,
    slug: &str,
    archive_id: Option<i64>,
) -> rusqlite::Result<ThreadDetailOut> {
    let thread = conn
        .query_row(
            "SELECT id, slug, source, title, participants, message_count, last_message_at
             FROM threads
             WHERE slug = ?1
               AND (?2 IS NULL OR archive_id = ?2)
             LIMIT 1",
            params![slug, archive_id],
            |r| {
                Ok(ThreadSummaryOut {
                    id: r.get(0)?,
                    slug: r.get(1)?,
                    source: r.get(2)?,
                    title: r.get(3)?,
                    participants: r.get(4)?,
                    message_count: r.get(5)?,
                    last_message_at: r.get(6)?,
                    // Cosmetic for the detail view; TS coerces None → "".
                    last_preview: None,
                    last_sender: None,
                })
            },
        )
        .optional()?;

    let messages = match &thread {
        Some(t) => {
            let mut stmt = conn.prepare(
                "SELECT m.id, m.sender, m.timestamp_ms, m.content, m.reactions, m.media,
                        COALESCE(d.status, 'none') AS download_status, d.local_path, d.thumb_path
                 FROM messages m
                 LEFT JOIN message_downloads d ON d.message_id = m.id
                 WHERE m.thread_id = ?1 ORDER BY m.timestamp_ms ASC",
            )?;
            let msgs = stmt
                .query_map(params![t.id], |r| {
                    Ok(MessageOut {
                        id: r.get(0)?,
                        sender: r.get(1)?,
                        timestamp_ms: r.get(2)?,
                        content: r.get(3)?,
                        reactions: r.get(4)?,
                        media: r.get(5)?,
                        download_status: r.get(6)?,
                        local_path: r.get(7)?,
                        thumb_path: r.get(8)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            msgs
        }
        None => Vec::new(),
    };
    Ok(ThreadDetailOut { thread, messages })
}

fn self_sender(conn: &Connection, archive_id: Option<i64>) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT m.sender FROM messages m JOIN threads t ON t.id = m.thread_id
         WHERE (?1 IS NULL OR t.archive_id = ?1)
         GROUP BY m.sender ORDER BY COUNT(*) DESC LIMIT 1",
        params![archive_id],
        |r| r.get::<_, String>(0),
    )
    .optional()
}

fn profile_changes(
    conn: &Connection,
    archive_id: Option<i64>,
) -> rusqlite::Result<Vec<ProfileChangeOut>> {
    let mut stmt = conn.prepare(
        "SELECT field, previous_value, new_value, changed_at FROM profile_changes
         WHERE (?1 IS NULL OR archive_id = ?1)
         ORDER BY changed_at DESC",
    )?;
    let rows = stmt
        .query_map(params![archive_id], |r| {
            Ok(ProfileChangeOut {
                field: r.get(0)?,
                previous_value: r.get(1)?,
                new_value: r.get(2)?,
                changed_at: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn stories(conn: &Connection, archive_id: Option<i64>) -> rusqlite::Result<Vec<StoryOut>> {
    let mut stmt = conn.prepare(
        "SELECT uri, created_at, title, source_app FROM stories
         WHERE (?1 IS NULL OR archive_id = ?1)
         ORDER BY created_at DESC",
    )?;
    let rows = stmt
        .query_map(params![archive_id], |r| {
            Ok(StoryOut {
                uri: r.get(0)?,
                created_at: r.get(1)?,
                title: r.get(2)?,
                source_app: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn reposts(conn: &Connection, archive_id: Option<i64>) -> rusqlite::Result<Vec<RepostOut>> {
    let mut stmt = conn.prepare(
        "SELECT id, reposted_at, user_text, source_url, source_caption,
                source_owner_name, source_owner_username, download_status, local_path, thumb_path
         FROM reposts
         WHERE (?1 IS NULL OR archive_id = ?1)
         ORDER BY reposted_at DESC",
    )?;
    let rows = stmt
        .query_map(params![archive_id], |r| {
            Ok(RepostOut {
                id: r.get(0)?,
                reposted_at: r.get(1)?,
                user_text: r.get(2)?,
                source_url: r.get(3)?,
                source_caption: r.get(4)?,
                source_owner_name: r.get(5)?,
                source_owner_username: r.get(6)?,
                download_status: r.get(7)?,
                local_path: r.get(8)?,
                thumb_path: r.get(9)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn own_posts(conn: &Connection, archive_id: Option<i64>) -> rusqlite::Result<Vec<OwnPostOut>> {
    let mut stmt = conn.prepare(
        "SELECT uri, media_id, ext, size_bytes FROM own_posts
         WHERE (?1 IS NULL OR archive_id = ?1)
         ORDER BY media_id",
    )?;
    let rows = stmt
        .query_map(params![archive_id], |r| {
            Ok(OwnPostOut {
                uri: r.get(0)?,
                media_id: r.get(1)?,
                ext: r.get(2)?,
                size_bytes: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn posts(conn: &Connection, archive_id: Option<i64>) -> rusqlite::Result<Vec<PostOut>> {
    let mut stmt = conn.prepare(
        "SELECT id, created_at, text, title, media, links FROM posts
         WHERE (?1 IS NULL OR archive_id = ?1)
         ORDER BY created_at DESC, id DESC",
    )?;
    let rows = stmt
        .query_map(params![archive_id], |r| {
            Ok(PostOut {
                id: r.get(0)?,
                created_at: r.get(1)?,
                text: r.get(2)?,
                title: r.get(3)?,
                media: r.get(4)?,
                links: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn albums(conn: &Connection, archive_id: Option<i64>) -> rusqlite::Result<Vec<AlbumOut>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, cover_photo_uri, last_modified, photo_count, photos FROM albums
         WHERE (?1 IS NULL OR archive_id = ?1)
         ORDER BY last_modified DESC, id DESC",
    )?;
    let rows = stmt
        .query_map(params![archive_id], |r| {
            Ok(AlbumOut {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                cover_photo_uri: r.get(3)?,
                last_modified: r.get(4)?,
                photo_count: r.get(5)?,
                photos: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// --- Mixed feed (Reels) -----------------------------------------------------
// Enumerates playable media across every source into one flat list. In-zip media
// (stories, own posts, FB posts/albums, DM photos/videos/gifs) is always available;
// permalink sources (saved, reposts, DM shares) appear only once downloaded. Each
// source is bounded by `LIMIT` so even a 100k-message archive does bounded work;
// the merged list is sorted newest-first and truncated. The frontend shuffles.

/// Image vs video purely from the file extension (mirrors `media::content_type`'s
/// video set) — neither the DB nor the JSON media columns carry a type.
fn media_kind(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "mp4" | "m4v" | "mov" | "webm" => "video",
        _ => "image",
    }
}

/// Trim, drop-if-empty, and cap a caption so the feed payload stays small.
fn clip_caption(s: &str, n: usize) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if s.chars().count() <= n {
        Some(s.to_string())
    } else {
        Some(s.chars().take(n).collect::<String>() + "…")
    }
}

#[derive(Deserialize)]
struct FeedMediaRef {
    uri: String,
    #[serde(rename = "createdAt")]
    created_at: Option<i64>,
}

#[derive(Deserialize)]
struct FeedPhotoRef {
    uri: String,
    #[serde(rename = "createdAt")]
    created_at: Option<i64>,
    title: Option<String>,
    description: Option<String>,
}

#[derive(Deserialize)]
struct FeedUriRef {
    uri: String,
}

#[derive(Deserialize, Default)]
struct FeedMsgMedia {
    #[serde(default)]
    photos: Vec<FeedUriRef>,
    #[serde(default)]
    videos: Vec<FeedUriRef>,
    #[serde(default)]
    gifs: Vec<FeedUriRef>,
}

fn feed(conn: &Connection, archive_id: Option<i64>, limit: i64) -> rusqlite::Result<Vec<FeedItemOut>> {
    let mut out: Vec<FeedItemOut> = Vec::new();

    // Stories (in-zip).
    {
        let mut stmt = conn.prepare(
            "SELECT uri, title, created_at FROM stories
             WHERE (?1 IS NULL OR archive_id = ?1)
             ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![archive_id, limit], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
        })?;
        for row in rows {
            let (uri, title, created_at) = row?;
            out.push(FeedItemOut {
                source: "Story".into(),
                kind: media_kind(&uri).into(),
                uri: Some(uri),
                local_path: None,
                poster_path: None,
                caption: clip_caption(&title, 280),
                timestamp_ms: Some(created_at),
            });
        }
    }

    // Own posts (in-zip; no timestamp in the 2026-05 export).
    {
        let mut stmt = conn.prepare(
            "SELECT uri FROM own_posts
             WHERE (?1 IS NULL OR archive_id = ?1)
             ORDER BY media_id LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![archive_id, limit], |r| r.get::<_, String>(0))?;
        for row in rows {
            let uri = row?;
            out.push(FeedItemOut {
                source: "Post".into(),
                kind: media_kind(&uri).into(),
                uri: Some(uri),
                local_path: None,
                poster_path: None,
                caption: None,
                timestamp_ms: None,
            });
        }
    }

    // Facebook posts (JSON `media` column → one item per entry).
    {
        let mut stmt = conn.prepare(
            "SELECT media, text, title, created_at FROM posts
             WHERE (?1 IS NULL OR archive_id = ?1)
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![archive_id, limit], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?;
        for row in rows {
            let (media, text, title, created_at) = row?;
            let caption = clip_caption(&text, 280).or_else(|| clip_caption(&title, 280));
            for m in serde_json::from_str::<Vec<FeedMediaRef>>(&media).unwrap_or_default() {
                out.push(FeedItemOut {
                    source: "Post".into(),
                    kind: media_kind(&m.uri).into(),
                    uri: Some(m.uri),
                    local_path: None,
                    poster_path: None,
                    caption: caption.clone(),
                    timestamp_ms: Some(m.created_at.unwrap_or(created_at)),
                });
            }
        }
    }

    // Facebook albums (JSON `photos` column → one item per photo).
    {
        let mut stmt = conn.prepare(
            "SELECT name, photos, last_modified FROM albums
             WHERE (?1 IS NULL OR archive_id = ?1)
             ORDER BY last_modified DESC, id DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![archive_id, limit], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
        })?;
        for row in rows {
            let (name, photos, last_modified) = row?;
            let source = if name.trim().is_empty() {
                "Album".to_string()
            } else {
                format!("Album · {name}")
            };
            for p in serde_json::from_str::<Vec<FeedPhotoRef>>(&photos).unwrap_or_default() {
                let caption = p
                    .description
                    .as_deref()
                    .and_then(|d| clip_caption(d, 280))
                    .or_else(|| p.title.as_deref().and_then(|t| clip_caption(t, 280)))
                    .or_else(|| clip_caption(&name, 280));
                out.push(FeedItemOut {
                    source: source.clone(),
                    kind: media_kind(&p.uri).into(),
                    uri: Some(p.uri),
                    local_path: None,
                    poster_path: None,
                    caption,
                    timestamp_ms: Some(p.created_at.unwrap_or(last_modified)),
                });
            }
        }
    }

    // DM media: in-zip photos/videos/gifs (parsed from the JSON `media` column) plus
    // any downloaded shared post. The `LIKE '%"uri"%'` guard skips text-only messages
    // cheaply; downloaded shares are caught by the `local_path` clause.
    {
        let mut stmt = conn.prepare(
            "SELECT m.media, m.content, m.timestamp_ms, t.title, t.participants,
                    md.status, md.local_path, md.thumb_path
             FROM messages m
             JOIN threads t ON t.id = m.thread_id
             LEFT JOIN message_downloads md ON md.message_id = m.id
             WHERE (?1 IS NULL OR t.archive_id = ?1)
               AND (m.media LIKE '%\"uri\"%' OR md.local_path IS NOT NULL)
             ORDER BY m.timestamp_ms DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![archive_id, limit], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, Option<String>>(7)?,
            ))
        })?;
        for row in rows {
            let (media, content, ts, title, participants, status, local_path, thumb_path) = row?;
            let label = if !title.trim().is_empty() {
                title
            } else {
                serde_json::from_str::<Vec<String>>(&participants)
                    .ok()
                    .and_then(|p| p.into_iter().next())
                    .unwrap_or_default()
            };
            let source = if label.trim().is_empty() {
                "DM".to_string()
            } else {
                format!("DM · {label}")
            };
            let caption = clip_caption(&content, 280);

            let parsed: FeedMsgMedia = serde_json::from_str(&media).unwrap_or_default();
            for v in parsed.videos {
                out.push(FeedItemOut {
                    source: source.clone(),
                    kind: "video".into(),
                    uri: Some(v.uri),
                    local_path: None,
                    poster_path: None,
                    caption: caption.clone(),
                    timestamp_ms: Some(ts),
                });
            }
            for p in parsed.photos.into_iter().chain(parsed.gifs) {
                out.push(FeedItemOut {
                    source: source.clone(),
                    kind: "image".into(),
                    uri: Some(p.uri),
                    local_path: None,
                    poster_path: None,
                    caption: caption.clone(),
                    timestamp_ms: Some(ts),
                });
            }
            if status.as_deref() == Some("downloaded") {
                if let Some(lp) = local_path {
                    out.push(FeedItemOut {
                        source: source.clone(),
                        kind: media_kind(&lp).into(),
                        uri: None,
                        local_path: Some(lp),
                        poster_path: thumb_path,
                        caption: caption.clone(),
                        timestamp_ms: Some(ts),
                    });
                }
            }
        }
    }

    // Saved posts + reposts: only the ones that have actually been downloaded.
    for (table, source, ts_col, cap_col) in [
        ("saved_items", "Saved", "saved_at", "caption"),
        ("reposts", "Repost", "reposted_at", "source_caption"),
    ] {
        let sql = format!(
            "SELECT local_path, thumb_path, {cap_col}, {ts_col} FROM {table}
             WHERE (?1 IS NULL OR archive_id = ?1)
               AND download_status = 'downloaded' AND local_path IS NOT NULL
             ORDER BY {ts_col} DESC LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![archive_id, limit], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?;
        for row in rows {
            let (local_path, thumb_path, caption, ts) = row?;
            out.push(FeedItemOut {
                source: source.to_string(),
                kind: media_kind(&local_path).into(),
                uri: None,
                local_path: Some(local_path),
                poster_path: thumb_path,
                caption: clip_caption(&caption, 280),
                timestamp_ms: Some(ts),
            });
        }
    }

    // Newest-first across all sources, then bound the total (the frontend shuffles).
    out.sort_by(|a, b| {
        b.timestamp_ms
            .unwrap_or(i64::MIN)
            .cmp(&a.timestamp_ms.unwrap_or(i64::MIN))
    });
    out.truncate(limit as usize);
    Ok(out)
}

fn connections(conn: &Connection, archive_id: Option<i64>) -> rusqlite::Result<Vec<ConnectionOut>> {
    let mut stmt = conn.prepare(
        "SELECT kind, username, href, followed_at FROM connections
         WHERE (?1 IS NULL OR archive_id = ?1)
         ORDER BY username COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map(params![archive_id], |r| {
            Ok(ConnectionOut {
                kind: r.get(0)?,
                username: r.get(1)?,
                href: r.get(2)?,
                followed_at: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// Shares scope by the message's thread's archive; saved stats by archive — same
// `?1 IS NULL OR …` guard as the other content queries (None = all accounts).
fn share_rows(conn: &Connection, archive_id: Option<i64>) -> rusqlite::Result<Vec<ShareRowOut>> {
    let mut stmt = conn.prepare(
        "SELECT m.id AS id,
                json_extract(m.media, '$.share.link') AS link,
                COALESCE(d.status, 'none') AS status
         FROM messages m
         LEFT JOIN message_downloads d ON d.message_id = m.id
         WHERE json_extract(m.media, '$.share.link') IS NOT NULL
           AND (?1 IS NULL OR m.thread_id IN
                (SELECT id FROM threads WHERE archive_id = ?1))",
    )?;
    let rows = stmt
        .query_map(params![archive_id], |r| {
            Ok(ShareRowOut {
                id: r.get(0)?,
                link: r.get(1)?,
                status: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn saved_download_stats(
    conn: &Connection,
    archive_id: Option<i64>,
) -> rusqlite::Result<SavedDownloadStatsOut> {
    conn.query_row(
        "SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN download_status = 'downloaded' THEN 1 ELSE 0 END), 0) AS downloaded,
                COALESCE(SUM(CASE WHEN download_status IN ('dead','login_walled') THEN 1 ELSE 0 END), 0) AS unavailable
         FROM saved_items
         WHERE (?1 IS NULL OR archive_id = ?1)",
        params![archive_id],
        |r| {
            Ok(SavedDownloadStatsOut {
                total: r.get(0)?,
                downloaded: r.get(1)?,
                unavailable: r.get(2)?,
            })
        },
    )
}

/// Build an FTS5 MATCH expression from free user text: each whitespace-separated
/// token becomes a quoted prefix term (`"tok"*`), AND-ed together. Quoting makes
/// punctuation literal so arbitrary input can't trigger an FTS5 syntax error, and
/// the trailing `*` enables prefix matching. None when the input has no tokens.
fn fts_match_query(q: &str) -> Option<String> {
    let terms: Vec<String> = q
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"*", t.replace('"', "\"\"")))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

/// Full-text search across the three indexed text surfaces (saved captions,
/// message bodies, repost captions/notes), service-scoped like the other reads.
/// Each source is capped so one noisy source can't crowd out the others; the UI
/// groups results by `kind`. An empty/whitespace query returns nothing.
fn search(
    conn: &Connection,
    q: &str,
    archive_id: Option<i64>,
) -> rusqlite::Result<Vec<SearchResultOut>> {
    const PER_SOURCE: i64 = 25;
    let Some(m) = fts_match_query(q) else {
        return Ok(Vec::new());
    };
    let mut out: Vec<SearchResultOut> = Vec::new();

    // Saved captions → /saved
    let mut stmt = conn.prepare(
        "SELECT si.caption, si.saved_at
         FROM saved_items_fts JOIN saved_items si ON si.id = saved_items_fts.rowid
         WHERE saved_items_fts MATCH ?2
           AND (?1 IS NULL OR si.archive_id = ?1)
         ORDER BY rank LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![archive_id, m, PER_SOURCE], |r| {
        Ok(SearchResultOut {
            kind: "saved".into(),
            title: String::new(),
            participants: String::new(),
            snippet: r.get::<_, String>(0)?,
            slug: None,
            timestamp: r.get(1)?,
        })
    })?;
    for row in rows {
        out.push(row?);
    }

    // Message bodies → /dms/<slug>
    let mut stmt = conn.prepare(
        "SELECT t.slug, t.title, t.participants, m.content, m.timestamp_ms
         FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid JOIN threads t ON t.id = m.thread_id
         WHERE messages_fts MATCH ?2
           AND (?1 IS NULL OR t.archive_id = ?1)
         ORDER BY rank LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![archive_id, m, PER_SOURCE], |r| {
        Ok(SearchResultOut {
            kind: "message".into(),
            title: r.get::<_, String>(1)?,
            participants: r.get::<_, String>(2)?,
            snippet: r.get::<_, String>(3)?,
            slug: Some(r.get::<_, String>(0)?),
            timestamp: r.get(4)?,
        })
    })?;
    for row in rows {
        out.push(row?);
    }

    // Repost captions / your note → /reposts
    let mut stmt = conn.prepare(
        "SELECT r.source_caption, r.user_text, r.reposted_at
         FROM reposts_fts JOIN reposts r ON r.id = reposts_fts.rowid
         WHERE reposts_fts MATCH ?2
           AND (?1 IS NULL OR r.archive_id = ?1)
         ORDER BY rank LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![archive_id, m, PER_SOURCE], |r| {
        let caption: String = r.get(0)?;
        let note: String = r.get(1)?;
        Ok(SearchResultOut {
            kind: "repost".into(),
            title: String::new(),
            participants: String::new(),
            snippet: if caption.is_empty() { note } else { caption },
            slug: None,
            timestamp: r.get(2)?,
        })
    })?;
    for row in rows {
        out.push(row?);
    }

    Ok(out)
}

/// Record (or replace) the outcome of an avatar fetch. `local_path` is set only
/// for `status = "ok"`; other statuses persist the reason with a NULL path.
pub(crate) fn upsert_avatar(
    conn: &Connection,
    service: &str,
    handle: &str,
    status: &str,
    local_path: Option<&str>,
    fetched_at: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO avatars (service, handle, local_path, status, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![service, handle, local_path, status, fetched_at],
    )?;
    Ok(())
}

/// Successfully-fetched avatars for a service → the UI maps handle → local_path.
fn avatars(conn: &Connection, service: Option<&str>) -> rusqlite::Result<Vec<AvatarOut>> {
    let mut stmt = conn.prepare(
        "SELECT handle, local_path FROM avatars
         WHERE status = 'ok' AND local_path IS NOT NULL
           AND (?1 IS NULL OR service = ?1)",
    )?;
    let rows = stmt
        .query_map(params![service], |r| {
            Ok(AvatarOut {
                handle: r.get(0)?,
                local_path: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn query_avatars(state: State<Db>, service: Option<String>) -> Result<Vec<AvatarOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    avatars(&conn, service.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_overview(state: State<Db>, archive_id: Option<i64>) -> Result<Overview, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    overview(&conn, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_profile(
    state: State<Db>,
    archive_id: Option<i64>,
) -> Result<Option<ProfileOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    profile(&conn, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_saved_items(
    state: State<Db>,
    archive_id: Option<i64>,
    collection: Option<String>,
) -> Result<Vec<SavedItemOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    saved_items(&conn, archive_id, collection.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_collections(
    state: State<Db>,
    archive_id: Option<i64>,
) -> Result<Vec<CollectionCountOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    collections(&conn, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_archives(state: State<Db>) -> Result<Vec<ArchiveListItem>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    archives_list(&conn).map_err(|e| e.to_string())
}

/// Remove an imported archive (account) and all of its content from the index.
#[tauri::command]
pub fn delete_archive(state: State<Db>, archive_id: i64) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    delete_archive_rows(&tx, archive_id).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_threads(
    state: State<Db>,
    archive_id: Option<i64>,
) -> Result<Vec<ThreadSummaryOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    threads(&conn, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_thread_detail(
    state: State<Db>,
    slug: String,
    archive_id: Option<i64>,
) -> Result<ThreadDetailOut, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    thread_detail(&conn, &slug, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_self_sender(
    state: State<Db>,
    archive_id: Option<i64>,
) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    self_sender(&conn, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_profile_changes(
    state: State<Db>,
    archive_id: Option<i64>,
) -> Result<Vec<ProfileChangeOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    profile_changes(&conn, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_stories(state: State<Db>, archive_id: Option<i64>) -> Result<Vec<StoryOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    stories(&conn, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_reposts(state: State<Db>, archive_id: Option<i64>) -> Result<Vec<RepostOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    reposts(&conn, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_own_posts(
    state: State<Db>,
    archive_id: Option<i64>,
) -> Result<Vec<OwnPostOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    own_posts(&conn, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_posts(state: State<Db>, archive_id: Option<i64>) -> Result<Vec<PostOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    posts(&conn, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_albums(state: State<Db>, archive_id: Option<i64>) -> Result<Vec<AlbumOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    albums(&conn, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_connections(
    state: State<Db>,
    archive_id: Option<i64>,
) -> Result<Vec<ConnectionOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    connections(&conn, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_share_rows(
    state: State<Db>,
    archive_id: Option<i64>,
) -> Result<Vec<ShareRowOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    share_rows(&conn, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_saved_download_stats(
    state: State<Db>,
    archive_id: Option<i64>,
) -> Result<SavedDownloadStatsOut, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    saved_download_stats(&conn, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_search(
    state: State<Db>,
    query: String,
    archive_id: Option<i64>,
) -> Result<Vec<SearchResultOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    search(&conn, &query, archive_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_feed(
    state: State<Db>,
    archive_id: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<FeedItemOut>, String> {
    let limit = limit.unwrap_or(3000).clamp(1, 10_000);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    feed(&conn, archive_id, limit).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_applies_and_fts5_matches() {
        let conn = open(":memory:").expect("open + migrate");
        conn.execute(
            "INSERT INTO archives (id, source_path, service, ingested_at) VALUES (1,'t','instagram',0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO saved_items (id, archive_id, url, caption, saved_at) VALUES (1,1,'u','hello café world',0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO saved_items_fts (rowid, caption) VALUES (1,'hello café world')",
            [],
        )
        .unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM saved_items_fts WHERE saved_items_fts MATCH 'café'",
                [],
                |r| r.get(0),
            )
            .expect("fts5 MATCH query");
        assert_eq!(n, 1, "FTS5 MATCH should find the inserted row");
    }

    #[test]
    fn fts_match_query_quotes_and_prefixes_tokens() {
        assert_eq!(
            fts_match_query("hello world").as_deref(),
            Some("\"hello\"* \"world\"*")
        );
        assert_eq!(fts_match_query("   "), None);
        // Quotes in input are doubled so they can't break out of the term.
        assert_eq!(fts_match_query("a\"b").as_deref(), Some("\"a\"\"b\"*"));
    }

    #[test]
    fn search_matches_indexed_text_and_scopes_by_service() {
        let mut conn = open(":memory:").unwrap();
        let payload = IngestPayload {
            source_path: "ig.zip".into(),
            service: "instagram".into(),
            part_paths: vec![],
            profile: None,
            profile_changes: vec![],
            saved_items: vec![SavedItemRow {
                url: "https://insta/p/1".into(),
                caption: "a croissant in Paris".into(),
                saved_at: 1000,
                collection_names: "[]".into(),
            }],
            saved_collections: vec![],
            threads: vec![ThreadRow {
                thread_path: "inbox/x".into(),
                source: "inbox".into(),
                slug: "x".into(),
                title: "X".into(),
                participants: "[]".into(),
                is_still_participant: true,
                messages: vec![MessageRow {
                    sender: "you".into(),
                    timestamp_ms: 2,
                    content: "salut tout le monde".into(),
                    reactions: "[]".into(),
                    media: "{}".into(),
                }],
            }],
            stories: vec![],
            reposts: vec![],
            own_posts: vec![],
            connections: vec![],
            posts: vec![],
            albums: vec![],
        };
        ingest_into(&mut conn, &payload).unwrap();

        // Prefix match on a saved caption.
        let saved = search(&conn, "crois", None).unwrap();
        assert!(
            saved
                .iter()
                .any(|r| r.kind == "saved" && r.snippet.contains("croissant")),
            "saved caption should match by prefix"
        );

        // Message body matches and carries the thread slug for routing.
        let msg = search(&conn, "salut", None).unwrap();
        let hit = msg
            .iter()
            .find(|r| r.kind == "message")
            .expect("a message hit");
        assert_eq!(hit.slug.as_deref(), Some("x"));

        // Account scoping: a different archive returns nothing; the right one does.
        let ig_id: i64 = conn
            .query_row("SELECT id FROM archives", [], |r| r.get(0))
            .unwrap();
        assert!(search(&conn, "salut", Some(ig_id + 1)).unwrap().is_empty());
        assert!(!search(&conn, "salut", Some(ig_id)).unwrap().is_empty());

        // Empty / whitespace query is a no-op (no FTS syntax error).
        assert!(search(&conn, "   ", None).unwrap().is_empty());
    }

    #[test]
    fn feed_mixes_sources_and_unnests_json_media() {
        let mut conn = open(":memory:").unwrap();
        let payload = IngestPayload {
            source_path: "ig.zip".into(),
            service: "instagram".into(),
            part_paths: vec![],
            profile: None,
            profile_changes: vec![],
            saved_items: vec![],
            saved_collections: vec![],
            threads: vec![ThreadRow {
                thread_path: "inbox/x".into(),
                source: "inbox".into(),
                slug: "x".into(),
                title: "Alex".into(),
                participants: "[\"Alex\"]".into(),
                is_still_participant: true,
                messages: vec![MessageRow {
                    sender: "you".into(),
                    timestamp_ms: 500,
                    content: "look".into(),
                    reactions: "[]".into(),
                    media: "{\"photos\":[{\"uri\":\"dm/p.jpg\"}],\"videos\":[{\"uri\":\"dm/v.mp4\"}]}"
                        .into(),
                }],
            }],
            stories: vec![StoryRow {
                uri: "stories/s.jpg".into(),
                created_at: 100,
                title: "my story".into(),
                source_app: None,
                device_id: None,
            }],
            reposts: vec![],
            own_posts: vec![OwnPostRow {
                uri: "posts/o.mp4".into(),
                media_id: "o".into(),
                ext: Some("mp4".into()),
                size_bytes: None,
            }],
            connections: vec![],
            posts: vec![PostRow {
                created_at: 300,
                text: "fb post".into(),
                title: "".into(),
                media: "[{\"uri\":\"posts/fb.jpg\"}]".into(),
                links: "[]".into(),
            }],
            albums: vec![AlbumRow {
                name: "Trip".into(),
                description: None,
                cover_photo_uri: None,
                last_modified: 400,
                photo_count: 1,
                photos: "[{\"uri\":\"album/a.jpg\"}]".into(),
            }],
        };
        ingest_into(&mut conn, &payload).unwrap();

        let items = feed(&conn, None, 1000).unwrap();
        let by_uri = |u: &str| items.iter().find(|i| i.uri.as_deref() == Some(u));

        // One item per source, with extension-derived kind and provenance label.
        assert_eq!(by_uri("stories/s.jpg").unwrap().source, "Story");
        assert_eq!(by_uri("posts/o.mp4").unwrap().kind, "video");
        assert_eq!(by_uri("posts/fb.jpg").unwrap().source, "Post");
        assert_eq!(by_uri("album/a.jpg").unwrap().source, "Album · Trip");
        assert_eq!(by_uri("dm/p.jpg").unwrap().kind, "image");
        let dmv = by_uri("dm/v.mp4").unwrap();
        assert_eq!(dmv.kind, "video");
        assert_eq!(dmv.source, "DM · Alex");

        // Newest-first; the undated own post sorts last.
        assert_eq!(items.last().unwrap().uri.as_deref(), Some("posts/o.mp4"));

        // Account scoping: a non-matching archive id yields nothing.
        assert!(feed(&conn, Some(99), 1000).unwrap().is_empty());
    }

    #[test]
    fn avatars_upsert_replaces_and_reads_only_ok_rows() {
        let conn = open(":memory:").unwrap();
        upsert_avatar(&conn, "instagram", "alice", "ok", Some("avatars/ig/alice.jpg"), 100).unwrap();
        upsert_avatar(&conn, "instagram", "bob", "login_walled", None, 100).unwrap();
        // Re-fetch upgrades bob to ok (INSERT OR REPLACE on the PK).
        upsert_avatar(&conn, "instagram", "bob", "ok", Some("avatars/ig/bob.jpg"), 200).unwrap();

        let ok = avatars(&conn, Some("instagram")).unwrap();
        let mut handles: Vec<&str> = ok.iter().map(|a| a.handle.as_str()).collect();
        handles.sort();
        assert_eq!(handles, vec!["alice", "bob"]);

        // A login_walled row (NULL path) is excluded from the served set.
        upsert_avatar(&conn, "instagram", "carol", "login_walled", None, 100).unwrap();
        assert_eq!(avatars(&conn, Some("instagram")).unwrap().len(), 2);

        // Service scoping.
        assert!(avatars(&conn, Some("facebook")).unwrap().is_empty());
    }

    #[test]
    fn ingest_into_inserts_rows_and_links_fts() {
        let mut conn = open(":memory:").unwrap();
        let payload = IngestPayload {
            source_path: "test.zip".into(),
            service: "instagram".into(),
            part_paths: vec!["test-1.zip".into(), "test-2.zip".into()],
            profile: None,
            profile_changes: vec![],
            saved_items: vec![SavedItemRow {
                url: "https://insta/p/1".into(),
                caption: "a croissant in Paris".into(),
                saved_at: 1000,
                collection_names: "[]".into(),
            }],
            saved_collections: vec![],
            threads: vec![ThreadRow {
                thread_path: "inbox/x".into(),
                source: "inbox".into(),
                slug: "x".into(),
                title: "X".into(),
                participants: "[]".into(),
                is_still_participant: true,
                messages: vec![
                    MessageRow {
                        sender: "me".into(),
                        timestamp_ms: 1,
                        content: "bonjour".into(),
                        reactions: "[]".into(),
                        media: "{}".into(),
                    },
                    MessageRow {
                        sender: "you".into(),
                        timestamp_ms: 2,
                        content: "salut".into(),
                        reactions: "[]".into(),
                        media: "{}".into(),
                    },
                ],
            }],
            stories: vec![],
            reposts: vec![],
            own_posts: vec![],
            connections: vec![ConnectionRow {
                kind: "following".into(),
                username: "adrienbroner".into(),
                href: "https://www.instagram.com/adrienbroner".into(),
                followed_at: 1778680816,
            }],
            posts: vec![],
            albums: vec![],
        };
        let counts = ingest_into(&mut conn, &payload).unwrap();
        assert_eq!(counts.saved_items, 1);
        assert_eq!(counts.threads, 1);
        assert_eq!(counts.messages, 2);
        assert_eq!(counts.connections, 1);

        // 16A: every part path is persisted, in order.
        let parts: Vec<(i64, String)> = {
            let mut stmt = conn
                .prepare("SELECT idx, path FROM archive_parts ORDER BY idx")
                .unwrap();
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
            rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
        };
        assert_eq!(
            parts,
            vec![(0, "test-1.zip".to_string()), (1, "test-2.zip".to_string())],
            "all archive parts persisted in order"
        );

        // FTS rowid links back to the source message id
        let hit: i64 = conn
            .query_row(
                "SELECT m.id FROM messages m JOIN messages_fts f ON m.id = f.rowid
                 WHERE messages_fts MATCH 'salut'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let direct: i64 = conn
            .query_row(
                "SELECT id FROM messages WHERE content = 'salut'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hit, direct, "FTS rowid must equal source message id");

        // Re-ingest is idempotent (resetArchive clears the prior rows)
        let counts2 = ingest_into(&mut conn, &payload).unwrap();
        assert_eq!(counts2, counts, "re-ingest should not duplicate rows");

        let part_count: i64 = conn
            .query_row("SELECT count(*) FROM archive_parts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(part_count, 2, "re-ingest must not duplicate archive_parts");
    }

    #[test]
    fn migrations_apply_download_columns_and_bump_version() {
        let conn = open(":memory:").unwrap();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION);
        conn.execute(
            "INSERT INTO archives (id, source_path, service, ingested_at) VALUES (1,'t','instagram',0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO saved_items (id, archive_id, url, caption, saved_at, download_status, local_path)
             VALUES (1,1,'u','c',0,'downloaded','col/abc.mp4')",
            [],
        )
        .unwrap();
        let (status, path): (String, String) = conn
            .query_row(
                "SELECT download_status, local_path FROM saved_items WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "downloaded");
        assert_eq!(path, "col/abc.mp4");
    }

    #[test]
    fn migration_0006_backfills_existing_archive_as_one_part() {
        // A pre-Phase-2 (v5) DB with one single-part archive must, after upgrade,
        // have exactly one archive_parts row pointing at its source_path — so the
        // multi-part media handler can rely solely on archive_parts.
        let dir = std::env::temp_dir().join(format!("demetafy_db_0006_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("idx.sqlite");
        let ps = p.to_str().unwrap();
        {
            let conn = Connection::open(ps).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            for m in [
                MIGRATION_0001,
                MIGRATION_0002,
                MIGRATION_0003,
                MIGRATION_0004,
                MIGRATION_0005,
            ] {
                conn.execute_batch(m).unwrap();
            }
            conn.execute(
                "INSERT INTO archives (id, source_path, service, ingested_at) VALUES (1,'legacy.zip','instagram',0)",
                [],
            )
            .unwrap();
            conn.execute_batch("PRAGMA user_version = 5;").unwrap();
        }
        let conn = open(ps).unwrap();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION, "open() should upgrade a v5 DB to the latest schema");
        let (idx, path): (i64, String) = conn
            .query_row(
                "SELECT idx, path FROM archive_parts WHERE archive_id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(idx, 0);
        assert_eq!(path, "legacy.zip", "0006 backfills the single source_path at idx 0");
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reopen_on_disk_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("demetafy_db_migrate_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("idx.sqlite");
        let ps = p.to_str().unwrap();
        {
            let _c = open(ps).unwrap();
        }
        // Re-open must not error — ADD COLUMN would fail if 0002 re-ran without the gate.
        let c2 = open(ps).unwrap();
        let v: i64 = c2
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION);
        drop(c2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn message_downloads_upsert_cascade_and_saved_thumb_path() {
        let conn = open(":memory:").unwrap();
        conn.execute(
            "INSERT INTO archives (id, source_path, service, ingested_at) VALUES (1,'t','instagram',0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO threads (id, archive_id, thread_path, source, slug) VALUES (1,1,'inbox/x','inbox','x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, thread_id, sender, timestamp_ms) VALUES (1,1,'me',1)",
            [],
        )
        .unwrap();

        let upsert = "INSERT INTO message_downloads (message_id, status, local_path, thumb_path)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(message_id) DO UPDATE SET
               status = excluded.status, local_path = excluded.local_path, thumb_path = excluded.thumb_path";
        conn.execute(upsert, params![1_i64, "downloaded", Some("_dm/abc.mp4"), Some("_dm/abc.jpg")])
            .unwrap();
        // Second call updates in place — no duplicate row, overwrites (incl. to NULL).
        conn.execute(
            upsert,
            params![1_i64, "error", Option::<String>::None, Option::<String>::None],
        )
        .unwrap();
        let (status, lp): (String, Option<String>) = conn
            .query_row(
                "SELECT status, local_path FROM message_downloads WHERE message_id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "error");
        assert!(lp.is_none());

        // ON DELETE CASCADE: removing the message clears its download row. (A real
        // re-ingest deletes+reinserts messages, but reset_archive salvages the outcome
        // first and re-applies it — see preserves_download_state_across_reingest; here
        // we exercise the raw cascade in isolation.)
        conn.execute("DELETE FROM messages WHERE id=1", []).unwrap();
        let n: i64 = conn
            .query_row("SELECT count(*) FROM message_downloads", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "ON DELETE CASCADE should clear message_downloads");

        // saved_items.thumb_path (migration 0003) round-trips.
        conn.execute(
            "INSERT INTO saved_items (id, archive_id, url, caption, saved_at, download_status, local_path, thumb_path)
             VALUES (1,1,'u','c',0,'downloaded','col/a.mp4','col/a.jpg')",
            [],
        )
        .unwrap();
        let tp: String = conn
            .query_row("SELECT thumb_path FROM saved_items WHERE id=1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tp, "col/a.jpg");
    }

    #[test]
    fn upgrades_existing_db_in_place() {
        // The existing on-disk index ships at user_version 2 (Step 13). Prove the
        // real migration runner upgrades it to the latest schema in place (applying
        // 0003 then 0004) — not via a fresh create — the path every existing user's
        // DB takes on boot.
        let dir = std::env::temp_dir().join(format!("demetafy_db_v2v3_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("idx.sqlite");
        let ps = p.to_str().unwrap();
        {
            let conn = Connection::open(ps).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            conn.execute_batch(MIGRATION_0001).unwrap();
            conn.execute_batch(MIGRATION_0002).unwrap();
            conn.execute_batch("PRAGMA user_version = 2;").unwrap();
        }
        let conn = open(ps).unwrap();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION, "open() should upgrade a v2 DB to the latest schema");
        // New table + column exist and are usable post-upgrade.
        conn.prepare("SELECT thumb_path FROM saved_items").unwrap();
        conn.prepare("SELECT username FROM connections").unwrap();
        // 0007: Facebook content tables + profile columns exist post-upgrade.
        conn.prepare("SELECT id FROM posts").unwrap();
        conn.prepare("SELECT id FROM albums").unwrap();
        conn.prepare("SELECT current_city, hometown, relationship_status FROM profile")
            .unwrap();
        conn.execute(
            "INSERT INTO archives (id, source_path, service, ingested_at) VALUES (1,'t','instagram',0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO threads (id, archive_id, thread_path, source, slug) VALUES (1,1,'inbox/x','inbox','x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, thread_id, sender, timestamp_ms) VALUES (1,1,'me',1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO message_downloads (message_id, status) VALUES (1,'downloaded')",
            [],
        )
        .unwrap();
        let n: i64 = conn
            .query_row("SELECT count(*) FROM message_downloads", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preserves_download_state_across_reingest() {
        let mut conn = open(":memory:").unwrap();

        // A saved post + a DM thread whose one message shares a reel permalink.
        let payload = IngestPayload {
            source_path: "same.zip".into(),
            service: "instagram".into(),
            part_paths: vec!["same.zip".into()],
            profile: None,
            profile_changes: vec![],
            saved_items: vec![SavedItemRow {
                url: "https://www.instagram.com/reel/DU12eQVEfLB/".into(),
                caption: "saved reel".into(),
                saved_at: 1000,
                collection_names: "[\"collector_us\"]".into(),
            }],
            saved_collections: vec![],
            threads: vec![ThreadRow {
                thread_path: "inbox/x".into(),
                source: "inbox".into(),
                slug: "x".into(),
                title: "X".into(),
                participants: "[]".into(),
                is_still_participant: true,
                messages: vec![MessageRow {
                    sender: "friend".into(),
                    timestamp_ms: 4242,
                    content: "check this".into(),
                    reactions: "[]".into(),
                    media: "{\"share\":{\"link\":\"https://www.instagram.com/reel/SHARED99/\"}}".into(),
                }],
            }],
            stories: vec![],
            reposts: vec![RepostRow {
                reposted_at: 2000,
                expires_at: None,
                user_text: "my take".into(),
                source_url: "https://www.instagram.com/p/REPOST7/".into(),
                source_caption: "orig caption".into(),
                source_title: "".into(),
                source_owner_name: Some("Owner".into()),
                source_owner_username: Some("owner".into()),
                fbid: None,
            }],
            own_posts: vec![],
            connections: vec![],
            posts: vec![],
            albums: vec![],
        };

        // First ingest, then simulate the user downloading the saved post, the DM-shared
        // reel, and the repost — i.e. what the three set_*_download_status commands persist.
        ingest_into(&mut conn, &payload).unwrap();
        conn.execute(
            "UPDATE saved_items SET download_status='downloaded',
               local_path='collector_us/DU12eQVEfLB.mp4', thumb_path='collector_us/DU12eQVEfLB.jpg'
             WHERE url='https://www.instagram.com/reel/DU12eQVEfLB/'",
            [],
        )
        .unwrap();
        let old_msg_id: i64 = conn
            .query_row(
                "SELECT id FROM messages WHERE json_extract(media,'$.share.link') IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        conn.execute(
            "INSERT INTO message_downloads (message_id, status, local_path, thumb_path)
             VALUES (?1,'downloaded','_dm/SHARED99.mp4','_dm/SHARED99.jpg')",
            params![old_msg_id],
        )
        .unwrap();
        conn.execute(
            "UPDATE reposts SET download_status='downloaded',
               local_path='_reposts/REPOST7.mp4', thumb_path='_reposts/REPOST7.jpg'
             WHERE source_url='https://www.instagram.com/p/REPOST7/'",
            [],
        )
        .unwrap();

        // Re-ingest the SAME archive (the Settings re-import path). Every row is
        // deleted+reinserted with a fresh AUTOINCREMENT id; the salvaged download
        // state must ride across to the new rows rather than reset to defaults.
        ingest_into(&mut conn, &payload).unwrap();

        let (status, lp, tp): (String, String, String) = conn
            .query_row(
                "SELECT download_status, local_path, thumb_path FROM saved_items
                 WHERE url='https://www.instagram.com/reel/DU12eQVEfLB/'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(status, "downloaded", "saved-post status must survive re-ingest");
        assert_eq!(lp, "collector_us/DU12eQVEfLB.mp4", "saved local_path preserved");
        assert_eq!(tp, "collector_us/DU12eQVEfLB.jpg", "saved thumb_path preserved");

        // The message id churned, so re-match the DM-share download by its share link.
        let new_msg_id: i64 = conn
            .query_row(
                "SELECT id FROM messages WHERE json_extract(media,'$.share.link') IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(new_msg_id, old_msg_id, "re-ingest should hand the message a new id");
        let (mstatus, mlp): (String, String) = conn
            .query_row(
                "SELECT d.status, d.local_path
                 FROM message_downloads d JOIN messages m ON m.id = d.message_id
                 WHERE json_extract(m.media,'$.share.link') = 'https://www.instagram.com/reel/SHARED99/'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(mstatus, "downloaded", "DM-share status must survive re-ingest");
        assert_eq!(mlp, "_dm/SHARED99.mp4", "DM-share local_path preserved");

        // …and the salvage didn't duplicate the sparse side-table row.
        let n: i64 = conn
            .query_row("SELECT count(*) FROM message_downloads", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "re-ingest must not duplicate message_downloads rows");

        // Reposts ride across re-ingest too (salvaged by source_url, inline columns).
        let (rstatus, rlp): (String, String) = conn
            .query_row(
                "SELECT download_status, local_path FROM reposts
                 WHERE source_url='https://www.instagram.com/p/REPOST7/'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(rstatus, "downloaded", "repost status must survive re-ingest");
        assert_eq!(rlp, "_reposts/REPOST7.mp4", "repost local_path preserved");
    }

    #[test]
    fn ingest_into_writes_facebook_content() {
        let mut conn = open(":memory:").unwrap();
        let payload = IngestPayload {
            // D3: a multi-part FB archive keys on the service-user-date group id, not a part path.
            source_path: "facebook-alex-2026".into(),
            service: "facebook".into(),
            part_paths: vec!["facebook-alex-2026-aa.zip".into(), "facebook-alex-2026-bb.zip".into()],
            profile: Some(ProfileRow {
                username: "".into(), // Facebook has no handle.
                display_name: "Alex Rivera".into(),
                email: Some("alex@example.com".into()),
                phone: None,
                gender: Some("MALE".into()),
                date_of_birth: Some("1990-01-01".into()),
                is_private: false,
                country_code: None,
                fbid: None,
                profile_photo_uri: None,
                profile_photo_taken_at: None,
                first_story_at: None,
                last_story_at: None,
                last_login_at: None,
                last_logout_at: None,
                has_archived_reels: None,
                current_city: Some("Paris".into()),
                hometown: Some("Lyon".into()),
                relationship_status: Some("Célibataire".into()),
            }),
            // previous_names → profile_changes (field="name").
            profile_changes: vec![ProfileChangeRow {
                field: "name".into(),
                previous_value: None,
                new_value: Some("Alex S.".into()),
                changed_at: 1000,
            }],
            saved_items: vec![],
            saved_collections: vec![],
            threads: vec![ThreadRow {
                thread_path: "messages/e2ee_cutover/42".into(),
                source: "e2ee_cutover".into(), // FB-only category folds in as plaintext.
                slug: "42".into(),
                title: "Crew".into(),
                participants: "[]".into(),
                is_still_participant: true,
                messages: vec![MessageRow {
                    sender: "Alex".into(),
                    timestamp_ms: 5,
                    content: "salut".into(),
                    reactions: "[]".into(),
                    media: "{}".into(),
                }],
            }],
            stories: vec![],
            reposts: vec![],
            own_posts: vec![],
            // FB connections carry name (in username) + no href.
            connections: vec![ConnectionRow {
                kind: "friends".into(),
                username: "Marie Curie".into(),
                href: "".into(),
                followed_at: 2000,
            }],
            posts: vec![PostRow {
                created_at: 7000,
                text: "mon premier post".into(),
                title: "Alex a partagé un lien.".into(),
                media: "[{\"uri\":\"posts/media/a.jpg\",\"createdAt\":7000}]".into(),
                links: "[\"https://example.com\"]".into(),
            }],
            albums: vec![AlbumRow {
                name: "Vacances".into(),
                description: Some("été 2024".into()),
                cover_photo_uri: Some("posts/media/cover.jpg".into()),
                last_modified: 9000,
                photo_count: 2,
                photos: "[{\"uri\":\"posts/media/1.jpg\",\"createdAt\":8000}]".into(),
            }],
        };

        let counts = ingest_into(&mut conn, &payload).unwrap();
        assert_eq!(counts.posts, 1);
        assert_eq!(counts.albums, 1);
        assert_eq!(counts.threads, 1);
        assert_eq!(counts.connections, 1);
        assert_eq!(counts.profile_changes, 1);

        // Facebook-only profile columns round-trip.
        let (city, hometown, rel): (String, String, String) = conn
            .query_row(
                "SELECT current_city, hometown, relationship_status FROM profile",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(city, "Paris");
        assert_eq!(hometown, "Lyon");
        assert_eq!(rel, "Célibataire");

        // Post text/media JSON stored verbatim.
        let (text, media): (String, String) = conn
            .query_row("SELECT text, media FROM posts", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(text, "mon premier post");
        assert!(media.contains("posts/media/a.jpg"));

        // Album metadata + JSON photos.
        let (name, pc): (String, i64) = conn
            .query_row("SELECT name, photo_count FROM albums", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(name, "Vacances");
        assert_eq!(pc, 2);

        // FB connection: name in username, empty href (no profile link to render).
        let (uname, href): (String, String) = conn
            .query_row("SELECT username, href FROM connections", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(uname, "Marie Curie");
        assert_eq!(href, "");

        // Re-ingest the same logical archive (group id) is idempotent — posts/albums
        // are in reset_archive's delete loop, so counts stay flat (no duplication).
        let counts2 = ingest_into(&mut conn, &payload).unwrap();
        assert_eq!(counts2, counts, "re-ingest must not duplicate FB content");
    }

    #[test]
    fn archive_scoped_queries_isolate_each_account() {
        // A minimal all-empty payload; each test case fills only what it asserts on.
        fn base(source_path: &str, service: &str) -> IngestPayload {
            IngestPayload {
                source_path: source_path.into(),
                service: service.into(),
                part_paths: vec![],
                profile: None,
                profile_changes: vec![],
                saved_items: vec![],
                saved_collections: vec![],
                threads: vec![],
                stories: vec![],
                reposts: vec![],
                own_posts: vec![],
                connections: vec![],
                posts: vec![],
                albums: vec![],
            }
        }
        fn profile_named(username: &str, display: &str) -> ProfileRow {
            ProfileRow {
                username: username.into(),
                display_name: display.into(),
                email: None,
                phone: None,
                gender: None,
                date_of_birth: None,
                is_private: false,
                country_code: None,
                fbid: None,
                profile_photo_uri: None,
                profile_photo_taken_at: None,
                first_story_at: None,
                last_story_at: None,
                last_login_at: None,
                last_logout_at: None,
                has_archived_reels: None,
                current_city: None,
                hometown: None,
                relationship_status: None,
            }
        }
        fn one_thread(slug: &str, sender: &str) -> ThreadRow {
            ThreadRow {
                thread_path: format!("inbox/{slug}"),
                source: "inbox".into(),
                slug: slug.into(),
                title: "T".into(),
                participants: "[]".into(),
                is_still_participant: true,
                messages: vec![MessageRow {
                    sender: sender.into(),
                    timestamp_ms: 1,
                    content: "hi".into(),
                    reactions: "[]".into(),
                    media: r#"{"share":{"link":"https://www.instagram.com/reel/X/"}}"#.into(),
                }],
            }
        }

        let mut conn = open(":memory:").unwrap();

        let mut ig = base("ig.zip", "instagram");
        ig.profile = Some(profile_named("example_user", "Example"));
        ig.saved_items = vec![SavedItemRow {
            url: "u".into(),
            caption: "c".into(),
            saved_at: 1,
            collection_names: "[]".into(),
        }];
        ig.threads = vec![one_thread("ig-a", "Example")];
        ig.connections = vec![ConnectionRow {
            kind: "following".into(),
            username: "alice".into(),
            href: "h".into(),
            followed_at: 1,
        }];
        ingest_into(&mut conn, &ig).unwrap();

        let mut fb = base("facebook-alex-2026", "facebook");
        fb.profile = Some(profile_named("", "Alex Rivera"));
        fb.threads = vec![one_thread("fb-9", "Alex")];
        fb.connections = vec![ConnectionRow {
            kind: "friends".into(),
            username: "Marie".into(),
            href: "".into(),
            followed_at: 2,
        }];
        fb.posts = vec![PostRow {
            created_at: 1,
            text: "p".into(),
            title: "".into(),
            media: "[]".into(),
            links: "[]".into(),
        }];
        fb.albums = vec![AlbumRow {
            name: "Vac".into(),
            description: None,
            cover_photo_uri: None,
            last_modified: 0,
            photo_count: 0,
            photos: "[]".into(),
        }];
        ingest_into(&mut conn, &fb).unwrap();

        let ig_id: i64 = conn
            .query_row("SELECT id FROM archives WHERE service = 'instagram'", [], |r| r.get(0))
            .unwrap();
        let fb_id: i64 = conn
            .query_row("SELECT id FROM archives WHERE service = 'facebook'", [], |r| r.get(0))
            .unwrap();

        // archives_list(): both present, most-recently-ingested (FB) first.
        let list = archives_list(&conn).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].service, "facebook");
        assert_eq!(list[1].service, "instagram");

        // Overview scoped per account; `archives` stays a global count.
        let ig_ov = overview(&conn, Some(ig_id)).unwrap();
        assert_eq!((ig_ov.saved_items, ig_ov.posts, ig_ov.albums, ig_ov.threads), (1, 0, 0, 1));
        assert_eq!(ig_ov.archives, 2, "archives count is global, not per-account");
        let fb_ov = overview(&conn, Some(fb_id)).unwrap();
        assert_eq!((fb_ov.saved_items, fb_ov.posts, fb_ov.albums, fb_ov.threads), (0, 1, 1, 1));
        let all_ov = overview(&conn, None).unwrap();
        assert_eq!((all_ov.threads, all_ov.saved_items, all_ov.posts), (2, 1, 1));

        // Profile / threads / connections / self_sender resolve to the active account.
        assert_eq!(profile(&conn, Some(ig_id)).unwrap().unwrap().username, "example_user");
        assert_eq!(
            profile(&conn, Some(fb_id)).unwrap().unwrap().display_name,
            "Alex Rivera"
        );
        assert_eq!(threads(&conn, Some(ig_id)).unwrap()[0].slug, "ig-a");
        assert_eq!(threads(&conn, Some(fb_id)).unwrap()[0].slug, "fb-9");
        assert_eq!(connections(&conn, Some(fb_id)).unwrap()[0].username, "Marie");
        assert_eq!(self_sender(&conn, Some(ig_id)).unwrap().as_deref(), Some("Example"));
        assert_eq!(self_sender(&conn, Some(fb_id)).unwrap().as_deref(), Some("Alex"));

        // thread_detail is archive-scoped: an IG slug won't resolve under the FB account.
        assert!(thread_detail(&conn, "ig-a", Some(fb_id)).unwrap().thread.is_none());
        assert!(thread_detail(&conn, "ig-a", Some(ig_id)).unwrap().thread.is_some());

        // Download-stats queries scope by account too: shares by the message's
        // thread's archive, saved by archive. Each thread carries one share link;
        // only IG has a saved item.
        assert_eq!(share_rows(&conn, None).unwrap().len(), 2);
        assert_eq!(share_rows(&conn, Some(ig_id)).unwrap().len(), 1);
        assert_eq!(share_rows(&conn, Some(fb_id)).unwrap().len(), 1);
        assert_eq!(saved_download_stats(&conn, None).unwrap().total, 1);
        assert_eq!(saved_download_stats(&conn, Some(ig_id)).unwrap().total, 1);
        assert_eq!(saved_download_stats(&conn, Some(fb_id)).unwrap().total, 0);
    }

    #[test]
    fn two_instagram_imports_stay_isolated_and_deletable() {
        // The regression this feature fixes: before per-archive scoping, two
        // Instagram archives merged under service='instagram'. Each import must now
        // be a separate, independently-removable account.
        let mut conn = open(":memory:").unwrap();
        let mk = |source: &str, username: &str, saved_url: &str, slug: &str| IngestPayload {
            source_path: source.into(),
            service: "instagram".into(),
            part_paths: vec![source.into()],
            profile: Some(ProfileRow {
                username: username.into(),
                display_name: username.into(),
                email: None,
                phone: None,
                gender: None,
                date_of_birth: None,
                is_private: false,
                country_code: None,
                fbid: None,
                profile_photo_uri: None,
                profile_photo_taken_at: None,
                first_story_at: None,
                last_story_at: None,
                last_login_at: None,
                last_logout_at: None,
                has_archived_reels: None,
                current_city: None,
                hometown: None,
                relationship_status: None,
            }),
            profile_changes: vec![],
            saved_items: vec![SavedItemRow {
                url: saved_url.into(),
                caption: "c".into(),
                saved_at: 1,
                collection_names: "[]".into(),
            }],
            saved_collections: vec![],
            threads: vec![ThreadRow {
                thread_path: format!("inbox/{slug}"),
                source: "inbox".into(),
                slug: slug.into(),
                title: "T".into(),
                participants: "[]".into(),
                is_still_participant: true,
                messages: vec![MessageRow {
                    sender: username.into(),
                    timestamp_ms: 1,
                    content: "hi".into(),
                    reactions: "[]".into(),
                    media: "{}".into(),
                }],
            }],
            stories: vec![],
            reposts: vec![],
            own_posts: vec![],
            connections: vec![],
            posts: vec![],
            albums: vec![],
        };

        ingest_into(&mut conn, &mk("personal.zip", "personal_user", "https://insta/p/1", "t-a"))
            .unwrap();
        ingest_into(&mut conn, &mk("finsta.zip", "finsta_user", "https://insta/p/2", "t-b"))
            .unwrap();

        let list = archives_list(&conn).unwrap();
        assert_eq!(list.len(), 2, "two separate Instagram imports coexist");
        let personal = list
            .iter()
            .find(|a| a.username.as_deref() == Some("personal_user"))
            .unwrap()
            .id;
        let finsta = list
            .iter()
            .find(|a| a.username.as_deref() == Some("finsta_user"))
            .unwrap()
            .id;

        // Content is isolated per account — no merge across the two IG imports.
        let personal_saved = saved_items(&conn, Some(personal), None).unwrap();
        assert_eq!(personal_saved.len(), 1);
        assert_eq!(personal_saved[0].url, "https://insta/p/1");
        assert_eq!(saved_items(&conn, Some(finsta), None).unwrap()[0].url, "https://insta/p/2");
        assert_eq!(threads(&conn, Some(personal)).unwrap()[0].slug, "t-a");
        assert_eq!(threads(&conn, Some(finsta)).unwrap()[0].slug, "t-b");
        assert_eq!(profile(&conn, Some(personal)).unwrap().unwrap().username, "personal_user");
        // Unscoped still sees both (the global/merged view).
        assert_eq!(saved_items(&conn, None, None).unwrap().len(), 2);

        // delete_archive removes only its import; the other survives intact, FTS too.
        delete_archive_rows(&conn, personal).unwrap();
        let after = archives_list(&conn).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].id, finsta);
        assert!(saved_items(&conn, Some(personal), None).unwrap().is_empty());
        assert_eq!(saved_items(&conn, Some(finsta), None).unwrap().len(), 1);
        assert!(threads(&conn, Some(personal)).unwrap().is_empty());
        assert!(search(&conn, "hi", Some(personal)).unwrap().is_empty());
        assert_eq!(search(&conn, "hi", Some(finsta)).unwrap().len(), 1);
    }

    // ── typed read commands (replaced db_select; closes C3) ───────────────────

    #[test]
    fn query_overview_counts_each_table() {
        let conn = open(":memory:").unwrap();
        conn.execute(
            "INSERT INTO archives (id, source_path, service, ingested_at) VALUES (1,'t','instagram',0)",
            [],
        )
        .unwrap();
        // Distinct per-table counts so a mis-mapped subquery→field would fail.
        for i in 0..2 {
            conn.execute(
                "INSERT INTO saved_items (archive_id, url, saved_at) VALUES (1, ?1, 0)",
                params![format!("u{i}")],
            )
            .unwrap();
        }
        for i in 0..3 {
            conn.execute(
                "INSERT INTO saved_collections (archive_id, name) VALUES (1, ?1)",
                params![format!("c{i}")],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO threads (id, archive_id, thread_path, source, slug) VALUES (1,1,'inbox/x','inbox','x')",
            [],
        )
        .unwrap();
        for i in 0..4 {
            conn.execute(
                "INSERT INTO messages (thread_id, sender, timestamp_ms) VALUES (1,'me', ?1)",
                params![i as i64],
            )
            .unwrap();
        }
        for i in 0..5 {
            conn.execute(
                "INSERT INTO stories (archive_id, uri, created_at) VALUES (1, ?1, 0)",
                params![format!("s{i}")],
            )
            .unwrap();
        }
        for i in 0..6 {
            conn.execute(
                "INSERT INTO reposts (archive_id, reposted_at, source_url) VALUES (1, 0, ?1)",
                params![format!("r{i}")],
            )
            .unwrap();
        }
        for i in 0..7 {
            conn.execute(
                "INSERT INTO own_posts (archive_id, uri, media_id) VALUES (1, ?1, ?1)",
                params![format!("o{i}")],
            )
            .unwrap();
        }

        let ov = overview(&conn, None).unwrap();
        assert_eq!(ov.archives, 1);
        assert_eq!(ov.saved_items, 2);
        assert_eq!(ov.collections, 3);
        assert_eq!(ov.threads, 1);
        assert_eq!(ov.messages, 4);
        assert_eq!(ov.stories, 5);
        assert_eq!(ov.reposts, 6);
        assert_eq!(ov.own_posts, 7);
    }

    #[test]
    fn query_saved_items_filters_by_collection_newest_first() {
        let conn = open(":memory:").unwrap();
        conn.execute(
            "INSERT INTO archives (id, source_path, service, ingested_at) VALUES (1,'t','instagram',0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO saved_items (archive_id, url, caption, saved_at, collection_names)
             VALUES (1,'u1','c1',10,'[\"travel\"]')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO saved_items (archive_id, url, caption, saved_at, collection_names)
             VALUES (1,'u2','c2',20,'[\"food\"]')",
            [],
        )
        .unwrap();

        let all = saved_items(&conn, None, None).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].url, "u2", "saved_at DESC → newest first");
        assert_eq!(all[0].download_status, "none", "default status surfaces");
        assert!(all[0].local_path.is_none());

        let travel = saved_items(&conn, None, Some("travel")).unwrap();
        assert_eq!(travel.len(), 1, "json_each collection filter");
        assert_eq!(travel[0].url, "u1");
    }

    #[test]
    fn query_thread_detail_joins_download_status_and_orders_asc() {
        let conn = open(":memory:").unwrap();
        conn.execute(
            "INSERT INTO archives (id, source_path, service, ingested_at) VALUES (1,'t','instagram',0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO threads (id, archive_id, thread_path, source, slug, title) VALUES (1,1,'inbox/x','inbox','x','X')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, thread_id, sender, timestamp_ms, content) VALUES (1,1,'me',1,'hi')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, thread_id, sender, timestamp_ms, content) VALUES (2,1,'you',2,'yo')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO message_downloads (message_id, status, local_path) VALUES (1,'downloaded','_dm/a.mp4')",
            [],
        )
        .unwrap();

        let detail = thread_detail(&conn, "x", None).unwrap();
        let t = detail.thread.expect("thread found by slug");
        assert_eq!(t.slug, "x");
        assert_eq!(detail.messages.len(), 2);
        // timestamp_ms ASC → msg 1 first; LEFT JOIN brings its download row.
        assert_eq!(detail.messages[0].download_status, "downloaded");
        assert_eq!(detail.messages[0].local_path.as_deref(), Some("_dm/a.mp4"));
        // msg 2 has no download row → COALESCE default.
        assert_eq!(detail.messages[1].download_status, "none");
        assert!(detail.messages[1].local_path.is_none());

        // Unknown slug → thread None (TS returns null), no messages.
        let missing = thread_detail(&conn, "nope", None).unwrap();
        assert!(missing.thread.is_none());
        assert!(missing.messages.is_empty());
    }

    #[test]
    fn query_share_rows_extracts_only_share_links() {
        let conn = open(":memory:").unwrap();
        conn.execute(
            "INSERT INTO archives (id, source_path, service, ingested_at) VALUES (1,'t','instagram',0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO threads (id, archive_id, thread_path, source, slug) VALUES (1,1,'inbox/x','inbox','x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, thread_id, sender, timestamp_ms, media)
             VALUES (1,1,'me',1,'{\"share\":{\"link\":\"https://www.instagram.com/reel/A/\"}}')",
            [],
        )
        .unwrap();
        // No share link → excluded by WHERE json_extract(...) IS NOT NULL.
        conn.execute(
            "INSERT INTO messages (id, thread_id, sender, timestamp_ms, media) VALUES (2,1,'me',2,'{}')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO message_downloads (message_id, status) VALUES (1,'downloaded')",
            [],
        )
        .unwrap();

        let rows = share_rows(&conn, None).unwrap();
        assert_eq!(rows.len(), 1, "only the message carrying a share link");
        assert_eq!(rows[0].id, 1);
        assert_eq!(
            rows[0].link.as_deref(),
            Some("https://www.instagram.com/reel/A/")
        );
        assert_eq!(rows[0].status, "downloaded");
    }
}
