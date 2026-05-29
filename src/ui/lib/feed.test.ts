import { describe, expect, it } from "vitest";
import { feedItemToViewer, seededShuffle } from "./feed";
import type { FeedMediaItem } from "./queries";

const row = (over: Partial<FeedMediaItem> = {}): FeedMediaItem => ({
  source: "Story",
  kind: "image",
  uri: null,
  localPath: null,
  posterPath: null,
  caption: null,
  timestampMs: null,
  ...over,
});

describe("seededShuffle", () => {
  it("is deterministic for a given seed and a pure permutation", () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const a = seededShuffle(input, 42);
    const b = seededShuffle(input, 42);
    expect(a).toEqual(b);
    // Same multiset, different order than the input.
    expect([...a].sort((x, y) => x - y)).toEqual(input);
    expect(a).not.toEqual(input);
    // Does not mutate the input.
    expect(input).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it("changes order when the seed changes", () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    expect(seededShuffle(input, 1)).not.toEqual(seededShuffle(input, 2));
  });

  it("handles empty and single-element arrays", () => {
    expect(seededShuffle([], 1)).toEqual([]);
    expect(seededShuffle([7], 1)).toEqual([7]);
  });
});

describe("feedItemToViewer", () => {
  it("returns null when there is no resolvable media", () => {
    expect(feedItemToViewer(row())).toBeNull();
  });

  it("maps an in-zip entry to a vmedia src and carries metadata", () => {
    const v = feedItemToViewer(
      row({ uri: "stories/s.jpg", caption: "hi", source: "Story", timestampMs: 5 }),
    );
    expect(v).not.toBeNull();
    expect(v!.kind).toBe("image");
    expect(v!.src).toContain(encodeURIComponent("stories/s.jpg"));
    expect(v!.caption).toBe("hi");
    expect(v!.source).toBe("Story");
    expect(v!.timestampMs).toBe(5);
  });

  it("prefers a downloaded file (dmedia) over the in-zip entry and maps the poster", () => {
    const v = feedItemToViewer(
      row({
        kind: "video",
        uri: "ignored.mp4",
        localPath: "_dm/x.mp4",
        posterPath: "_dm/x.jpg",
      }),
    );
    expect(v!.src).toContain(encodeURIComponent("_dm/x.mp4"));
    expect(v!.src).not.toContain(encodeURIComponent("ignored.mp4"));
    expect(v!.poster).toContain(encodeURIComponent("_dm/x.jpg"));
  });

  it("normalizes null caption/timestamp to undefined", () => {
    const v = feedItemToViewer(row({ uri: "a.jpg" }));
    expect(v!.caption).toBeUndefined();
    expect(v!.timestampMs).toBeUndefined();
  });
});
