import { MergedArchiveReader, type ArchiveReader } from "./archive.js";
import {
  ingestWrite,
  type IngestCounts,
  type IngestPayload,
  type ThreadPayload,
  type PostPayload,
  type AlbumPayload,
  type ConnectionPayload,
} from "./db.js";
import {
  parseSavedPosts,
  parseSavedCollections,
  linkItemsToCollections,
} from "../../parsers/instagram/saved.js";
import { parseThreadFiles, type Thread } from "../../parsers/instagram/messages.js";
import { parseStories } from "../../parsers/instagram/stories.js";
import { parseReposts } from "../../parsers/instagram/reposts.js";
import { findOwnPostEntries, parseOwnPost } from "../../parsers/instagram/posts.js";
import { parseProfile, parseProfileChanges } from "../../parsers/instagram/profile.js";
import { parseConnections, type Connection } from "../../parsers/instagram/connections.js";
import { parseFacebookProfile } from "../../parsers/facebook/profile.js";
import { parseFacebookPosts } from "../../parsers/facebook/posts.js";
import {
  parseFacebookAlbum,
  parseFacebookUncategorizedPhotos,
  pickProfilePhoto,
  type FacebookAlbum,
  type FacebookPhoto,
} from "../../parsers/facebook/photos.js";
import { parseFacebookConnections } from "../../parsers/facebook/connections.js";
import { FACEBOOK_THREAD_CATEGORIES } from "../../parsers/facebook/messages.js";
import { detectArchiveType } from "./archive-detect.js";
import { validateFacebookArchiveCompleteness } from "./facebook-import-gate.js";
import { metaExportGroupId } from "./import-selection.js";

/** Coarse ingest phases surfaced to the import UI. `messages` is the only one
 *  with meaningful granularity (the per-thread parse loop); the rest are quick
 *  or, for `writing`, a single opaque transactional Rust call. */
export type IngestPhase = "opening" | "indexing" | "checking" | "reading" | "messages" | "writing" | "done";

export interface IngestProgress {
  phase: IngestPhase;
  /** Threads parsed so far (only set during `messages`). */
  current?: number;
  /** Total threads to parse (only set during `messages`). */
  total?: number;
}

export type ProgressFn = (p: IngestProgress) => void;

/** Reason an ingest was rejected before/at parse time. The UI maps `code` to
 *  user-facing copy so the wording stays in the view layer. */
export type IngestErrorCode = "corrupt" | "partial_facebook" | "not_instagram";

export class IngestError extends Error {
  constructor(
    readonly code: IngestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

// Instagram entry paths.
const PERSONAL = "personal_information/personal_information/personal_information.json";
const IG_PROFILE = "personal_information/personal_information/instagram_profile_information.json";
const CHANGES = "personal_information/personal_information/profile_changes.json";
const SAVED_POSTS = "your_instagram_activity/saved/saved_posts.json";
const SAVED_COLLECTIONS = "your_instagram_activity/saved/saved_collections.json";
const STORIES = "your_instagram_activity/media/stories.json";
const REPOSTS = "your_instagram_activity/media/reposts.json";

// Facebook entry paths. The content paths are matched on their distinctive tail
// (anchored at `/posts/` or `/connections/`) rather than a fixed full prefix, so
// they keep resolving even if Meta shuffles the leading root segment. The
// followers file name carries an apostrophe (`who_you've_followed.json`) — the
// `who_you*` match dodges any escaping quirk. Verified shapes: 16D notes.
const FB_PROFILE = "personal_information/profile_information/profile_information.json";
const FB_POSTS_RE = /(?:^|\/)posts\/your_posts__check_ins__photos_and_videos_\d+\.json$/;
const FB_ALBUM_RE = /(?:^|\/)posts\/album\/\d+\.json$/;
const FB_UNCATEGORIZED_RE = /(?:^|\/)posts\/your_uncategorized_photos\.json$/;
const FB_FRIENDS_RE = /(?:^|\/)connections\/friends\/your_friends\.json$/;
const FB_FOLLOWING_RE = /(?:^|\/)connections\/followers\/who_you[^/]*\.json$/;

interface ThreadFiles {
  /** The category folder the thread lives under; stored verbatim in `threads.source`. */
  source: string;
  folder: string;
  slug: string;
  files: string[];
}

// Ported from bin/demetafy.ts, generalized to either service's activity root.
// Kept local (not extracted into a shared module) to keep the frozen Phase 0 CLI
// untouched; the canonical copy lives there.
function discoverThreads(
  reader: ArchiveReader,
  activityRoot: string,
  sources: readonly string[],
): ThreadFiles[] {
  const byFolder = new Map<string, ThreadFiles>();
  const messageFileRe = /\/message_\d+\.json$/;
  for (const entry of reader.listEntries()) {
    for (const source of sources) {
      const prefix = `${activityRoot}/messages/${source}/`;
      if (entry.fileName.startsWith(prefix) && messageFileRe.test(entry.fileName)) {
        const folder = entry.fileName.slice(0, entry.fileName.lastIndexOf("/"));
        const slug = folder.slice(folder.lastIndexOf("/") + 1);
        const existing = byFolder.get(folder);
        if (existing) existing.files.push(entry.fileName);
        else byFolder.set(folder, { source, folder, slug, files: [entry.fileName] });
        break;
      }
    }
  }
  for (const tf of byFolder.values()) tf.files.sort();
  return [...byFolder.values()];
}

async function loadThread(reader: ArchiveReader, tf: ThreadFiles): Promise<Thread> {
  const jsons = await Promise.all(
    tf.files.map(async (p) => JSON.parse(await reader.readEntryText(p))),
  );
  return parseThreadFiles(jsons);
}

/** Map with bounded concurrency — at most `limit` `fn` calls in flight at once,
 *  preserving input order in the result. Replaces an unbounded
 *  `Promise.all(items.map(fn))`, which for a large Facebook archive (1700+
 *  threads) fired thousands of concurrent `archive_read_text` IPC reads in one
 *  burst and froze the WebView. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** Threads parsed concurrently. Bounds in-flight zip reads + JSON.parse so a huge
 *  archive streams through in waves instead of loading every thread at once. */
const THREAD_CONCURRENCY = 8;

/** Load + parse every discovered thread with bounded concurrency, reporting
 *  progress at a throttled cadence (a reactive update per thread × thousands of
 *  threads would itself jank the UI). Shared by the IG and FB builders. */
async function loadThreads(
  reader: ArchiveReader,
  tfs: ThreadFiles[],
  onProgress?: ProgressFn,
): Promise<Array<{ tf: ThreadFiles; thread: Thread }>> {
  onProgress?.({ phase: "messages", current: 0, total: tfs.length });
  let parsed = 0;
  return mapWithConcurrency(tfs, THREAD_CONCURRENCY, async (tf) => {
    const thread = await loadThread(reader, tf);
    parsed += 1;
    if (parsed % 20 === 0 || parsed === tfs.length) {
      onProgress?.({ phase: "messages", current: parsed, total: tfs.length });
    }
    return { tf, thread };
  });
}

/** Parsed thread → DB payload. Identical for Instagram and Facebook (their
 *  Messenger JSON is the same shape — 16D), so both builders share this. */
function toThreadPayload(source: string, slug: string, thread: Thread): ThreadPayload {
  return {
    threadPath: thread.threadPath,
    source,
    slug,
    title: thread.title,
    participants: JSON.stringify(thread.participants),
    isStillParticipant: thread.isStillParticipant,
    messages: thread.messages.map((m) => ({
      sender: m.sender,
      timestampMs: m.timestampMs,
      content: m.content ?? "",
      reactions: JSON.stringify(m.reactions),
      media: JSON.stringify({
        audio: m.audioFiles,
        photos: m.photos,
        videos: m.videos,
        gifs: m.gifs,
        share: m.share ?? null,
      }),
    })),
  };
}

const CONN_DIR = "connections/followers_and_following";
// Single-file connection kinds. Followers ship split (followers_1.json, _2, …)
// so they're discovered separately. The lists we surface in the UI; others
// (pending/restricted/recently-unfollowed) are left unparsed for now.
const CONN_FILES: ReadonlyArray<readonly [string, string]> = [
  [`${CONN_DIR}/following.json`, "following"],
  [`${CONN_DIR}/close_friends.json`, "close_friends"],
  [`${CONN_DIR}/blocked_profiles.json`, "blocked"],
];
const FOLLOWERS_RE = /^connections\/followers_and_following\/followers_\d+\.json$/;

async function loadConnections(reader: ArchiveReader): Promise<Connection[]> {
  const out: Connection[] = [];
  for (const entry of reader.listEntries()) {
    if (FOLLOWERS_RE.test(entry.fileName)) {
      out.push(...parseConnections(JSON.parse(await reader.readEntryText(entry.fileName)), "followers"));
    }
  }
  for (const [path, kind] of CONN_FILES) {
    if (reader.hasEntry(path)) {
      out.push(...parseConnections(JSON.parse(await reader.readEntryText(path)), kind));
    }
  }
  return out;
}

const ms = (d: Date): number => d.getTime();
const msOrNull = (d: Date | undefined | null): number | null => (d ? d.getTime() : null);
const secToMs = (s: number): number => (s ? s * 1000 : 0);

/**
 * Full ingest of an archive into the index. Opens the (possibly multi-part)
 * reader once, detects the service from the merged entry list, then dispatches
 * to the matching builder. Read + parse everything (reusing the parsers),
 * assemble a flat payload, then one transactional write via `ingest_write`.
 */
export async function ingestArchive(
  paths: string[],
  onProgress?: ProgressFn,
): Promise<IngestCounts> {
  const primaryPath = paths[0];
  if (primaryPath === undefined) {
    throw new IngestError("corrupt", "No archive file was selected.");
  }
  onProgress?.({ phase: "opening" });
  let reader: ArchiveReader;
  try {
    onProgress?.({ phase: "indexing" });
    reader = await MergedArchiveReader.open(paths);
  } catch (e) {
    throw new IngestError(
      "corrupt",
      `Could not open the archive: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  try {
    onProgress?.({ phase: "checking" });
    const entryNames = reader.listEntries().map((entry) => entry.fileName);
    const type = detectArchiveType(entryNames);

    // D3: a multi-part Meta export is one logical archive identified by its
    // `service-user-date` group id, so re-downloading it (fresh random zip
    // suffixes) resets the same archive instead of creating a duplicate. A single
    // file keys on its own path — this preserves the existing single-zip
    // Instagram index, whose idempotency key must not change.
    const sourcePath = paths.length > 1 ? (metaExportGroupId(paths) ?? primaryPath) : primaryPath;

    let payload: IngestPayload;
    if (type === "facebook") {
      if (!validateFacebookArchiveCompleteness(entryNames).ok) {
        throw new IngestError(
          "partial_facebook",
          "This Facebook export is missing the metadata/taxonomy zip part.",
        );
      }
      payload = await buildFacebookPayload(reader, sourcePath, paths, onProgress);
    } else if (type === "instagram") {
      payload = await buildInstagramPayload(reader, sourcePath, paths, onProgress);
    } else {
      throw new IngestError(
        "not_instagram",
        "This does not look like an Instagram “Download Your Information” export.",
      );
    }

    onProgress?.({ phase: "writing" });
    const counts = await ingestWrite(payload);
    onProgress?.({ phase: "done" });
    return counts;
  } finally {
    await reader.close();
  }
}

async function buildInstagramPayload(
  reader: ArchiveReader,
  sourcePath: string,
  partPaths: string[],
  onProgress?: ProgressFn,
): Promise<IngestPayload> {
  onProgress?.({ phase: "reading" });
  const personal = reader.hasEntry(PERSONAL)
    ? JSON.parse(await reader.readEntryText(PERSONAL))
    : null;
  const igProfile = reader.hasEntry(IG_PROFILE)
    ? JSON.parse(await reader.readEntryText(IG_PROFILE))
    : null;
  const profile = parseProfile(personal, igProfile);
  const profileChanges = reader.hasEntry(CHANGES)
    ? parseProfileChanges(JSON.parse(await reader.readEntryText(CHANGES)))
    : [];

  const collections = reader.hasEntry(SAVED_COLLECTIONS)
    ? parseSavedCollections(JSON.parse(await reader.readEntryText(SAVED_COLLECTIONS)))
    : [];
  const savedItems = reader.hasEntry(SAVED_POSTS)
    ? linkItemsToCollections(
        parseSavedPosts(JSON.parse(await reader.readEntryText(SAVED_POSTS))),
        collections,
      )
    : [];

  const stories = reader.hasEntry(STORIES)
    ? parseStories(JSON.parse(await reader.readEntryText(STORIES)))
    : [];
  const reposts = reader.hasEntry(REPOSTS)
    ? parseReposts(JSON.parse(await reader.readEntryText(REPOSTS)))
    : [];
  const ownPosts = findOwnPostEntries(reader.listEntries()).map(parseOwnPost);

  const connections = await loadConnections(reader);

  const tfs = discoverThreads(reader, "your_instagram_activity", [
    "inbox",
    "message_requests",
    "broadcast",
  ]);
  const loaded = await loadThreads(reader, tfs, onProgress);

  return {
    sourcePath,
    partPaths,
    service: "instagram",
    profile: {
      username: profile.username,
      displayName: profile.displayName,
      email: profile.email ?? null,
      phone: profile.phone ?? null,
      gender: profile.gender ?? null,
      dateOfBirth: profile.dateOfBirth ?? null,
      isPrivate: profile.isPrivateAccount,
      countryCode: profile.countryCode ?? null,
      fbid: profile.fbid ?? null,
      profilePhotoUri: profile.profilePhotoUri ?? null,
      profilePhotoTakenAt: msOrNull(profile.profilePhotoTakenAt),
      firstStoryAt: msOrNull(profile.firstStoryAt),
      lastStoryAt: msOrNull(profile.lastStoryAt),
      lastLoginAt: msOrNull(profile.lastLoginAt),
      lastLogoutAt: msOrNull(profile.lastLogoutAt),
      hasArchivedReels: profile.hasArchivedReels ?? null,
      currentCity: null,
      hometown: null,
      relationshipStatus: null,
    },
    profileChanges: profileChanges.map((c) => ({
      field: c.field,
      previousValue: c.previousValue,
      newValue: c.newValue,
      changedAt: ms(c.changedAt),
    })),
    savedItems: savedItems.map((s) => ({
      url: s.url,
      caption: s.caption,
      savedAt: ms(s.savedAt),
      collectionNames: JSON.stringify(s.collections),
    })),
    savedCollections: collections.map((c) => ({
      name: c.name,
      type: c.type ?? null,
      privacy: c.privacy ?? null,
      createdAt: msOrNull(c.createdAt),
      updatedAt: msOrNull(c.updatedAt),
      itemCount: c.itemUrls.length,
      itemUrls: JSON.stringify(c.itemUrls),
    })),
    threads: loaded.map(({ tf, thread }) => toThreadPayload(tf.source, tf.slug, thread)),
    stories: stories.map((s) => ({
      uri: s.uri,
      createdAt: ms(s.createdAt),
      title: s.title,
      sourceApp: s.sourceApp ?? null,
      deviceId: s.deviceId ?? null,
    })),
    reposts: reposts.map((r) => ({
      repostedAt: ms(r.repostedAt),
      expiresAt: msOrNull(r.expiresAt),
      userText: r.userText,
      sourceUrl: r.source.url,
      sourceCaption: r.source.caption,
      sourceTitle: r.source.title,
      sourceOwnerName: r.source.ownerName ?? null,
      sourceOwnerUsername: r.source.ownerUsername ?? null,
      fbid: r.fbid ?? null,
    })),
    ownPosts: ownPosts.map((o) => ({
      uri: o.uri,
      mediaId: o.mediaId,
      ext: o.ext ?? null,
      sizeBytes: o.sizeBytes ?? null,
    })),
    connections: connections.map((c) => ({
      kind: c.kind,
      username: c.username,
      href: c.href,
      // parser yields seconds; store ms for parity with every other timestamp.
      followedAt: secToMs(c.timestamp ?? 0),
    })),
    posts: [],
    albums: [],
  };
}

/** Facebook photos (seconds-epoch `creationTimestamp`) → the stored album-photo
 *  JSON shape (ms `createdAt`), keeping every DB timestamp in ms. */
function toAlbumPayload(
  name: string,
  description: string | null,
  coverPhotoUri: string | null,
  lastModifiedSec: number,
  photos: FacebookPhoto[],
): AlbumPayload {
  return {
    name,
    description,
    coverPhotoUri,
    lastModified: secToMs(lastModifiedSec),
    photoCount: photos.length,
    photos: JSON.stringify(
      photos.map((p) => ({
        uri: p.uri,
        createdAt: secToMs(p.creationTimestamp),
        title: p.title ?? null,
        description: p.description ?? null,
      })),
    ),
  };
}

/** Exported for unit testing against a fake {@link ArchiveReader}; the public
 *  entry point is {@link ingestArchive}, which detects the service and dispatches. */
export async function buildFacebookPayload(
  reader: ArchiveReader,
  sourcePath: string,
  partPaths: string[],
  onProgress?: ProgressFn,
): Promise<IngestPayload> {
  onProgress?.({ phase: "reading" });
  const names = reader.listEntries().map((e) => e.fileName);
  const readJson = async (name: string): Promise<unknown> =>
    JSON.parse(await reader.readEntryText(name));

  const profile = parseFacebookProfile(
    reader.hasEntry(FB_PROFILE) ? await readJson(FB_PROFILE) : null,
  );

  // Posts can split across your_posts__..._1.json, _2.json, …
  const posts: PostPayload[] = [];
  for (const name of names.filter((n) => FB_POSTS_RE.test(n)).sort()) {
    for (const p of parseFacebookPosts(await readJson(name))) {
      posts.push({
        createdAt: secToMs(p.timestamp),
        text: p.text,
        title: p.title,
        media: JSON.stringify(
          p.media.map((m) => ({ uri: m.uri, createdAt: secToMs(m.creationTimestamp) })),
        ),
        links: JSON.stringify(p.links),
      });
    }
  }

  // Named albums + the loose photos folded into one synthetic "Uncategorized" album.
  const parsedAlbums: FacebookAlbum[] = [];
  for (const name of names.filter((n) => FB_ALBUM_RE.test(n)).sort()) {
    parsedAlbums.push(parseFacebookAlbum(await readJson(name)));
  }
  const albums: AlbumPayload[] = parsedAlbums.map((a) =>
    toAlbumPayload(a.name, a.description ?? null, a.coverPhotoUri ?? null, a.lastModified, a.photos),
  );
  const uncategorized = names.find((n) => FB_UNCATEGORIZED_RE.test(n));
  if (uncategorized) {
    const photos = parseFacebookUncategorizedPhotos(await readJson(uncategorized));
    if (photos.length > 0) albums.push(toAlbumPayload("Uncategorized", null, null, 0, photos));
  }

  // FB has no profile-photo field; the current picture lives in the profile-photos
  // album (served via vmedia like any other in-zip media).
  const profilePhoto = pickProfilePhoto(parsedAlbums);

  // Connections: friends + the "who you've followed" list. FB carries name +
  // timestamp only (no profile URL), so href is empty.
  const connections: ConnectionPayload[] = [];
  const pushConnections = async (name: string | undefined, kind: string): Promise<void> => {
    if (!name) return;
    for (const c of parseFacebookConnections(await readJson(name), kind)) {
      connections.push({ kind: c.kind, username: c.name, href: "", followedAt: secToMs(c.timestamp) });
    }
  };
  await pushConnections(names.find((n) => FB_FRIENDS_RE.test(n)), "friends");
  await pushConnections(names.find((n) => FB_FOLLOWING_RE.test(n)), "following");

  const tfs = discoverThreads(reader, "your_facebook_activity", FACEBOOK_THREAD_CATEGORIES);
  const loaded = await loadThreads(reader, tfs, onProgress);

  return {
    sourcePath,
    partPaths,
    service: "facebook",
    profile: {
      username: "", // Facebook identifies users by real name, not a handle.
      displayName: profile.fullName,
      email: profile.emails[0] ?? null,
      phone: null,
      gender: profile.gender ?? null,
      dateOfBirth: profile.dateOfBirth ?? null,
      isPrivate: false,
      countryCode: null,
      fbid: null,
      profilePhotoUri: profilePhoto?.uri ?? null,
      profilePhotoTakenAt:
        profilePhoto && profilePhoto.creationTimestamp > 0
          ? secToMs(profilePhoto.creationTimestamp)
          : null,
      firstStoryAt: null,
      lastStoryAt: null,
      lastLoginAt: null,
      lastLogoutAt: null,
      hasArchivedReels: null,
      currentCity: profile.currentCity ?? null,
      hometown: profile.hometown ?? null,
      relationshipStatus: profile.relationshipStatus ?? null,
    },
    // Former names surface through the existing profile-changes timeline.
    profileChanges: profile.previousNames.map((pn) => ({
      field: "name",
      previousValue: null,
      newValue: pn.name,
      changedAt: secToMs(pn.timestamp),
    })),
    savedItems: [],
    savedCollections: [],
    threads: loaded.map(({ tf, thread }) => toThreadPayload(tf.source, tf.slug, thread)),
    stories: [],
    reposts: [],
    ownPosts: [],
    connections,
    posts,
    albums,
  };
}
