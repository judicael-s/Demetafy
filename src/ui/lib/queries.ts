import { invoke } from "@tauri-apps/api/core";
import { DM_SLUG, type EnqueueInput } from "./download-queue";
import { sanitizeSlug } from "./download-ui";
import { isDownloadableShare } from "./links";

// Reads go through fixed, typed Rust commands (src-tauri/src/db.rs query_*),
// NOT a generic SQL endpoint — the WebView can't run arbitrary SQL (security
// finding C3). Each command returns rows whose snake_case fields match the
// columns these mappers already read, so the parse/shape logic below is
// unchanged from when this layer called db_select.

/** Per-content-type row counts for the dashboard + empty-state gate. When an
 *  `archiveId` is passed the content counts are scoped to that import (`archives`
 *  stays a global total — it only gates "has anything been imported"). */
export interface Overview {
  archives: number;
  savedItems: number;
  collections: number;
  threads: number;
  messages: number;
  stories: number;
  reposts: number;
  ownPosts: number;
  posts: number;
  albums: number;
}

export interface ProfileRow {
  username: string;
  display_name: string;
  profile_photo_uri: string | null;
  is_private: number;
  country_code: string | null;
  fbid: string | null;
  email: string | null;
  phone: string | null;
  gender: string | null;
  date_of_birth: string | null;
  last_login_at: number | null;
}

/** One imported archive as a selectable account. `username`/`displayName` come
 *  from the joined profile (null when an archive has no profile row). */
export interface ArchiveAccount {
  id: number;
  service: string;
  sourcePath: string;
  ingestedAt: number;
  username: string | null;
  displayName: string | null;
}

export async function fetchOverview(archiveId?: number): Promise<Overview> {
  const r = await invoke<{
    archives: number;
    saved_items: number;
    collections: number;
    threads: number;
    messages: number;
    stories: number;
    reposts: number;
    own_posts: number;
    posts: number;
    albums: number;
  }>("query_overview", { archiveId: archiveId ?? null });
  return {
    archives: r.archives,
    savedItems: r.saved_items,
    collections: r.collections,
    threads: r.threads,
    messages: r.messages,
    stories: r.stories,
    reposts: r.reposts,
    ownPosts: r.own_posts,
    posts: r.posts,
    albums: r.albums,
  };
}

export async function fetchProfile(archiveId?: number): Promise<ProfileRow | null> {
  return await invoke<ProfileRow | null>("query_profile", { archiveId: archiveId ?? null });
}

/** A full-text hit from `query_search`. `kind` drives the label + routing; for
 *  messages `slug` deep-links the thread and `participants` (a JSON name array)
 *  lets the UI derive a title when `title` is empty. Fields are single-word so the
 *  Rust snake_case names already match. */
export interface SearchResult {
  kind: "saved" | "message" | "repost";
  title: string;
  participants: string;
  snippet: string;
  slug: string | null;
  timestamp: number | null;
}

export async function fetchSearch(query: string, archiveId?: number): Promise<SearchResult[]> {
  return await invoke<SearchResult[]>("query_search", { query, archiveId: archiveId ?? null });
}

export interface SavedItem {
  id: number;
  url: string;
  caption: string;
  savedAt: number;
  collections: string[];
  /** Persisted download outcome: 'none' | 'downloaded' | 'login_walled' | 'dead' | 'error'. */
  downloadStatus: string;
  /** Path relative to the downloads root when downloaded; null otherwise. */
  localPath: string | null;
  /** Poster path relative to the downloads root (yt-dlp thumbnail); null otherwise. */
  thumbPath: string | null;
}

export interface CollectionCount {
  name: string;
  itemCount: number;
}

interface SavedItemRaw {
  id: number;
  url: string;
  caption: string;
  saved_at: number;
  collection_names: string;
  download_status: string;
  local_path: string | null;
  thumb_path: string | null;
}

function parseSavedRow(r: SavedItemRaw): SavedItem {
  let collections: string[] = [];
  try {
    const parsed = JSON.parse(r.collection_names);
    if (Array.isArray(parsed)) collections = parsed as string[];
  } catch {
    /* leave empty on malformed JSON */
  }
  return {
    id: r.id,
    url: r.url,
    caption: r.caption,
    savedAt: r.saved_at,
    collections,
    downloadStatus: r.download_status,
    localPath: r.local_path,
    thumbPath: r.thumb_path,
  };
}

/** All saved items for one import, newest first; optionally filtered to one
 *  collection (by name). */
export async function fetchSavedItems(
  archiveId?: number,
  collection?: string,
): Promise<SavedItem[]> {
  const rows = await invoke<SavedItemRaw[]>("query_saved_items", {
    archiveId: archiveId ?? null,
    collection: collection ?? null,
  });
  return rows.map(parseSavedRow);
}

/** Collections with their item counts for one import, largest first. */
export async function fetchCollections(archiveId?: number): Promise<CollectionCount[]> {
  const rows = await invoke<{ name: string; item_count: number }[]>("query_collections", {
    archiveId: archiveId ?? null,
  });
  return rows.map((r) => ({ name: r.name, itemCount: r.item_count }));
}

/** Every imported archive (account), most-recently-imported first. Drives the
 *  account switcher and the Settings list; the active one's `id` scopes content. */
export async function fetchArchives(): Promise<ArchiveAccount[]> {
  const rows = await invoke<{
    id: number;
    service: string;
    source_path: string;
    ingested_at: number;
    username: string | null;
    display_name: string | null;
  }[]>("query_archives");
  return rows.map((r) => ({
    id: r.id,
    service: r.service,
    sourcePath: r.source_path,
    ingestedAt: r.ingested_at,
    username: r.username,
    displayName: r.display_name,
  }));
}

/** Remove one imported archive (account) and all its content from the index. */
export async function deleteArchive(id: number): Promise<void> {
  await invoke("delete_archive", { archiveId: id });
}

// --- Messages (Step 11) -----------------------------------------------------

export interface ThreadSummary {
  id: number;
  slug: string;
  /** Category folder the thread came from. IG: inbox | message_requests |
   *  broadcast. FB adds archived_threads | filtered_threads | e2ee_cutover. */
  source: string;
  title: string;
  participants: string[];
  messageCount: number;
  lastMessageAt: number | null;
  /** Content of the most recent message (may be ""), for the inbox preview. */
  lastPreview: string;
  lastSender: string;
}

interface ThreadSummaryRaw {
  id: number;
  slug: string;
  source: string;
  title: string;
  participants: string;
  message_count: number;
  last_message_at: number | null;
  last_preview: string | null;
  last_sender: string | null;
}

function safeStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    /* leave empty on malformed JSON */
  }
  return [];
}

function toThreadSummary(r: ThreadSummaryRaw): ThreadSummary {
  return {
    id: r.id,
    slug: r.slug,
    source: r.source,
    title: r.title,
    participants: safeStringArray(r.participants),
    messageCount: r.message_count,
    lastMessageAt: r.last_message_at,
    lastPreview: r.last_preview ?? "",
    lastSender: r.last_sender ?? "",
  };
}

/**
 * All threads with their last-message preview, newest activity first. The two
 * correlated subqueries each hit idx_messages_thread; across 549 threads /
 * 24,802 messages this is a single fast round-trip (the inbox filters/sorts
 * client-side, so we fetch once).
 */
export async function fetchThreads(archiveId?: number): Promise<ThreadSummary[]> {
  const rows = await invoke<ThreadSummaryRaw[]>("query_threads", { archiveId: archiveId ?? null });
  return rows.map(toThreadSummary);
}

export interface MsgReaction {
  reaction: string;
  actor: string;
}

export interface MsgShare {
  link?: string;
  shareText?: string;
}

export interface MsgMedia {
  audio: string[];
  photos: string[];
  videos: string[];
  gifs: string[];
  share: MsgShare | null;
}

export interface ThreadMessage {
  id: number;
  sender: string;
  timestampMs: number;
  content: string;
  reactions: MsgReaction[];
  media: MsgMedia;
  /** Download outcome for a post/reel shared in this message (WS-C). 'none' when
   *  never attempted or the message carries no downloadable share. */
  downloadStatus: string;
  localPath: string | null;
  thumbPath: string | null;
}

export interface ThreadDetail {
  thread: ThreadSummary;
  messages: ThreadMessage[];
}

interface MessageRaw {
  id: number;
  sender: string;
  timestamp_ms: number;
  content: string;
  reactions: string;
  media: string;
  download_status: string;
  local_path: string | null;
  thumb_path: string | null;
}

const EMPTY_MEDIA: MsgMedia = { audio: [], photos: [], videos: [], gifs: [], share: null };

function parseReactions(json: string): MsgReaction[] {
  try {
    const parsed = JSON.parse(json) as Array<{ reaction?: string; actor?: string }>;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((r) => typeof r.reaction === "string" && typeof r.actor === "string")
        .map((r) => ({ reaction: r.reaction!, actor: r.actor! }));
    }
  } catch {
    /* leave empty */
  }
  return [];
}

function parseMedia(json: string): MsgMedia {
  try {
    const m = JSON.parse(json) as {
      audio?: Array<{ uri?: string }>;
      photos?: Array<{ uri?: string }>;
      videos?: Array<{ uri?: string }>;
      gifs?: Array<{ uri?: string }>;
      share?: { link?: string; shareText?: string } | null;
    };
    const uris = (arr?: Array<{ uri?: string }>): string[] =>
      (arr ?? []).map((x) => x.uri).filter((u): u is string => typeof u === "string");
    return {
      audio: uris(m.audio),
      photos: uris(m.photos),
      videos: uris(m.videos),
      gifs: uris(m.gifs),
      share: m.share ?? null,
    };
  } catch {
    return { ...EMPTY_MEDIA };
  }
}

/** One thread by slug, with all messages oldest-first (chat order). One Rust
 *  round-trip (query_thread_detail) returns the thread row + its messages. */
export async function fetchThread(slug: string, archiveId?: number): Promise<ThreadDetail | null> {
  const detail = await invoke<{
    thread: ThreadSummaryRaw | null;
    messages: MessageRaw[];
  }>("query_thread_detail", { slug, archiveId: archiveId ?? null });

  if (!detail.thread) return null;

  return {
    thread: toThreadSummary(detail.thread),
    messages: detail.messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      timestampMs: m.timestamp_ms,
      content: m.content,
      reactions: parseReactions(m.reactions),
      media: parseMedia(m.media),
      downloadStatus: m.download_status,
      localPath: m.local_path,
      thumbPath: m.thumb_path,
    })),
  };
}

/**
 * Best guess at the archive owner's sender name: the sender of the most messages
 * overall. NOT "most distinct threads" — that returns "Instagram user", Meta's
 * placeholder for deleted/unavailable accounts, which is collapsed across 279
 * one-off request threads. The real owner dominates by volume (12,015 msgs vs
 * the placeholder's 1,059). Data-driven rather than profile-derived because the
 * display name can change over time. Used only for bubble alignment (cosmetic).
 */
export async function fetchSelfSender(archiveId?: number): Promise<string | null> {
  return await invoke<string | null>("query_self_sender", { archiveId: archiveId ?? null });
}

// --- Stories / Reposts / Posts / Profile changes (Step 12) ------------------

export interface ProfileChange {
  field: string;
  previousValue: string | null;
  newValue: string | null;
  changedAt: number;
}

/** Profile field changes, newest first (e.g. the display-name rename). */
export async function fetchProfileChanges(archiveId?: number): Promise<ProfileChange[]> {
  const rows = await invoke<{
    field: string;
    previous_value: string | null;
    new_value: string | null;
    changed_at: number;
  }[]>("query_profile_changes", { archiveId: archiveId ?? null });
  return rows.map((r) => ({
    field: r.field,
    previousValue: r.previous_value,
    newValue: r.new_value,
    changedAt: r.changed_at,
  }));
}

export interface Story {
  uri: string;
  createdAt: number;
  title: string;
  sourceApp: string | null;
}

/** Archived stories for one import, newest first. `uri` is an archive entry path (vmedia). */
export async function fetchStories(archiveId?: number): Promise<Story[]> {
  const rows = await invoke<{
    uri: string;
    created_at: number;
    title: string;
    source_app: string | null;
  }[]>("query_stories", { archiveId: archiveId ?? null });
  return rows.map((r) => ({
    uri: r.uri,
    createdAt: r.created_at,
    title: r.title,
    sourceApp: r.source_app,
  }));
}

export interface Repost {
  id: number;
  repostedAt: number;
  userText: string;
  sourceUrl: string;
  sourceCaption: string;
  sourceOwnerName: string | null;
  sourceOwnerUsername: string | null;
  /** Persisted download outcome: 'none' | 'downloaded' | 'login_walled' | 'dead' | 'error'. */
  downloadStatus: string;
  localPath: string | null;
  thumbPath: string | null;
}

/** Reposts (shared posts), newest first. Source media isn't in the archive —
 *  only the permalink + captured caption/owner, so these render as cards. */
export async function fetchReposts(archiveId?: number): Promise<Repost[]> {
  const rows = await invoke<{
    id: number;
    reposted_at: number;
    user_text: string;
    source_url: string;
    source_caption: string;
    source_owner_name: string | null;
    source_owner_username: string | null;
    download_status: string;
    local_path: string | null;
    thumb_path: string | null;
  }[]>("query_reposts", { archiveId: archiveId ?? null });
  return rows.map((r) => ({
    id: r.id,
    repostedAt: r.reposted_at,
    userText: r.user_text,
    sourceUrl: r.source_url,
    sourceCaption: r.source_caption,
    sourceOwnerName: r.source_owner_name,
    sourceOwnerUsername: r.source_owner_username,
    downloadStatus: r.download_status,
    localPath: r.local_path,
    thumbPath: r.thumb_path,
  }));
}

export interface OwnPost {
  uri: string;
  mediaId: string;
  ext: string | null;
  sizeBytes: number | null;
}

export interface FacebookPostMedia {
  uri: string;
  createdAt: number | null;
}

export interface FacebookPost {
  id: number;
  createdAt: number;
  text: string;
  title: string;
  media: FacebookPostMedia[];
  links: string[];
}

export interface FacebookAlbumPhoto {
  uri: string;
  createdAt: number | null;
  title: string | null;
  description: string | null;
}

export interface FacebookAlbum {
  id: number;
  name: string;
  description: string | null;
  coverPhotoUri: string | null;
  lastModified: number;
  photoCount: number;
  photos: FacebookAlbumPhoto[];
}

interface FacebookPostRaw {
  id: number;
  created_at: number;
  text: string;
  title: string;
  media: string;
  links: string;
}

interface FacebookAlbumRaw {
  id: number;
  name: string;
  description: string | null;
  cover_photo_uri: string | null;
  last_modified: number;
  photo_count: number;
  photos: string;
}

export function parseFacebookPostMedia(json: string): FacebookPostMedia[] {
  try {
    const parsed = JSON.parse(json) as Array<{ uri?: unknown; createdAt?: unknown }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m): m is { uri: string; createdAt?: unknown } => typeof m.uri === "string")
      .map((m) => ({ uri: m.uri, createdAt: typeof m.createdAt === "number" ? m.createdAt : null }));
  } catch {
    return [];
  }
}

export function parseFacebookPostLinks(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function parseFacebookAlbumPhotos(json: string): FacebookAlbumPhoto[] {
  try {
    const parsed = JSON.parse(json) as Array<{
      uri?: unknown;
      createdAt?: unknown;
      title?: unknown;
      description?: unknown;
    }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is { uri: string; createdAt?: unknown; title?: unknown; description?: unknown } =>
        typeof p.uri === "string",
      )
      .map((p) => ({
        uri: p.uri,
        createdAt: typeof p.createdAt === "number" ? p.createdAt : null,
        title: typeof p.title === "string" ? p.title : null,
        description: typeof p.description === "string" ? p.description : null,
      }));
  } catch {
    return [];
  }
}

/** The user's own post media recovered from the archive (Meta DYI 2026-05 omits
 *  the posts index, so these have no captions/timestamps — just media files). */
export async function fetchOwnPosts(archiveId?: number): Promise<OwnPost[]> {
  const rows = await invoke<{
    uri: string;
    media_id: string;
    ext: string | null;
    size_bytes: number | null;
  }[]>("query_own_posts", { archiveId: archiveId ?? null });
  return rows.map((r) => ({
    uri: r.uri,
    mediaId: r.media_id,
    ext: r.ext,
    sizeBytes: r.size_bytes,
  }));
}

/** Facebook timeline posts for one import, newest first. `media` entries are archive paths. */
export async function fetchPosts(archiveId?: number): Promise<FacebookPost[]> {
  const rows = await invoke<FacebookPostRaw[]>("query_posts", { archiveId: archiveId ?? null });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    text: r.text,
    title: r.title,
    media: parseFacebookPostMedia(r.media),
    links: parseFacebookPostLinks(r.links),
  }));
}

/** Facebook photo albums for one import, newest modified first. */
export async function fetchAlbums(archiveId?: number): Promise<FacebookAlbum[]> {
  const rows = await invoke<FacebookAlbumRaw[]>("query_albums", { archiveId: archiveId ?? null });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    coverPhotoUri: r.cover_photo_uri,
    lastModified: r.last_modified,
    photoCount: r.photo_count,
    photos: parseFacebookAlbumPhotos(r.photos),
  }));
}

// --- Connections (Feature E) ------------------------------------------------

export interface Connection {
  /** 'followers' | 'following' | 'close_friends' | 'blocked'. */
  kind: string;
  username: string;
  href: string;
  /** ms since epoch (0 if the export didn't record one). */
  followedAt: number;
}

/** All follower/following/etc. relationships, alphabetical by handle. The route
 *  filters by `kind` client-side (a few thousand rows; one fetch + virtualize). */
export async function fetchConnections(archiveId?: number): Promise<Connection[]> {
  const rows = await invoke<{
    kind: string;
    username: string;
    href: string;
    followed_at: number;
  }[]>("query_connections", { archiveId: archiveId ?? null });
  return rows.map((r) => ({
    kind: r.kind,
    username: r.username,
    href: r.href,
    followedAt: r.followed_at,
  }));
}

// --- Download completion (Feature D) ----------------------------------------
// "Make my archive complete" covers the two link-only sources that need a yt-dlp
// fetch: saved posts + posts shared into DMs. In-zip media (DM attachments,
// stories, profile, own posts) is already offline via vmedia, so it's not here.

export interface DownloadStats {
  /** All downloadable references (reachable + unavailable). */
  total: number;
  downloaded: number;
  /** Dead (404/deleted) or login-walled — cannot be recovered. */
  unavailable: number;
  /** total − unavailable: the realistic ceiling. */
  reachable: number;
  /** reachable − downloaded: still to fetch. */
  remaining: number;
}

interface ShareRow {
  id: number;
  link: string | null;
  status: string;
}

/** Pull every message that carries a shared-post link, with its download status.
 *  Scoped to one import when given (None = all), so each account's completion
 *  card counts only its own conversation shares. */
async function fetchShareRows(archiveId?: number): Promise<ShareRow[]> {
  const rows = await invoke<ShareRow[]>("query_share_rows", { archiveId: archiveId ?? null });
  return rows.filter((r) => isDownloadableShare(r.link));
}

const UNAVAILABLE = new Set(["dead", "login_walled"]);

/** Combined download progress for one import. Instagram = saved posts + DM shares;
 *  Facebook = DM-shared reels/videos only (its saved_items table is empty, and
 *  post/album media is already offline in-zip). Omit `archiveId` for all imports. */
export async function fetchDownloadStats(archiveId?: number): Promise<DownloadStats> {
  const s = await invoke<{ total: number; downloaded: number; unavailable: number }>(
    "query_saved_download_stats",
    { archiveId: archiveId ?? null },
  );

  let total = s.total;
  let downloaded = s.downloaded;
  let unavailable = s.unavailable;
  for (const r of await fetchShareRows(archiveId)) {
    total += 1;
    if (r.status === "downloaded") downloaded += 1;
    else if (UNAVAILABLE.has(r.status)) unavailable += 1;
  }

  const reachable = total - unavailable;
  return { total, downloaded, unavailable, reachable, remaining: Math.max(0, reachable - downloaded) };
}

/** Every not-yet-fetched, recoverable download for one import as queue inputs.
 *  Skips downloaded/dead/login_walled; includes `none` + `error` (errors retry).
 *  Saved items are Instagram-only; for a Facebook import the scoped query is empty. */
export async function fetchDownloadTargets(archiveId?: number): Promise<EnqueueInput[]> {
  const saved = await fetchSavedItems(archiveId);
  const savedTargets: EnqueueInput[] = saved
    .filter((it) => it.downloadStatus === "none" || it.downloadStatus === "error")
    .map((it) => ({
      source: "saved",
      refId: it.id,
      url: it.url,
      slug: sanitizeSlug(it.collections[0]),
    }));

  const shareTargets: EnqueueInput[] = (await fetchShareRows(archiveId))
    .filter((r) => (r.status === "none" || r.status === "error") && r.link)
    .map((r) => ({ source: "message", refId: r.id, url: r.link!, slug: DM_SLUG }));

  return [...savedTargets, ...shareTargets];
}
