import { fixMojibake } from './encoding.js';

/**
 * One follower/following/etc. relationship. The DYI archive stores these as
 * username + profile URL + timestamp ONLY — there is no profile picture (see
 * CLAUDE.md: content others created lives in their archive, not yours). The UI
 * renders a generated monogram avatar instead.
 */
export interface Connection {
  /** Bucket: 'followers' | 'following' | 'close_friends' | 'blocked' | … */
  kind: string;
  /** Handle, post-mojibake (no leading @). */
  username: string;
  /** Normalised profile URL (Instagram's `/_u/` redirect marker stripped). */
  href: string;
  /** Seconds since epoch when the relationship was recorded; 0 if absent. */
  timestamp: number;
}

interface RawStringListItem {
  href?: string;
  value?: string;
  timestamp?: number;
}
interface RawEntry {
  title?: string;
  string_list_data?: RawStringListItem[];
}

/**
 * The connection JSONs come in two shapes: a top-level array (e.g.
 * `followers_1.json`) or an object with a single `relationships_*` key whose
 * value is the array (e.g. `following.json` → `relationships_following`). Find
 * the entries array either way.
 */
function findEntries(json: unknown): RawEntry[] {
  if (Array.isArray(json)) return json as RawEntry[];
  if (json && typeof json === 'object') {
    for (const v of Object.values(json as Record<string, unknown>)) {
      if (Array.isArray(v)) return v as RawEntry[];
    }
  }
  return [];
}

/** `https://www.instagram.com/_u/<user>` or `.../<user>` → `<user>`. */
function usernameFromHref(href: string | undefined): string {
  if (!href) return '';
  const m = /instagram\.com\/(?:_u\/)?([^/?#]+)/i.exec(href);
  return m?.[1] ?? '';
}

/** Strip Instagram's `/_u/` redirect marker so the link opens the real profile. */
function normaliseHref(href: string | undefined): string {
  if (!href) return '';
  return href.replace('/_u/', '/');
}

/**
 * Parse one connections JSON file into a list tagged with `kind`. The username
 * is taken from `string_list_data[0].value`, falling back to the entry `title`
 * (the `following.json` shape puts the handle there), then the href slug.
 */
export function parseConnections(json: unknown, kind: string): Connection[] {
  const out: Connection[] = [];
  for (const e of findEntries(json)) {
    const sld = e.string_list_data?.[0];
    const raw =
      (sld?.value && sld.value.trim()) ||
      (e.title && e.title.trim()) ||
      usernameFromHref(sld?.href);
    if (!raw) continue;
    out.push({
      kind,
      username: fixMojibake(raw),
      href: normaliseHref(sld?.href),
      timestamp: sld?.timestamp ?? 0,
    });
  }
  return out;
}
