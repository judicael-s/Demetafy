import { describe, it, expect, beforeEach, vi } from "vitest";
import { MergedArchiveReader, type EntryHeader } from "./archive.js";

// Fake multi-zip backend behind a `mock`-prefixed holder, so Vitest's hoisted
// `vi.mock` factory is allowed to reference it. `archive_read_text` echoes back
// `"<handle>:<name>"` so a test can prove which part actually served a read.
type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const mockInvokeImpl: { fn: InvokeFn } = {
  fn: () => Promise.reject(new Error("invoke not configured")),
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvokeImpl.fn(cmd, args),
}));

function backArchives(parts: Record<string, string[]>): void {
  const pathToHandle = new Map<string, number>();
  const handleToPath = new Map<number, string>();
  let nextHandle = 0;
  mockInvokeImpl.fn = (cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "archive_open": {
        const path = a.path as string;
        let h = pathToHandle.get(path);
        if (h === undefined) {
          h = ++nextHandle;
          pathToHandle.set(path, h);
          handleToPath.set(h, path);
        }
        return Promise.resolve(h);
      }
      case "archive_list_entries": {
        const path = handleToPath.get(a.handle as number);
        const names = path ? (parts[path] ?? []) : [];
        const entries: EntryHeader[] = names.map((fileName) => ({
          fileName,
          uncompressedSize: 1,
          compressedSize: 1,
        }));
        return Promise.resolve(entries);
      }
      case "archive_read_text":
        return Promise.resolve(`${a.handle as number}:${a.name as string}`);
      case "archive_close":
        return Promise.resolve(undefined);
      default:
        return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    }
  };
}

beforeEach(() => {
  mockInvokeImpl.fn = () => Promise.reject(new Error("invoke not configured"));
});

describe("MergedArchiveReader", () => {
  it("merges entries from all parts and dispatches reads to the owning part", async () => {
    backArchives({
      "part-1.zip": ["your_facebook_activity/messages/inbox/x/photos/1.jpg", "media/a.mp4"],
      "part-2.zip": ["your_facebook_activity/messages/inbox/x/message_1.json"],
    });
    const reader = await MergedArchiveReader.open(["part-1.zip", "part-2.zip"]);

    expect(reader.listEntries().map((e) => e.fileName).sort()).toEqual([
      "media/a.mp4",
      "your_facebook_activity/messages/inbox/x/message_1.json",
      "your_facebook_activity/messages/inbox/x/photos/1.jpg",
    ]);
    expect(reader.hasEntry("media/a.mp4")).toBe(true);
    expect(reader.hasEntry("nope.json")).toBe(false);

    // open order assigns handle 1 → part-1.zip, handle 2 → part-2.zip, so the
    // echoed prefix proves each read hit the part that actually holds the entry.
    expect(await reader.readEntryText("media/a.mp4")).toBe("1:media/a.mp4");
    expect(
      await reader.readEntryText("your_facebook_activity/messages/inbox/x/message_1.json"),
    ).toBe("2:your_facebook_activity/messages/inbox/x/message_1.json");
    await reader.close();
  });

  it("merges a realistically-split Meta archive and resolves every entry to its owning part", async () => {
    // Mirrors the real Meta split (CLAUDE.md gotcha #2): each part carries an 8-char
    // random suffix with NO part number or order, one logical thread is split
    // file-level across parts (its message JSON in one part, its photos + videos in two
    // OTHERS), and the set is cleanly partitioned. Parts are opened in a deliberately
    // non-sorted order to prove the merge never assumes filename ordering.
    const PART_META = "facebook-johndoe-2026-05-14-a1b2c3d4.zip"; // json / taxonomy
    const PART_PHOTOS = "facebook-johndoe-2026-05-14-9f8e7d6c.zip"; // a thread's photos
    const PART_VIDEOS = "facebook-johndoe-2026-05-14-0a1b2c3d.zip"; // same thread's videos
    const PART_MISC = "facebook-johndoe-2026-05-14-feedface.zip"; // unrelated media
    const THREAD = "your_facebook_activity/messages/inbox/alex_123";
    backArchives({
      [PART_META]: [
        "personal_information/profile_information/profile_information.json",
        `${THREAD}/message_1.json`,
        `${THREAD}/message_2.json`,
      ],
      [PART_PHOTOS]: [`${THREAD}/photos/a.jpg`, `${THREAD}/photos/b.jpg`],
      [PART_VIDEOS]: [`${THREAD}/videos/c.mp4`],
      [PART_MISC]: ["your_facebook_activity/posts/media/unrelated.jpg"],
    });

    // Supplied OUT of name order; a correct merge must not depend on ordering.
    const reader = await MergedArchiveReader.open([PART_VIDEOS, PART_META, PART_MISC, PART_PHOTOS]);

    // The union exposes every entry from every part.
    expect(reader.listEntries()).toHaveLength(7);
    expect(reader.hasEntry(`${THREAD}/message_1.json`)).toBe(true);
    expect(reader.hasEntry(`${THREAD}/photos/a.jpg`)).toBe(true);
    expect(reader.hasEntry(`${THREAD}/videos/c.mp4`)).toBe(true);

    // Handles are assigned in OPEN order (VIDEOS=1, META=2, MISC=3, PHOTOS=4), so the
    // echoed "<handle>:<name>" proves each read hit the part that actually holds it —
    // the one thread's JSON, photos, and videos each resolve to a DIFFERENT part.
    expect(await reader.readEntryText(`${THREAD}/message_1.json`)).toBe(
      `2:${THREAD}/message_1.json`,
    );
    expect(await reader.readEntryText(`${THREAD}/photos/a.jpg`)).toBe(`4:${THREAD}/photos/a.jpg`);
    expect(await reader.readEntryText(`${THREAD}/videos/c.mp4`)).toBe(`1:${THREAD}/videos/c.mp4`);
    expect(await reader.readEntryText("your_facebook_activity/posts/media/unrelated.jpg")).toBe(
      "3:your_facebook_activity/posts/media/unrelated.jpg",
    );

    await reader.close();
  });

  it("treats a single part exactly like a one-zip archive (the Instagram path)", async () => {
    backArchives({ "ig.zip": ["your_instagram_activity/saved/saved_posts.json"] });
    const reader = await MergedArchiveReader.open(["ig.zip"]);
    expect(reader.listEntries()).toHaveLength(1);
    expect(reader.hasEntry("your_instagram_activity/saved/saved_posts.json")).toBe(true);
    expect(await reader.readEntryText("your_instagram_activity/saved/saved_posts.json")).toBe(
      "1:your_instagram_activity/saved/saved_posts.json",
    );
    await reader.close();
  });

  it("rejects when one entry path appears in two parts (wrong file set selected)", async () => {
    backArchives({
      "a.zip": ["dup/x.json", "a-only.json"],
      "b.zip": ["dup/x.json"],
    });
    await expect(MergedArchiveReader.open(["a.zip", "b.zip"])).rejects.toThrow(/duplicate entry/i);
  });

  it("rejects a read for an entry in no part", async () => {
    backArchives({ "a.zip": ["a.json"] });
    const reader = await MergedArchiveReader.open(["a.zip"]);
    await expect(reader.readEntryText("missing.json")).rejects.toThrow(/not found/i);
    await reader.close();
  });

  it("throws on an empty path list", async () => {
    await expect(MergedArchiveReader.open([])).rejects.toThrow();
  });
});
