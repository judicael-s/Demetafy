import { describe, it, expect } from "vitest";
import { buildFacebookPayload } from "./ingest.js";
import type { ArchiveReader, EntryHeader } from "./archive.js";

// Minimal in-memory ArchiveReader: a filename → JSON-text map. Lets us exercise
// the Facebook path discovery + payload mapping without the Tauri runtime.
class FakeReader implements ArchiveReader {
  private readonly files: Map<string, string>;
  constructor(files: Record<string, string>) {
    this.files = new Map(Object.entries(files));
  }
  listEntries(): EntryHeader[] {
    return [...this.files.keys()].map((fileName) => ({
      fileName,
      uncompressedSize: 0,
      compressedSize: 0,
    }));
  }
  hasEntry(name: string): boolean {
    return this.files.has(name);
  }
  readEntryText(name: string): Promise<string> {
    const v = this.files.get(name);
    if (v === undefined) return Promise.reject(new Error(`no entry ${name}`));
    return Promise.resolve(v);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

// Latin-1-over-UTF-8 mojibake for an accented "e" (U+00E9): its UTF-8 bytes
// C3 A9 arrive as the two codepoints U+00C3 U+00A9. Built via fromCharCode so the
// source stays pure ASCII (rendered/escaped non-ASCII can be mangled on write);
// fixMojibake must decode it back to U+00E9.
const CELIBATAIRE_MOJIBAKE = "C" + String.fromCharCode(0xc3, 0xa9) + "libataire";
const CELIBATAIRE_DECODED = "C" + String.fromCharCode(0xe9) + "libataire";

const FB_ROOT = "your_facebook_activity";

function fullArchive(): FakeReader {
  return new FakeReader({
    "personal_information/profile_information/profile_information.json": JSON.stringify({
      profile_v2: {
        name: { full_name: "Alex Rivera", first_name: "Alex", last_name: "Rivera" },
        emails: { emails: ["alex@example.com"] },
        birthday: { year: 1990, month: 1, day: 1 },
        gender: { gender_option: "MALE" },
        current_city: { name: "Paris" },
        hometown: { name: "Lyon" },
        relationship: { status: CELIBATAIRE_MOJIBAKE },
        previous_names: [{ name: "Alex S.", timestamp: 1000 }],
      },
    }),
    [`${FB_ROOT}/posts/your_posts__check_ins__photos_and_videos_1.json`]: JSON.stringify([
      {
        timestamp: 7,
        title: "Alex shared a link.",
        data: [{ post: "mon premier post" }],
        attachments: [
          {
            data: [
              { media: { uri: `${FB_ROOT}/posts/media/a.jpg`, creation_timestamp: 7 } },
              { external_context: { url: "https://example.com" } },
            ],
          },
        ],
      },
    ]),
    [`${FB_ROOT}/posts/album/0.json`]: JSON.stringify({
      name: "Vacances",
      description: "ete 2024",
      last_modified_timestamp: 9,
      cover_photo: { uri: `${FB_ROOT}/posts/media/cover.jpg` },
      photos: [{ uri: `${FB_ROOT}/posts/media/1.jpg`, creation_timestamp: 8, title: "plage" }],
    }),
    [`${FB_ROOT}/posts/your_uncategorized_photos.json`]: JSON.stringify({
      other_photos_v2: [{ uri: `${FB_ROOT}/posts/media/u1.jpg`, creation_timestamp: 3 }],
    }),
    "connections/friends/your_friends.json": JSON.stringify({
      friends_v2: [{ name: "Marie Curie", timestamp: 2000 }],
    }),
    // Apostrophe in the real filename; the FB_FOLLOWING_RE who_you* match dodges it.
    "connections/followers/who_you've_followed.json": JSON.stringify({
      following_v3: [{ name: "NASA", timestamp: 3000 }],
    }),
    [`${FB_ROOT}/messages/e2ee_cutover/42/message_1.json`]: JSON.stringify({
      participants: [{ name: "Alex" }, { name: "Bob" }],
      messages: [{ sender_name: "Alex", timestamp_ms: 5, content: "salut" }],
      title: "Crew",
      thread_path: "messages/e2ee_cutover/42",
      is_still_participant: true,
    }),
  });
}

describe("buildFacebookPayload", () => {
  it("assembles a Facebook payload from the verified DYI paths", async () => {
    const payload = await buildFacebookPayload(fullArchive(), "facebook-alex-2026", [
      "facebook-alex-2026-aa.zip",
      "facebook-alex-2026-bb.zip",
    ]);

    expect(payload.service).toBe("facebook");
    // D3: the group id is the idempotency key, carried straight through.
    expect(payload.sourcePath).toBe("facebook-alex-2026");
    expect(payload.partPaths).toHaveLength(2);

    // Instagram-only content stays empty for a Facebook archive.
    expect(payload.savedItems).toEqual([]);
    expect(payload.savedCollections).toEqual([]);
    expect(payload.stories).toEqual([]);
    expect(payload.reposts).toEqual([]);
    expect(payload.ownPosts).toEqual([]);
  });

  it("maps the Facebook profile (no handle) + decodes mojibake + folds previous names", async () => {
    const { profile, profileChanges } = await buildFacebookPayload(fullArchive(), "g", ["g"]);
    expect(profile).not.toBeNull();
    expect(profile?.username).toBe(""); // Facebook has no handle.
    expect(profile?.displayName).toBe("Alex Rivera");
    expect(profile?.email).toBe("alex@example.com");
    expect(profile?.isPrivate).toBe(false);
    expect(profile?.currentCity).toBe("Paris");
    expect(profile?.hometown).toBe("Lyon");
    expect(profile?.relationshipStatus).toBe(CELIBATAIRE_DECODED); // mojibake fixed
    expect(profile?.dateOfBirth).toBe("1990-01-01");

    expect(profileChanges).toEqual([
      { field: "name", previousValue: null, newValue: "Alex S.", changedAt: 1_000_000 },
    ]);
  });

  it("maps posts with media (ms) + external links", async () => {
    const { posts } = await buildFacebookPayload(fullArchive(), "g", ["g"]);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.text).toBe("mon premier post");
    expect(posts[0]!.createdAt).toBe(7000); // seconds → ms
    expect(JSON.parse(posts[0]!.media)).toEqual([
      { uri: `${FB_ROOT}/posts/media/a.jpg`, createdAt: 7000 },
    ]);
    expect(JSON.parse(posts[0]!.links)).toEqual(["https://example.com"]);
  });

  it("maps named albums and folds loose photos into an Uncategorized album", async () => {
    const { albums } = await buildFacebookPayload(fullArchive(), "g", ["g"]);
    expect(albums.map((a) => a.name)).toEqual(["Vacances", "Uncategorized"]);

    const vac = albums[0]!;
    expect(vac.photoCount).toBe(1);
    expect(vac.lastModified).toBe(9000);
    expect(JSON.parse(vac.photos)).toEqual([
      { uri: `${FB_ROOT}/posts/media/1.jpg`, createdAt: 8000, title: "plage", description: null },
    ]);

    const uncat = albums[1]!;
    expect(uncat.photoCount).toBe(1);
    expect(JSON.parse(uncat.photos)[0].createdAt).toBe(3000);
  });

  it("maps connections with name in username and an empty href (no profile link)", async () => {
    const { connections } = await buildFacebookPayload(fullArchive(), "g", ["g"]);
    expect(connections).toEqual([
      { kind: "friends", username: "Marie Curie", href: "", followedAt: 2_000_000 },
      { kind: "following", username: "NASA", href: "", followedAt: 3_000_000 },
    ]);
  });

  it("discovers Messenger threads under the Facebook category folders", async () => {
    const { threads } = await buildFacebookPayload(fullArchive(), "g", ["g"]);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.source).toBe("e2ee_cutover");
    expect(threads[0]!.slug).toBe("42");
    expect(threads[0]!.messages).toHaveLength(1);
    expect(threads[0]!.messages[0]!.content).toBe("salut");
  });

  it("is lenient when optional content files are absent", async () => {
    const reader = new FakeReader({
      [`${FB_ROOT}/messages/inbox/9/message_1.json`]: JSON.stringify({
        participants: [{ name: "A" }],
        messages: [{ sender_name: "A", timestamp_ms: 1, content: "hi" }],
        thread_path: "messages/inbox/9",
        is_still_participant: true,
      }),
    });
    const payload = await buildFacebookPayload(reader, "g", ["g"]);
    expect(payload.profile?.displayName).toBe(""); // no profile file → empty profile
    expect(payload.posts).toEqual([]);
    expect(payload.albums).toEqual([]);
    expect(payload.connections).toEqual([]);
    expect(payload.threads).toHaveLength(1);
    expect(payload.threads[0]!.source).toBe("inbox");
  });
});
