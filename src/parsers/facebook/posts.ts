import { fixMojibake } from '../instagram/encoding.js';

export interface FacebookPostMedia {
  /** Archive-relative path, resolved across parts at browse time. */
  uri: string;
  /** Seconds since epoch; 0 if absent. */
  creationTimestamp: number;
}

/**
 * One of the user's own Facebook posts/check-ins. Parsed from the top-level
 * array in `posts/your_posts__check_ins__photos_and_videos_*.json`. A post may
 * carry only text, only media, only an external link, or any mix.
 */
export interface FacebookPost {
  /** Seconds since epoch. */
  timestamp: number;
  /** Body text (mojibake-fixed); '' if none. Multiple `data[].post` joined by \n. */
  text: string;
  /** Action title, e.g. "Alex a partagé un lien." (mojibake-fixed); '' if none. */
  title: string;
  media: FacebookPostMedia[];
  /** External URLs shared in the post (from `external_context.url`). */
  links: string[];
}

interface RawMedia {
  uri?: string;
  creation_timestamp?: number;
}
interface RawAttachmentItem {
  media?: RawMedia;
  external_context?: { url?: string };
}
interface RawAttachment {
  data?: RawAttachmentItem[];
}
interface RawDataItem {
  post?: string;
}
interface RawPost {
  timestamp?: number;
  title?: string;
  data?: RawDataItem[];
  attachments?: RawAttachment[];
}

/**
 * Parse the Facebook posts array. Posts are returned newest-first. Unknown
 * fields are dropped (Meta's schema drifts); malformed entries are skipped.
 */
export function parseFacebookPosts(json: unknown): FacebookPost[] {
  if (!Array.isArray(json)) return [];
  const out: FacebookPost[] = [];

  for (const raw of json as RawPost[]) {
    if (!raw || typeof raw !== 'object') continue;

    const text = (raw.data ?? [])
      .map((d) => (typeof d.post === 'string' ? d.post : ''))
      .filter((s) => s.length > 0)
      .join('\n');

    const media: FacebookPostMedia[] = [];
    const links: string[] = [];
    for (const att of raw.attachments ?? []) {
      for (const item of att.data ?? []) {
        if (typeof item.media?.uri === 'string') {
          media.push({ uri: item.media.uri, creationTimestamp: item.media.creation_timestamp ?? 0 });
        }
        if (typeof item.external_context?.url === 'string') {
          links.push(item.external_context.url);
        }
      }
    }

    out.push({
      timestamp: raw.timestamp ?? 0,
      text: fixMojibake(text),
      title: fixMojibake(raw.title ?? ''),
      media,
      links,
    });
  }

  return out.sort((a, b) => b.timestamp - a.timestamp);
}
