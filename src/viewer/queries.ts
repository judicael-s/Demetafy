import type { DatabaseSync } from 'node:sqlite';

export interface OverviewData {
  archives: Array<{ id: number; sourcePath: string; service: string; ingestedAt: Date }>;
  profile: ProfileRow | null;
  counts: Record<string, number>;
}

export interface ProfileRow {
  username: string;
  displayName: string;
  email: string | null;
  countryCode: string | null;
  fbid: string | null;
  isPrivate: boolean;
  firstStoryAt: Date | null;
  lastStoryAt: Date | null;
  lastLoginAt: Date | null;
}

export function getOverview(db: DatabaseSync): OverviewData {
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

  const profileRow = db
    .prepare(
      `SELECT username, display_name, email, country_code, fbid, is_private,
              first_story_at, last_story_at, last_login_at
       FROM profile LIMIT 1`,
    )
    .get() as
    | {
        username: string;
        display_name: string;
        email: string | null;
        country_code: string | null;
        fbid: string | null;
        is_private: number;
        first_story_at: number | null;
        last_story_at: number | null;
        last_login_at: number | null;
      }
    | undefined;

  const profile: ProfileRow | null = profileRow
    ? {
        username: profileRow.username,
        displayName: profileRow.display_name,
        email: profileRow.email,
        countryCode: profileRow.country_code,
        fbid: profileRow.fbid,
        isPrivate: profileRow.is_private === 1,
        firstStoryAt: profileRow.first_story_at ? new Date(profileRow.first_story_at) : null,
        lastStoryAt: profileRow.last_story_at ? new Date(profileRow.last_story_at) : null,
        lastLoginAt: profileRow.last_login_at ? new Date(profileRow.last_login_at) : null,
      }
    : null;

  const tables = [
    'saved_items',
    'saved_collections',
    'threads',
    'messages',
    'stories',
    'reposts',
    'own_posts',
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    counts[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  }

  return { archives, profile, counts };
}

export interface SavedItemRow {
  id: number;
  url: string;
  caption: string;
  savedAt: Date;
  collections: string[];
}

export function getSavedItems(
  db: DatabaseSync,
  opts: { limit: number; offset: number; collection?: string },
): { items: SavedItemRow[]; total: number } {
  let where = '';
  const params: Array<string | number> = [];
  if (opts.collection) {
    // collection_names is a JSON array; do a LIKE match on the JSON text.
    where = `WHERE collection_names LIKE ?`;
    params.push(`%"${opts.collection.replace(/"/g, '')}"%`);
  }

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM saved_items ${where}`).get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT id, url, caption, saved_at, collection_names
       FROM saved_items ${where}
       ORDER BY saved_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.limit, opts.offset) as Array<{
    id: number;
    url: string;
    caption: string;
    saved_at: number;
    collection_names: string;
  }>;

  const items = rows.map(
    (r): SavedItemRow => ({
      id: r.id,
      url: r.url,
      caption: r.caption,
      savedAt: new Date(r.saved_at),
      collections: JSON.parse(r.collection_names) as string[],
    }),
  );

  return { items, total };
}

export interface CollectionRow {
  id: number;
  name: string;
  type: string | null;
  privacy: string | null;
  itemCount: number;
}

export function getCollections(db: DatabaseSync): CollectionRow[] {
  return (
    db
      .prepare(
        `SELECT id, name, type, privacy, item_count
         FROM saved_collections ORDER BY item_count DESC`,
      )
      .all() as Array<{
      id: number;
      name: string;
      type: string | null;
      privacy: string | null;
      item_count: number;
    }>
  ).map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    privacy: r.privacy,
    itemCount: r.item_count,
  }));
}

export interface ThreadSummary {
  id: number;
  slug: string;
  source: string;
  title: string;
  participants: string[];
  messageCount: number;
  lastMessageAt: Date | null;
}

export function getThreads(
  db: DatabaseSync,
  opts: { limit: number; offset: number; source?: string },
): { threads: ThreadSummary[]; total: number } {
  let where = '';
  const params: Array<string | number> = [];
  if (opts.source) {
    where = 'WHERE source = ?';
    params.push(opts.source);
  }

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM threads ${where}`).get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT id, slug, source, title, participants, message_count, last_message_at
       FROM threads ${where}
       ORDER BY COALESCE(last_message_at, 0) DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.limit, opts.offset) as Array<{
    id: number;
    slug: string;
    source: string;
    title: string;
    participants: string;
    message_count: number;
    last_message_at: number | null;
  }>;

  const threads = rows.map(
    (r): ThreadSummary => ({
      id: r.id,
      slug: r.slug,
      source: r.source,
      title: r.title,
      participants: JSON.parse(r.participants) as string[],
      messageCount: r.message_count,
      lastMessageAt: r.last_message_at ? new Date(r.last_message_at) : null,
    }),
  );

  return { threads, total };
}

export interface ThreadDetail {
  thread: ThreadSummary;
  messages: Array<{
    sender: string;
    timestampMs: number;
    content: string;
    reactions: Array<{ reaction: string; actor: string }>;
    media: { audio: string[]; photos: string[]; videos: string[]; gifs: string[] };
  }>;
}

export function getThreadBySlug(db: DatabaseSync, slug: string): ThreadDetail | null {
  const row = db
    .prepare(
      `SELECT id, slug, source, title, participants, message_count, last_message_at
       FROM threads WHERE slug = ? LIMIT 1`,
    )
    .get(slug) as
    | {
        id: number;
        slug: string;
        source: string;
        title: string;
        participants: string;
        message_count: number;
        last_message_at: number | null;
      }
    | undefined;
  if (!row) return null;

  const thread: ThreadSummary = {
    id: row.id,
    slug: row.slug,
    source: row.source,
    title: row.title,
    participants: JSON.parse(row.participants) as string[],
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
  };

  const msgs = db
    .prepare(
      `SELECT sender, timestamp_ms, content, reactions, media
       FROM messages WHERE thread_id = ? ORDER BY timestamp_ms ASC`,
    )
    .all(row.id) as Array<{
    sender: string;
    timestamp_ms: number;
    content: string;
    reactions: string;
    media: string;
  }>;

  return {
    thread,
    messages: msgs.map((m) => {
      const media = JSON.parse(m.media) as {
        audio?: Array<{ uri: string }>;
        photos?: Array<{ uri: string }>;
        videos?: Array<{ uri: string }>;
        gifs?: Array<{ uri: string }>;
      };
      return {
        sender: m.sender,
        timestampMs: m.timestamp_ms,
        content: m.content,
        reactions: JSON.parse(m.reactions) as Array<{ reaction: string; actor: string }>,
        media: {
          audio: (media.audio ?? []).map((a) => a.uri),
          photos: (media.photos ?? []).map((p) => p.uri),
          videos: (media.videos ?? []).map((v) => v.uri),
          gifs: (media.gifs ?? []).map((g) => g.uri),
        },
      };
    }),
  };
}

export function getStories(db: DatabaseSync): Array<{
  uri: string;
  createdAt: Date;
  title: string;
  sourceApp: string | null;
}> {
  return (
    db
      .prepare(`SELECT uri, created_at, title, source_app FROM stories ORDER BY created_at DESC`)
      .all() as Array<{
      uri: string;
      created_at: number;
      title: string;
      source_app: string | null;
    }>
  ).map((r) => ({
    uri: r.uri,
    createdAt: new Date(r.created_at),
    title: r.title,
    sourceApp: r.source_app,
  }));
}

export function getReposts(db: DatabaseSync): Array<{
  repostedAt: Date;
  userText: string;
  source: { url: string; caption: string; ownerUsername: string; ownerName: string };
}> {
  return (
    db
      .prepare(
        `SELECT reposted_at, user_text, source_url, source_caption,
                source_owner_name, source_owner_username
         FROM reposts ORDER BY reposted_at DESC`,
      )
      .all() as Array<{
      reposted_at: number;
      user_text: string;
      source_url: string;
      source_caption: string;
      source_owner_name: string;
      source_owner_username: string;
    }>
  ).map((r) => ({
    repostedAt: new Date(r.reposted_at),
    userText: r.user_text,
    source: {
      url: r.source_url,
      caption: r.source_caption,
      ownerName: r.source_owner_name,
      ownerUsername: r.source_owner_username,
    },
  }));
}

export function getOwnPosts(db: DatabaseSync): Array<{
  uri: string;
  mediaId: string;
  ext: string;
  sizeBytes: number;
}> {
  return (
    db
      .prepare(`SELECT uri, media_id, ext, size_bytes FROM own_posts ORDER BY media_id`)
      .all() as Array<{ uri: string; media_id: string; ext: string; size_bytes: number }>
  ).map((r) => ({
    uri: r.uri,
    mediaId: r.media_id,
    ext: r.ext,
    sizeBytes: r.size_bytes,
  }));
}
