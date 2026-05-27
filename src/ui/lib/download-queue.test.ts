import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri runtime BEFORE importing the module under test. `mock`-prefixed
// holders so vitest allows referencing them inside the hoisted factories.
const mockInvoke = vi.fn();
const mockEvent: { onUpdate?: (e: { payload: DownloadItem }) => void } = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => mockInvoke(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: (e: { payload: DownloadItem }) => void) => {
    if (name === "download://update") mockEvent.onUpdate = cb;
    return Promise.resolve(() => undefined);
  },
}));

import {
  applyItemUpdate,
  applySnapshot,
  createDownloadQueue,
  dropFinished,
  dropQueued,
  itemKey,
  queueCounts,
  type DownloadItem,
  type DownloadStatus,
  type QueueState,
} from "./download-queue";

function item(
  source: DownloadItem["source"],
  refId: number,
  status: DownloadStatus,
  extra: Partial<DownloadItem> = {},
): DownloadItem {
  return {
    key: itemKey(source, refId),
    source,
    refId,
    url: `https://www.instagram.com/p/${refId}/`,
    slug: source === "message" ? "_dm" : "col",
    status,
    progress: status === "ok" || status === "skipped" ? 100 : 0,
    ...extra,
  };
}

const emptyState = (): QueueState => ({ items: {}, order: [], running: 0 });
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// ── pure reducers (the mirror logic — no Tauri runtime) ──────────────────────

describe("itemKey", () => {
  it("namespaces by source so a saved id and a message id never collide", () => {
    expect(itemKey("saved", 1)).toBe("saved:1");
    expect(itemKey("message", 1)).toBe("message:1");
    expect(itemKey("saved", 1)).not.toBe(itemKey("message", 1));
  });
});

describe("queueCounts", () => {
  it("buckets active / done / failed and totals the order length", () => {
    const s = emptyState();
    for (const it of [
      item("saved", 1, "queued"),
      item("saved", 2, "running"),
      item("saved", 3, "ok"),
      item("saved", 4, "skipped"),
      item("saved", 5, "dead"),
      item("saved", 6, "error"),
    ]) {
      s.items[it.key] = it;
      s.order.push(it.key);
    }
    expect(queueCounts(s)).toEqual({ active: 2, done: 2, failed: 2, total: 6 });
  });
});

describe("applyItemUpdate", () => {
  it("appends a new item to order and tracks the running count", () => {
    const s = emptyState();
    applyItemUpdate(s, item("saved", 1, "running"));
    expect(s.order).toEqual(["saved:1"]);
    expect(s.items["saved:1"]?.status).toBe("running");
    expect(s.running).toBe(1);
  });

  it("replaces an existing item in place without duplicating its order entry", () => {
    const s = emptyState();
    applyItemUpdate(s, item("saved", 1, "running", { progress: 40 }));
    applyItemUpdate(s, item("saved", 1, "ok", { localPath: "col/a.mp4" }));
    expect(s.order).toEqual(["saved:1"]);
    expect(s.items["saved:1"]?.status).toBe("ok");
    expect(s.items["saved:1"]?.localPath).toBe("col/a.mp4");
    expect(s.running).toBe(0);
  });
});

describe("dropFinished", () => {
  it("removes terminal items but keeps queued/running", () => {
    const s = emptyState();
    for (const it of [
      item("saved", 1, "ok"),
      item("saved", 2, "running"),
      item("saved", 3, "error"),
      item("saved", 4, "queued"),
    ]) {
      s.items[it.key] = it;
      s.order.push(it.key);
    }
    dropFinished(s);
    expect(s.order).toEqual(["saved:2", "saved:4"]);
    expect(s.items["saved:1"]).toBeUndefined();
    expect(s.items["saved:3"]).toBeUndefined();
    expect(s.running).toBe(1);
  });
});

describe("dropQueued", () => {
  it("removes queued backlog but keeps running + terminal (cancel)", () => {
    const s = emptyState();
    for (const it of [
      item("saved", 1, "ok"),
      item("saved", 2, "running"),
      item("saved", 3, "queued"),
      item("saved", 4, "queued"),
    ]) {
      s.items[it.key] = it;
      s.order.push(it.key);
    }
    dropQueued(s);
    expect(s.order).toEqual(["saved:1", "saved:2"]);
    expect(s.items["saved:3"]).toBeUndefined();
    expect(s.items["saved:4"]).toBeUndefined();
    expect(s.running).toBe(1);
  });
});

describe("applySnapshot", () => {
  it("replaces the store wholesale (hydration on load)", () => {
    const s = emptyState();
    applyItemUpdate(s, item("saved", 99, "queued")); // pre-existing → gone after hydrate
    applySnapshot(s, {
      items: { "saved:1": item("saved", 1, "running", { progress: 50 }) },
      order: ["saved:1"],
      running: 1,
    });
    expect(s.order).toEqual(["saved:1"]);
    expect(s.items["saved:99"]).toBeUndefined();
    expect(s.items["saved:1"]?.progress).toBe(50);
    expect(s.running).toBe(1);
  });
});

// ── client wiring (invoke + event mirror, Tauri runtime mocked) ──────────────

describe("createDownloadQueue (client mirror)", () => {
  const deps = { maxParallel: () => 3, cookiesPath: (): string | undefined => "/cookies.txt" };

  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ items: {}, order: [], running: 0 });
    mockEvent.onUpdate = undefined;
  });

  it("hydrates from download_queue_snapshot on construction", async () => {
    mockInvoke.mockResolvedValueOnce({
      items: { "saved:1": item("saved", 1, "running", { progress: 20 }) },
      order: ["saved:1"],
      running: 1,
    });
    const q = createDownloadQueue(deps);
    await flush();
    expect(mockInvoke).toHaveBeenCalledWith("download_queue_snapshot", undefined);
    expect(q.state.items["saved:1"]?.progress).toBe(20);
  });

  it("enqueue invokes enqueue_downloads with the items + current settings", async () => {
    const q = createDownloadQueue(deps);
    await flush();
    mockInvoke.mockClear();
    q.enqueue([{ source: "saved", refId: 7, url: "u", slug: "col" }]);
    expect(mockInvoke).toHaveBeenCalledWith("enqueue_downloads", {
      items: [{ source: "saved", refId: 7, url: "u", slug: "col" }],
      cookiesPath: "/cookies.txt",
      maxParallel: 3,
    });
  });

  it("enqueue with no inputs makes no IPC call", async () => {
    const q = createDownloadQueue(deps);
    await flush();
    mockInvoke.mockClear();
    q.enqueue([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("mirrors a download://update event into the store (insert then replace)", async () => {
    const q = createDownloadQueue(deps);
    await flush();
    expect(mockEvent.onUpdate).toBeDefined();
    mockEvent.onUpdate?.({ payload: item("message", 5, "running", { progress: 30 }) });
    expect(q.state.order).toContain("message:5");
    expect(q.state.items["message:5"]?.progress).toBe(30);
    mockEvent.onUpdate?.({ payload: item("message", 5, "ok", { localPath: "_dm/x.mp4" }) });
    expect(q.state.items["message:5"]?.status).toBe("ok");
    expect(q.state.items["message:5"]?.localPath).toBe("_dm/x.mp4");
    expect(q.state.order).toEqual(["message:5"]); // no duplicate
  });

  it("clearFinished optimistically drops terminal items and clears Rust", async () => {
    const q = createDownloadQueue(deps);
    await flush();
    mockEvent.onUpdate?.({ payload: item("saved", 1, "ok") });
    mockEvent.onUpdate?.({ payload: item("saved", 2, "running") });
    mockInvoke.mockClear();
    q.clearFinished();
    expect(q.state.items["saved:1"]).toBeUndefined();
    expect(q.state.items["saved:2"]?.status).toBe("running");
    expect(mockInvoke).toHaveBeenCalledWith("clear_finished_downloads", undefined);
  });

  it("retryFailed invokes retry_failed_downloads with the current settings", async () => {
    const q = createDownloadQueue(deps);
    await flush();
    mockInvoke.mockClear();
    q.retryFailed();
    expect(mockInvoke).toHaveBeenCalledWith("retry_failed_downloads", {
      cookiesPath: "/cookies.txt",
      maxParallel: 3,
    });
  });
});
