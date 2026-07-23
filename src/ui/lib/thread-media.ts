import type { ThreadMessage } from "./queries";
import type { ViewerItem } from "../state/viewer";
import { vmediaUrl, dmediaUrl } from "./media";

// Kept in sync with `isVideoUri` in components/ArchiveMedia.tsx; inlined so this
// pure helper (and its tests) don't depend on a component module.
const VIDEO_RE = /\.(mp4|mov|webm|m4v)$/i;

/**
 * Flatten a thread's media into chronological `ViewerItem`s for the media gallery
 * and inline bubble taps: in-zip photos, gifs, and videos (vmedia) plus any
 * shared post that has been downloaded (dmedia). Audio and not-yet-downloaded
 * shares are excluded — there's nothing to show full-screen.
 */
export function threadMediaItems(
  messages: ThreadMessage[],
  sourceRoute: { label: string; href: string } = { label: "Messages", href: "/dms" },
): ViewerItem[] {
  const out: ViewerItem[] = [];
  for (const m of messages) {
    let ordinal = 0;
    for (const u of m.media.photos) {
      out.push({
        key: `message:${m.id}:${ordinal++}`,
        kind: "image",
        src: vmediaUrl(u),
        timestampMs: m.timestampMs,
        sourceRoute,
      });
    }
    for (const u of m.media.gifs) {
      out.push({
        key: `message:${m.id}:${ordinal++}`,
        kind: "image",
        src: vmediaUrl(u),
        timestampMs: m.timestampMs,
        sourceRoute,
      });
    }
    for (const u of m.media.videos) {
      out.push({
        key: `message:${m.id}:${ordinal++}`,
        kind: "video",
        src: vmediaUrl(u),
        timestampMs: m.timestampMs,
        sourceRoute,
      });
    }
    if (m.media.share && m.localPath) {
      out.push({
        key: `message:${m.id}:${ordinal}`,
        kind: VIDEO_RE.test(m.localPath) ? "video" : "image",
        src: dmediaUrl(m.localPath),
        poster: m.thumbPath ? dmediaUrl(m.thumbPath) : undefined,
        caption: m.media.share.shareText || undefined,
        timestampMs: m.timestampMs,
        sourceRoute,
      });
    }
  }
  return out;
}
