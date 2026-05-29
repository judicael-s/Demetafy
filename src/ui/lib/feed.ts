import { dmediaUrl, vmediaUrl } from "./media";
import type { FeedMediaItem } from "./queries";
import type { ViewerItem } from "../state/viewer";

/** Build the viewer item for a feed row: a downloaded file (dmedia) wins, else the
 *  in-zip entry (vmedia). Rows with neither resolve to null and are dropped. */
export function feedItemToViewer(it: FeedMediaItem): ViewerItem | null {
  const src = it.localPath ? dmediaUrl(it.localPath) : it.uri ? vmediaUrl(it.uri) : undefined;
  if (!src) return null;
  return {
    kind: it.kind,
    src,
    poster: it.posterPath ? dmediaUrl(it.posterPath) : undefined,
    caption: it.caption ?? undefined,
    timestampMs: it.timestampMs ?? undefined,
    source: it.source,
  };
}

/** Deterministic PRNG (mulberry32) — a given seed always yields the same sequence,
 *  so a shuffle is stable across re-renders until the seed changes. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle driven by a seeded PRNG. Pure: returns a new array. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
