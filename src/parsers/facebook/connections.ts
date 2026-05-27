import { fixMojibake } from '../instagram/encoding.js';

/**
 * A Facebook connection (friend / followed page / friend request). Facebook's
 * export stores only `{name, timestamp}` under a versioned wrapper key
 * (`friends_v2`, `following_v3`, …) — there is NO profile URL or handle, unlike
 * Instagram's `string_list_data`/`href`. So Instagram's `parseConnections`
 * returns nothing for these; this FB-specific parser handles the shape. The UI
 * shows a monogram avatar + name + date, with no open-profile link.
 */
export interface FacebookConnection {
  /** Bucket: 'friends' | 'following' | 'received_requests' | 'sent_requests' | … */
  kind: string;
  /** Person/page name, post-mojibake. */
  name: string;
  /** Seconds since epoch; 0 if absent. */
  timestamp: number;
}

interface RawConnection {
  name?: string;
  timestamp?: number;
}

/**
 * Facebook connection files wrap the list under a single versioned key whose
 * value is the array. Return that array regardless of the exact key name; also
 * tolerate a bare top-level array.
 */
function findConnectionArray(json: unknown): RawConnection[] {
  if (Array.isArray(json)) return json as RawConnection[];
  if (json && typeof json === 'object') {
    for (const v of Object.values(json as Record<string, unknown>)) {
      if (Array.isArray(v)) return v as RawConnection[];
    }
  }
  return [];
}

export function parseFacebookConnections(json: unknown, kind: string): FacebookConnection[] {
  const out: FacebookConnection[] = [];
  for (const c of findConnectionArray(json)) {
    if (typeof c.name !== 'string' || !c.name.trim()) continue;
    out.push({ kind, name: fixMojibake(c.name), timestamp: c.timestamp ?? 0 });
  }
  return out;
}
