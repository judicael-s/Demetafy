/**
 * App-wide media viewer singleton. Any surface maps its media into uniform
 * `ViewerItem`s and calls `viewer.open(items, index)`; the single `<MediaViewer>`
 * mounted in the Shell pages through them. Mirrors the `downloadQueue` singleton
 * pattern (a module-scoped `createStore`, exposed as `.state` + methods) so no
 * context/provider plumbing is needed.
 */
import { createStore } from "solid-js/store";

export interface ViewerItem {
  /** Stable, namespaced identity used across navigation and reactive updates. */
  key: string;
  kind: "image" | "video";
  /** Resolved vmedia/dmedia URL. Absent => not yet downloaded; see `download`. */
  src?: string;
  poster?: string;
  caption?: string;
  timestampMs?: number;
  /** Short provenance label shown in reel/feed chrome, e.g. "Saved" or "Story". */
  source?: string;
  /** Truthful in-app route where this media came from. */
  sourceRoute?: { label: string; href: string };
  /** Optional external permalink (e.g. the original Instagram post) — surfaced as
   *  an "Open original" affordance in the viewer chrome. */
  openExternalUrl?: string;
  /**
   * Saved-only. When `src` is absent the viewer shows a "Download to view" slide,
   * auto-enqueues this item once it's the settled (dwelt-on) slide, and resolves
   * the effective media reactively from `downloadQueue.state` via these fields.
   */
  download?: {
    key: string;
    enqueue: () => void;
    dbStatus: string;
    dbLocalPath: string | null;
    dbThumbPath: string | null;
  };
}

export interface ViewerState {
  open: boolean;
  items: ViewerItem[];
  index: number;
}

const clamp = (i: number, max: number): number => Math.max(0, Math.min(i, max));

export function createViewer() {
  const [state, setState] = createStore<ViewerState>({ open: false, items: [], index: 0 });
  return {
    state,
    open(items: ViewerItem[], index = 0): void {
      if (items.length === 0) return;
      setState({ open: true, items, index: clamp(index, items.length - 1) });
    },
    close(): void {
      setState("open", false);
    },
    next(): void {
      setState("index", (i) => clamp(i + 1, state.items.length - 1));
    },
    prev(): void {
      setState("index", (i) => clamp(i - 1, state.items.length - 1));
    },
    goTo(i: number): void {
      setState("index", clamp(i, state.items.length - 1));
    },
  };
}

export type Viewer = ReturnType<typeof createViewer>;

export const viewer = createViewer();
