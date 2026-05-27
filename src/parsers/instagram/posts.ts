import type { EntryHeader } from '../shared/archive.js';

/**
 * The only entry fields own-post detection needs. Declaring the subset (rather
 * than the full yauzl-backed EntryHeader) keeps these helpers portable across
 * both the Node ArchiveReader and the Tauri WebView reader.
 */
type MediaEntry = Pick<EntryHeader, 'fileName' | 'uncompressedSize'>;

/**
 * One of Alex' own feed posts. In Meta DYI 2026-05, the user's own posts arrive
 * as orphan media files with NO accompanying JSON index — no captions,
 * timestamps, or location data is exported. We surface the media file references
 * and document the schema gap. Verify on every new DYI whether a posts index
 * file has reappeared.
 */
export interface OwnPost {
  /** Full archive-relative path, e.g. "your_instagram_activity/posts/media/your_posts/<id>.png" */
  uri: string;
  /** Instagram media id extracted from the filename. */
  mediaId: string;
  /** File extension without the dot, lowercased. */
  ext: string;
  sizeBytes: number;
}

const OWN_POSTS_PREFIX = 'your_instagram_activity/posts/media/your_posts/';
const MEDIA_EXT_RE = /\.(png|jpg|jpeg|webp|mp4|mov|gif)$/i;

/**
 * Walk the archive's entry list and return every media file under the
 * user's own-posts directory. The list is sorted by filename (stable
 * across runs) so downstream output is deterministic.
 */
export function findOwnPostEntries(entries: MediaEntry[]): MediaEntry[] {
  return entries
    .filter(
      (e) =>
        e.fileName.startsWith(OWN_POSTS_PREFIX) &&
        MEDIA_EXT_RE.test(e.fileName) &&
        !e.fileName.endsWith('/'),
    )
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

export function parseOwnPost(entry: MediaEntry): OwnPost {
  const base = entry.fileName.slice(OWN_POSTS_PREFIX.length);
  const dot = base.lastIndexOf('.');
  const mediaId = dot >= 0 ? base.slice(0, dot) : base;
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
  return { uri: entry.fileName, mediaId, ext, sizeBytes: entry.uncompressedSize };
}
