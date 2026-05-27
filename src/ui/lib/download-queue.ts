/**
 * Thin client mirror of the Rust-owned download queue (download engine inc 2b).
 *
 * The queue, retry, classification, and persistence all live in Rust now
 * (`src-tauri/src/downloader.rs`): the WebView no longer schedules downloads or
 * writes the DB. This module keeps the SAME store shape the four consumers
 * (Saved, Thread, Reposts, DownloadsDock) already read — `QueueState` /
 * `DownloadItem` / `itemKey` / `queueCounts` / `DM_SLUG` / `REPOST_SLUG` /
 * `EnqueueInput` — so none of them changed. It:
 *   - hydrates the store from `download_queue_snapshot()` on load (so an in-flight
 *     queue survives a WebView reload), and
 *   - mirrors every change by patching the store from `download://update` events.
 * `enqueue` / `retryFailed` / `clearFinished` are thin `invoke` wrappers; the
 * Rust engine owns dedup, the concurrency budget, retry, and persistence.
 *
 * The store-patch reducers (`applyItemUpdate` / `dropFinished` / `applySnapshot`)
 * are pure + exported so the mirror logic is unit-testable without the Tauri
 * runtime (the scheduler they replaced was tested the same way).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createStore, produce } from "solid-js/store";

export type DownloadStatus =
  | "queued"
  | "running"
  | "ok"
  | "skipped"
  | "dead"
  | "loginWalled"
  | "error";

/** Which table backs this download — drives status persistence + the dmedia subdir. */
export type DownloadSource = "saved" | "message" | "repost";

export interface DownloadItem {
  /** Namespaced unique key, `${source}:${refId}` (see `itemKey`). */
  key: string;
  source: DownloadSource;
  /** Row id within the source table (saved_items.id / messages.id / reposts.id). */
  refId: number;
  url: string;
  /** Output subdir under the downloads root (collection slug, `_dm`, `_reposts`). */
  slug: string;
  status: DownloadStatus;
  progress: number;
  reason?: string;
  /** Video path relative to the downloads root, set on success (for dmedia playback). */
  localPath?: string;
  /** Poster path relative to the downloads root (yt-dlp `--write-thumbnail`). */
  thumbPath?: string;
}

export interface QueueState {
  items: Record<string, DownloadItem>;
  order: string[];
  running: number;
}

export interface EnqueueInput {
  source: DownloadSource;
  refId: number;
  url: string;
  slug: string;
}

const ACTIVE: ReadonlySet<DownloadStatus> = new Set<DownloadStatus>(["queued", "running"]);
const SUCCESS: ReadonlySet<DownloadStatus> = new Set<DownloadStatus>(["ok", "skipped"]);

/** Namespaced queue key. Exported so the UI can look up live status per source. */
export function itemKey(source: DownloadSource, refId: number): string {
  return `${source}:${refId}`;
}

/** Output subdir under the downloads root for DM-shared downloads. Shared by the
 *  Thread enqueue site and the completion counter so they never drift. */
export const DM_SLUG = "_dm";

/** Output subdir under the downloads root for downloaded reposts. */
export const REPOST_SLUG = "_reposts";

/** Live count of items in the `running` status (matches the Rust snapshot field). */
function countRunning(s: QueueState): number {
  let n = 0;
  for (const key of s.order) if (s.items[key]?.status === "running") n += 1;
  return n;
}

/**
 * Apply one `download://update` event: insert the item (appending to `order` if
 * new) or replace it in place. The Rust item is the source of truth, so we mirror
 * it wholesale rather than merging fields.
 */
export function applyItemUpdate(s: QueueState, item: DownloadItem): void {
  if (s.items[item.key] === undefined) s.order.push(item.key);
  s.items[item.key] = item;
  s.running = countRunning(s);
}

/** Replace the whole store from a Rust snapshot (hydration on load / reload). */
export function applySnapshot(s: QueueState, snap: QueueState): void {
  s.items = snap.items;
  s.order = snap.order;
  s.running = snap.running;
}

/** Drop terminal items, keep queued/running (mirrors `clear_finished_downloads`). */
export function dropFinished(s: QueueState): void {
  s.order = s.order.filter((k) => {
    const it = s.items[k];
    return it !== undefined && ACTIVE.has(it.status);
  });
  for (const key of Object.keys(s.items)) {
    const it = s.items[key];
    if (it && !ACTIVE.has(it.status)) delete s.items[key];
  }
  s.running = countRunning(s);
}

/** Drop still-`queued` items, keep running + terminal (mirrors `cancel_downloads`).
 *  In-flight downloads finish; only the not-yet-started backlog is removed. */
export function dropQueued(s: QueueState): void {
  s.order = s.order.filter((k) => s.items[k]?.status !== "queued");
  for (const key of Object.keys(s.items)) {
    if (s.items[key]?.status === "queued") delete s.items[key];
  }
  s.running = countRunning(s);
}

/** Settings the client reads on each enqueue (the queue itself lives in Rust). */
export interface DownloadClientDeps {
  maxParallel: () => number;
  cookiesPath: () => string | undefined;
}

export interface DownloadQueue {
  state: QueueState;
  /** Enqueue downloads into the Rust queue (deduped server-side). */
  enqueue: (inputs: EnqueueInput[]) => void;
  /** Re-queue every `loginWalled`/`error` item (skips `dead` — won't recover). */
  retryFailed: () => void;
  /** Drop terminal items from the dock (keeps in-flight ones). */
  clearFinished: () => void;
  /** Stop a bulk fetch: drop the queued backlog; in-flight downloads finish. */
  cancelAll: () => void;
}

export function createDownloadQueue(deps: DownloadClientDeps): DownloadQueue {
  const [state, setState] = createStore<QueueState>({ items: {}, order: [], running: 0 });
  const mutate = (fn: (s: QueueState) => void): void => setState(produce(fn));

  // Mirror live changes, then hydrate the current queue (survives a WebView reload).
  // Listener first so nothing emitted after this point is dropped; the snapshot then
  // backfills anything already in flight. A stale frame in the tiny overlap is
  // self-corrected by the next `download://update`.
  void listen<DownloadItem>("download://update", (e) => {
    mutate((s) => applyItemUpdate(s, e.payload));
  });
  void invoke<QueueState>("download_queue_snapshot")
    .then((snap) => mutate((s) => applySnapshot(s, snap)))
    .catch(() => {
      /* engine not ready / non-Tauri host → start empty */
    });

  function enqueue(inputs: EnqueueInput[]): void {
    if (inputs.length === 0) return;
    void invoke("enqueue_downloads", {
      items: inputs,
      cookiesPath: deps.cookiesPath(),
      maxParallel: Math.max(1, deps.maxParallel()),
    }).catch((e: unknown) => console.error("enqueue_downloads failed", e));
  }

  function retryFailed(): void {
    void invoke("retry_failed_downloads", {
      cookiesPath: deps.cookiesPath(),
      maxParallel: Math.max(1, deps.maxParallel()),
    }).catch((e: unknown) => console.error("retry_failed_downloads failed", e));
  }

  function clearFinished(): void {
    // Optimistic local clear keeps the dock instant; the invoke clears Rust to match.
    mutate(dropFinished);
    void invoke("clear_finished_downloads").catch((e: unknown) =>
      console.error("clear_finished_downloads failed", e),
    );
  }

  function cancelAll(): void {
    // Optimistic: drop the queued backlog locally now, then tell Rust to match.
    // Running items keep emitting `download://update` until they finish.
    mutate(dropQueued);
    void invoke("cancel_downloads").catch((e: unknown) =>
      console.error("cancel_downloads failed", e),
    );
  }

  return { state, enqueue, retryFailed, clearFinished, cancelAll };
}

export function queueCounts(state: QueueState): {
  active: number;
  done: number;
  failed: number;
  total: number;
} {
  let active = 0;
  let done = 0;
  let failed = 0;
  for (const key of state.order) {
    const it = state.items[key];
    if (!it) continue;
    if (ACTIVE.has(it.status)) active += 1;
    else if (SUCCESS.has(it.status)) done += 1;
    else failed += 1;
  }
  return { active, done, failed, total: state.order.length };
}
