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
