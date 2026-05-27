import { describe, it, expect } from "vitest";
import { connectionKey, participantKeySet, threadsForConnection } from "./connection-threads";
import type { ThreadSummary } from "./queries";

const thread = (
  slug: string,
  participants: string[],
  lastMessageAt: number | null = 0,
): ThreadSummary => ({
  id: 0,
  slug,
  source: "inbox",
  title: "",
  participants,
  messageCount: participants.length,
  lastMessageAt,
  lastPreview: "",
  lastSender: "",
});

describe("connectionKey", () => {
  it("keeps only lowercased alphanumerics", () => {
    expect(connectionKey("Marie Curie")).toBe("mariecurie");
    expect(connectionKey("john.doe_99")).toBe("johndoe99");
    expect(connectionKey("  @JD!  ")).toBe("jd");
  });
});

describe("threadsForConnection", () => {
  it("matches a Facebook connection by exact name", () => {
    const threads = [
      thread("t1", ["Alex Rivera", "Marie Curie"]),
      thread("t2", ["Alex Rivera", "Someone Else"]),
    ];
    expect(threadsForConnection({ username: "Marie Curie" }, threads).map((t) => t.slug)).toEqual([
      "t1",
    ]);
  });

  it("matches an Instagram @handle to a display name fuzzily", () => {
    const threads = [thread("t1", ["Alex", "Marie Curie"])];
    expect(threadsForConnection({ username: "marie.curie" }, threads).map((t) => t.slug)).toEqual([
      "t1",
    ]);
  });

  it("returns [] when nothing matches or the username is empty", () => {
    const threads = [thread("t1", ["Alex", "Marie Curie"])];
    expect(threadsForConnection({ username: "nobody" }, threads)).toEqual([]);
    expect(threadsForConnection({ username: "" }, threads)).toEqual([]);
  });

  it("ranks 1:1 threads before groups, then most-recent first", () => {
    const threads = [
      thread("group-recent", ["Me", "Marie Curie", "Bob"], 5000),
      thread("dm-old", ["Me", "Marie Curie"], 1000),
      thread("dm-new", ["Me", "Marie Curie"], 3000),
      thread("group-old", ["Me", "Marie Curie", "Al"], 2000),
    ];
    expect(threadsForConnection({ username: "Marie Curie" }, threads).map((t) => t.slug)).toEqual([
      "dm-new",
      "dm-old",
      "group-recent",
      "group-old",
    ]);
  });
});

describe("participantKeySet", () => {
  it("collects distinct participant keys", () => {
    const set = participantKeySet([
      thread("t1", ["Marie Curie", "Alex"]),
      thread("t2", ["Marie Curie"]),
    ]);
    expect(set.has(connectionKey("marie.curie"))).toBe(true);
    expect(set.has("alex")).toBe(true);
    expect(set.has("nobody")).toBe(false);
    expect(set.size).toBe(2);
  });
});
