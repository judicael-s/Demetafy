import { describe, expect, it } from "vitest";
import { threadMediaItems } from "./thread-media";
import type { ThreadMessage } from "./queries";

function mk(over: Partial<ThreadMessage>): ThreadMessage {
  return {
    id: 1,
    sender: "a",
    timestampMs: 1000,
    content: "",
    reactions: [],
    media: { audio: [], photos: [], videos: [], gifs: [], share: null },
    downloadStatus: "none",
    localPath: null,
    thumbPath: null,
    ...over,
  };
}

describe("threadMediaItems", () => {
  it("returns nothing for messages without media", () => {
    expect(threadMediaItems([mk({ content: "hi" })])).toEqual([]);
  });

  it("flattens photos, gifs, and videos in chronological message order", () => {
    const items = threadMediaItems([
      mk({ id: 1, timestampMs: 1, media: { audio: [], photos: ["a.jpg"], videos: [], gifs: [], share: null } }),
      mk({ id: 2, timestampMs: 2, media: { audio: [], photos: [], videos: ["b.mp4"], gifs: ["c.gif"], share: null } }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["image", "image", "video"]);
    expect(items.map((i) => i.timestampMs)).toEqual([1, 2, 2]);
    expect(items[0]!.src).toContain(encodeURIComponent("a.jpg"));
    expect(items[2]!.src).toContain(encodeURIComponent("b.mp4"));
  });

  it("excludes audio", () => {
    const items = threadMediaItems([
      mk({ media: { audio: ["v.mp4"], photos: [], videos: [], gifs: [], share: null } }),
    ]);
    expect(items).toEqual([]);
  });

  it("includes a shared post only once it has been downloaded", () => {
    const undownloaded = mk({
      media: { audio: [], photos: [], videos: [], gifs: [], share: { link: "https://insta/p/x" } },
    });
    expect(threadMediaItems([undownloaded])).toEqual([]);

    const downloaded = mk({
      media: { audio: [], photos: [], videos: [], gifs: [], share: { link: "https://insta/p/x", shareText: "look" } },
      localPath: "_dm/x.mp4",
      thumbPath: "_dm/x.jpg",
    });
    const items = threadMediaItems([downloaded]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "video", caption: "look" });
    expect(items[0]!.src).toContain(encodeURIComponent("_dm/x.mp4"));
    expect(items[0]!.poster).toContain(encodeURIComponent("_dm/x.jpg"));
  });

  it("treats a downloaded image share as an image", () => {
    const items = threadMediaItems([
      mk({
        media: { audio: [], photos: [], videos: [], gifs: [], share: { link: "x" } },
        localPath: "_dm/x.jpg",
      }),
    ]);
    expect(items[0]!.kind).toBe("image");
  });
});
