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

describe("download stats/targets are service-scoped", () => {
  beforeEach(() => mockInvoke.mockReset());

  it("threads the service into both stat queries and combines counts", async () => {
    route({
      query_saved_download_stats: { total: 2, downloaded: 1, unavailable: 0 },
      query_share_rows: SHARES,
    });

    const stats = await fetchDownloadStats("facebook");

    expect(mockInvoke).toHaveBeenCalledWith("query_saved_download_stats", { service: "facebook" });
    expect(mockInvoke).toHaveBeenCalledWith("query_share_rows", { service: "facebook" });
    // 2 saved + 2 downloadable shares (#1 none, #3 downloaded; #2 dropped as non-share).
    expect(stats.total).toBe(4);
    expect(stats.downloaded).toBe(2); // 1 saved + share #3
    expect(stats.remaining).toBe(2);
  });

  it("Facebook targets skip saved items (Instagram-only) and scope shares", async () => {
    route({ query_share_rows: SHARES, query_saved_items: [] });

    const targets = await fetchDownloadTargets("facebook");

    expect(mockInvoke).toHaveBeenCalledWith("query_share_rows", { service: "facebook" });
    expect(mockInvoke.mock.calls.map((c) => c[0])).not.toContain("query_saved_items");
    // Only the not-yet-fetched downloadable share (#1); #2 non-share, #3 already done.
    expect(targets).toEqual([
      { source: "message", refId: 1, url: "https://www.instagram.com/reel/A/", slug: DM_SLUG },
    ]);
  });

  it("Instagram targets include saved items", async () => {
    route({ query_share_rows: SHARES, query_saved_items: [] });

    await fetchDownloadTargets("instagram");

    expect(mockInvoke.mock.calls.map((c) => c[0])).toContain("query_saved_items");
  });
});
