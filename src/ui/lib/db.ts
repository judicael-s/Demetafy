import { invoke } from "@tauri-apps/api/core";

/** Row counts returned by `ingest_write`. Matches Rust `Counts`. */
export interface IngestCounts {
  savedItems: number;
  savedCollections: number;
  threads: number;
  messages: number;
  stories: number;
  reposts: number;
  ownPosts: number;
  profileChanges: number;
  connections: number;
  posts: number;
  albums: number;
}

// Payload shapes mirror the Rust `IngestPayload` structs (camelCase). The TS
// side owns the parse → column mapping (Date → epoch ms, arrays → JSON strings),
// exactly like Phase 0's src/storage/db.ts insert helpers did; Rust just writes.

export interface ProfilePayload {
  username: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  isPrivate: boolean;
  countryCode: string | null;
  fbid: string | null;
  profilePhotoUri: string | null;
  profilePhotoTakenAt: number | null;
  firstStoryAt: number | null;
  lastStoryAt: number | null;
  lastLoginAt: number | null;
  lastLogoutAt: number | null;
  hasArchivedReels: boolean | null;
  // Facebook-only (16E); null for Instagram profiles.
  currentCity: string | null;
  hometown: string | null;
  relationshipStatus: string | null;
}

export interface ProfileChangePayload {
  field: string;
  previousValue: string | null;
  newValue: string | null;
  changedAt: number;
}

export interface SavedItemPayload {
  url: string;
  caption: string;
  savedAt: number;
  collectionNames: string;
}

export interface SavedCollectionPayload {
  name: string;
  type: string | null;
  privacy: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  itemCount: number;
  itemUrls: string;
}

export interface MessagePayload {
  sender: string;
  timestampMs: number;
  content: string;
  reactions: string;
  media: string;
}

export interface ThreadPayload {
  threadPath: string;
  source: string;
  slug: string;
  title: string;
  participants: string;
  isStillParticipant: boolean;
  messages: MessagePayload[];
}

export interface StoryPayload {
  uri: string;
  createdAt: number;
  title: string;
  sourceApp: string | null;
  deviceId: string | null;
}

export interface RepostPayload {
  repostedAt: number;
  expiresAt: number | null;
  userText: string;
  sourceUrl: string;
  sourceCaption: string;
  sourceTitle: string;
  sourceOwnerName: string | null;
  sourceOwnerUsername: string | null;
  fbid: string | null;
}

export interface OwnPostPayload {
  uri: string;
  mediaId: string;
  ext: string | null;
  sizeBytes: number | null;
}

export interface ConnectionPayload {
  kind: string;
  username: string;
  href: string;
  followedAt: number;
}

/** A Facebook timeline post (16E). `media`/`links` are JSON strings the UI parses:
 *  media = `[{ uri, createdAt }]` (createdAt in ms), links = `[string]`. */
export interface PostPayload {
  createdAt: number;
  text: string;
  title: string;
  media: string;
  links: string;
}

/** A Facebook photo album (16E). `photos` is a JSON string the UI parses:
 *  `[{ uri, createdAt, title, description }]` (createdAt in ms). */
export interface AlbumPayload {
  name: string;
  description: string | null;
  coverPhotoUri: string | null;
  lastModified: number;
  photoCount: number;
  photos: string;
}

export interface IngestPayload {
  sourcePath: string;
  /** Every zip part of this logical archive (Instagram: 1; Facebook: many). */
  partPaths: string[];
  service: string;
  profile: ProfilePayload | null;
  profileChanges: ProfileChangePayload[];
  savedItems: SavedItemPayload[];
  savedCollections: SavedCollectionPayload[];
  threads: ThreadPayload[];
  stories: StoryPayload[];
  reposts: RepostPayload[];
  ownPosts: OwnPostPayload[];
  connections: ConnectionPayload[];
  posts: PostPayload[];
  albums: AlbumPayload[];
}

/** Transactional write of a fully-parsed archive. */
export function ingestWrite(payload: IngestPayload): Promise<IngestCounts> {
  return invoke<IngestCounts>("ingest_write", { payload });
}

/** Absolute downloads root (created on demand): `app_data_dir/downloads`. */
export function downloadDir(): Promise<string> {
  return invoke<string>("download_dir");
}
