import { describe, it, expect, beforeEach, vi } from "vitest";
import { ingestArchive, IngestError, type IngestProgress } from "./ingest.js";
import type { EntryHeader } from "./archive.js";
import type { IngestCounts, IngestPayload } from "./db.js";

// One fake Tauri IPC boundary serves BOTH halves of the ingest pipeline: the
// `archive_*` calls behind `MergedArchiveReader` (so the real reader, real
// `detectArchiveType`, and the real parsers all run) and the terminal
// `ingest_write` (captured here instead of hitting Rust/SQLite). A `mock`-prefixed
// holder lets Vitest's hoisted `vi.mock` factory reference it.
type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const mockInvokeImpl: { fn: InvokeFn } = {
  fn: () => Promise.reject(new Error("invoke not configured")),
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvokeImpl.fn(cmd, args),
}));

const ZERO_COUNTS: IngestCounts = {
  savedItems: 0,
  savedCollections: 0,
  threads: 0,
  messages: 0,
  stories: 0,
  reposts: 0,
  ownPosts: 0,
  profileChanges: 0,
  connections: 0,
  posts: 0,
  albums: 0,
};

interface Backend {
  /** Every payload handed to `ingest_write`, in call order. */
  written: IngestPayload[];
}

/**
 * Wire the fake backend for a multi-part archive. `parts` maps each zip path to
 * its entry-name → file-text map; `archive_read_text` returns the real text, so
 * `MergedArchiveReader` genuinely resolves each entry to its owning part. The
 * returned handle records whatever `ingest_write` was given.
 */
function backArchives(parts: Record<string, Record<string, string>>): Backend {
  const pathToHandle = new Map<string, number>();
  const handleToPath = new Map<number, string>();
  let nextHandle = 0;
  const backend: Backend = { written: [] };

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
        const contents = path ? (parts[path] ?? {}) : {};
        const entries: EntryHeader[] = Object.entries(contents).map(([fileName, text]) => ({
          fileName,
          uncompressedSize: text.length,
          compressedSize: text.length,
        }));
        return Promise.resolve(entries);
      }
      case "archive_read_text": {
        const path = handleToPath.get(a.handle as number);
        const text = path ? parts[path]?.[a.name as string] : undefined;
        if (text === undefined) {
          return Promise.reject(new Error(`no entry ${String(a.name)} in handle ${String(a.handle)}`));
        }
        return Promise.resolve(text);
      }
      case "archive_close":
        return Promise.resolve(undefined);
      case "ingest_write": {
        backend.written.push(a.payload as IngestPayload);
        return Promise.resolve(ZERO_COUNTS);
      }
      default:
        return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    }
  };
  return backend;
}

const json = (value: unknown): string => JSON.stringify(value);

// Inverse of the parser's `fixMojibake`: re-encode clean UTF-8 text as the
// Latin-1-over-UTF-8 mojibake Meta actually emits (every UTF-8 byte becomes its
// own \u00XX codepoint). Lets fixtures state the CLEAN string and assert the
// round-trip, instead of hand-typing the invisible NBSP (0xA0) inside `à`.
const mojibake = (clean: string): string =>
  String.fromCharCode(...new TextEncoder().encode(clean));

beforeEach(() => {
  mockInvokeImpl.fn = () => Promise.reject(new Error("invoke not configured"));
});

describe("ingestArchive — orchestration", () => {
  it("merges a multi-part Facebook export and stitches one thread split across two parts", async () => {
    // Realistic Meta split (CLAUDE.md gotcha #2): random-suffix names with no part
    // order, content partitioned file-level across parts. The metadata part holds
    // the profile + posts + friends + the thread's FIRST message file; the second
    // part holds the album + following list + the SAME thread's SECOND message file
    // (plus inert media the ingest never reads). A correct merge must read each JSON
    // from whichever part owns it and stitch the one thread back together.
    const PART_META = "facebook-alex-2026-05-14-a1b2c3d4.zip";
    const PART_TWO = "facebook-alex-2026-05-14-9f8e7d6c.zip";
    const THREAD = "your_facebook_activity/messages/inbox/alex_rivera_abc";
    const threadHeader = {
      participants: [{ name: "Alex Rivera" }, { name: "Jamie Doe" }],
      title: "Alex Rivera",
      thread_path: "inbox/alex_rivera_abc",
      is_still_participant: true,
    };

    const backend = backArchives({
      [PART_META]: {
        "personal_information/profile_information/profile_information.json": json({
          profile_v2: {
            name: { full_name: "Alex Rivera", first_name: "Alex", last_name: "Rivera" },
            emails: { emails: ["alex@example.com"], previous_emails: [] },
          },
        }),
        "your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json": json([
          { timestamp: 1386163177, data: [{ post: mojibake("une pensée") }], title: "" },
        ]),
        "connections/friends/your_friends.json": json({
          friends_v2: [{ name: "Sylvain Michel", timestamp: 1764449837 }],
        }),
        // Older half of the thread.
        [`${THREAD}/message_1.json`]: json({
          ...threadHeader,
          messages: [
            { sender_name: "Alex Rivera", timestamp_ms: 1585821494606, content: mojibake("Je vais pas tarder à décale") },
          ],
        }),
      },
      [PART_TWO]: {
        "your_facebook_activity/posts/album/0.json": json({
          name: mojibake("Téléchargements depuis mobile"),
          photos: [{ uri: "your_facebook_activity/posts/media/a/1.jpg", creation_timestamp: 1284219696 }],
          cover_photo: { uri: "your_facebook_activity/posts/media/a/1.jpg" },
          last_modified_timestamp: 1284219696,
        }),
        "connections/followers/who_you've_followed.json": json({
          following_v3: [{ name: "Konbini", timestamp: 1725342735 }],
        }),
        // Newer half of the SAME thread, in a different part.
        [`${THREAD}/message_2.json`]: json({
          ...threadHeader,
          messages: [
            { sender_name: "Jamie Doe", timestamp_ms: 1585823006433, content: mojibake("ok à tout de suite") },
          ],
        }),
        // Inert media — present in the listing, never read during ingest.
        "your_facebook_activity/posts/media/a/1.jpg": "binary-noise",
      },
    });

    const phases: IngestProgress["phase"][] = [];
    // Supplied OUT of name order — a correct merge must not assume ordering.
    const paths = [PART_TWO, PART_META];
    const counts = await ingestArchive(paths, (p) => phases.push(p.phase));

    expect(counts).toEqual(ZERO_COUNTS); // came straight from the stubbed write
    expect(backend.written).toHaveLength(1);
    const payload = backend.written[0]!;

    expect(payload.service).toBe("facebook");
    // Multi-part → keyed on the shared service-user-date group id, not a part path.
    expect(payload.sourcePath).toBe("facebook-alex-2026-05-14");
    expect(payload.partPaths).toEqual(paths);

    expect(payload.profile?.displayName).toBe("Alex Rivera");
    expect(payload.posts.map((p) => p.text)).toEqual(["une pensée"]); // mojibake fixed
    expect(payload.albums.map((a) => a.name)).toContain("Téléchargements depuis mobile");

    // Friends came from PART_META, following from PART_TWO — both stitched in.
    expect(payload.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "friends", username: "Sylvain Michel" }),
        expect.objectContaining({ kind: "following", username: "Konbini" }),
      ]),
    );

    // The cross-part stitch: ONE thread, its two message files (one per part)
    // merged and sorted oldest-first, with mojibake repaired.
    expect(payload.threads).toHaveLength(1);
    const thread = payload.threads[0]!;
    expect(thread.slug).toBe("alex_rivera_abc");
    expect(thread.source).toBe("inbox");
    expect(thread.messages.map((m) => m.content)).toEqual([
      "Je vais pas tarder à décale",
      "ok à tout de suite",
    ]);

    expect(phases).toContain("opening");
    expect(phases).toContain("writing");
    expect(phases.at(-1)).toBe("done");
  });

  it("routes a single-part Instagram export to the Instagram builder and keys on its path", async () => {
    const IG_ZIP = "instagram-example_user-2026-05-14-yailYno5.zip";
    const backend = backArchives({
      [IG_ZIP]: {
        "personal_information/personal_information/personal_information.json": json({
          profile_user: [
            { string_map_data: { Username: { value: "example_user" }, Name: { value: "Example User" } } },
          ],
        }),
        "your_instagram_activity/saved/saved_posts.json": json([
          {
            timestamp: 1700000000,
            media: [],
            label_values: [
              { label: "URL", value: "https://www.instagram.com/reel/ABC/", href: "https://www.instagram.com/reel/ABC/" },
              { label: "Caption", value: mojibake("aimé") },
            ],
          },
        ]),
        "your_instagram_activity/messages/inbox/jamie_xyz/message_1.json": json({
          participants: [{ name: "Jamie" }, { name: "Example User" }],
          title: "Jamie",
          thread_path: "inbox/jamie_xyz",
          is_still_participant: true,
          messages: [{ sender_name: "Jamie", timestamp_ms: 1700000001000, content: "hi" }],
        }),
      },
    });

    await ingestArchive([IG_ZIP]);
    const payload = backend.written[0]!;

    expect(payload.service).toBe("instagram");
    expect(payload.sourcePath).toBe(IG_ZIP); // single part → keyed on its own path
    expect(payload.partPaths).toEqual([IG_ZIP]);
    expect(payload.profile?.username).toBe("example_user");
    expect(payload.savedItems).toEqual([
      expect.objectContaining({ url: "https://www.instagram.com/reel/ABC/", caption: "aimé" }),
    ]);
    expect(payload.threads).toHaveLength(1);
    expect(payload.threads[0]?.slug).toBe("jamie_xyz");
  });

  it("rejects an empty path list as a corrupt selection", async () => {
    await expect(ingestArchive([])).rejects.toMatchObject({
      name: "IngestError",
      code: "corrupt",
    });
  });

  it("wraps a failed archive open as a corrupt-archive error", async () => {
    mockInvokeImpl.fn = (cmd) =>
      cmd === "archive_open"
        ? Promise.reject(new Error("not a zip"))
        : Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    await expect(ingestArchive(["broken.zip"])).rejects.toMatchObject({ code: "corrupt" });
  });

  it("rejects an archive whose layout matches no supported service", async () => {
    backArchives({ "mystery.zip": { "random/data.json": "{}" } });
    await expect(ingestArchive(["mystery.zip"])).rejects.toMatchObject({ code: "not_instagram" });
  });

  it("rejects a Facebook export that is missing its metadata/taxonomy part", async () => {
    // Detects as Facebook (the activity prefix) but carries no taxonomy JSON — the
    // media-only-parts-without-the-metadata-zip case the import gate guards against.
    backArchives({ "fb-media-only.zip": { "your_facebook_activity/posts/media/p.jpg": "binary" } });
    const err = await ingestArchive(["fb-media-only.zip"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect((err as IngestError).code).toBe("partial_facebook");
  });
});
