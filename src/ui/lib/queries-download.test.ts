import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri runtime before importing the module under test. `mock`-prefixed
// holders so vitest allows referencing them inside the hoisted factory.
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => mockInvoke(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => undefined),
}));

import { fetchDownloadStats, fetchDownloadTargets } from "./queries";
import { DM_SLUG } from "./download-queue";

/** Route invoke() by command name → canned result. */
function route(handlers: Record<string, unknown>): void {
  mockInvoke.mockImplementation((cmd: string) => Promise.resolve(handlers[cmd]));
}

const SHARES = [
  { id: 1, link: "https://www.instagram.com/reel/A/", status: "none" }, // fetchable
  { id: 2, link: null, status: "none" }, // not a downloadable share → dropped
  { id: 3, link: "https://www.facebook.com/reel/9/", status: "downloaded" }, // already done
];

describe("download stats/targets are archive-scoped", () => {
  beforeEach(() => mockInvoke.mockReset());

  it("threads the archive id into both stat queries and combines counts", async () => {
    route({
      query_saved_download_stats: { total: 2, downloaded: 1, unavailable: 0 },
      query_share_rows: SHARES,
    });

    const stats = await fetchDownloadStats(2);

    expect(mockInvoke).toHaveBeenCalledWith("query_saved_download_stats", { archiveId: 2 });
    expect(mockInvoke).toHaveBeenCalledWith("query_share_rows", { archiveId: 2 });
    // 2 saved + 2 downloadable shares (#1 none, #3 downloaded; #2 dropped as non-share).
    expect(stats.total).toBe(4);
    expect(stats.downloaded).toBe(2); // 1 saved + share #3
    expect(stats.remaining).toBe(2);
  });

  it("scopes targets by archive: shares plus that archive's saved items", async () => {
    // A Facebook archive's saved_items query returns [] (saved is Instagram-only),
    // so scoping by archive yields the same result the old service branch did —
    // only the not-yet-fetched share — without a service-specific code path.
    route({ query_share_rows: SHARES, query_saved_items: [] });

    const targets = await fetchDownloadTargets(2);

    expect(mockInvoke).toHaveBeenCalledWith("query_share_rows", { archiveId: 2 });
    expect(mockInvoke).toHaveBeenCalledWith("query_saved_items", { archiveId: 2, collection: null });
    expect(targets).toEqual([
      { source: "message", refId: 1, url: "https://www.instagram.com/reel/A/", slug: DM_SLUG },
    ]);
  });

  it("turns the active archive's saved items into targets", async () => {
    route({
      query_share_rows: [],
      query_saved_items: [
        {
          id: 7,
          url: "https://www.instagram.com/p/Z/",
          caption: "",
          saved_at: 0,
          collection_names: "[]",
          download_status: "none",
          local_path: null,
          thumb_path: null,
        },
      ],
    });

    const targets = await fetchDownloadTargets(1);

    expect(mockInvoke).toHaveBeenCalledWith("query_saved_items", { archiveId: 1, collection: null });
    expect(targets.some((t) => t.source === "saved" && t.refId === 7)).toBe(true);
  });
});
