import { describe, expect, it } from "vitest";
import { buildChatRows, dayLabel } from "./chat-grouping";
import type { ThreadMessage } from "./queries";

function mk(sender: string, timestampMs: number, id = timestampMs): ThreadMessage {
  return {
    id,
    sender,
    timestampMs,
    content: "",
    reactions: [],
    media: { audio: [], photos: [], videos: [], gifs: [], share: null },
    downloadStatus: "none",
    localPath: null,
    thumbPath: null,
  };
}

const isSelf = (s: string) => s === "me";
const DAY = 24 * 60 * 60 * 1000;
// A fixed weekday noon so day math is unambiguous regardless of the test host TZ.
const T0 = new Date(2026, 4, 14, 12, 0, 0).getTime();

describe("buildChatRows", () => {
  it("returns an empty array for no messages", () => {
    expect(buildChatRows([], isSelf)).toEqual([]);
  });

  it("marks the first message as both a day and run start", () => {
    const [row] = buildChatRows([mk("a", T0)], isSelf);
    expect(row).toMatchObject({ dayStart: true, runStart: true, self: false });
  });

  it("flags self messages via the predicate", () => {
    const rows = buildChatRows([mk("me", T0)], isSelf);
    expect(rows[0]!.self).toBe(true);
  });

  it("starts a new run when the sender changes within the gap", () => {
    const rows = buildChatRows([mk("a", T0), mk("b", T0 + 1000)], isSelf);
    expect(rows[1]!.runStart).toBe(true);
    expect(rows[1]!.dayStart).toBe(false);
  });

  it("continues a run for same sender within the gap", () => {
    const rows = buildChatRows([mk("a", T0), mk("a", T0 + 60_000)], isSelf);
    expect(rows[1]!.runStart).toBe(false);
  });

  it("breaks a run when the same sender exceeds the gap", () => {
    const rows = buildChatRows([mk("a", T0), mk("a", T0 + 6 * 60_000)], isSelf);
    expect(rows[1]!.runStart).toBe(true);
    expect(rows[1]!.dayStart).toBe(false);
  });

  it("marks a day start (and thus run start) when the calendar day rolls over", () => {
    const rows = buildChatRows([mk("a", T0), mk("a", T0 + DAY)], isSelf);
    expect(rows[1]!.dayStart).toBe(true);
    expect(rows[1]!.runStart).toBe(true);
  });

  it("respects a custom gap", () => {
    const rows = buildChatRows([mk("a", T0), mk("a", T0 + 2000)], isSelf, 1000);
    expect(rows[1]!.runStart).toBe(true);
  });
});

describe("dayLabel", () => {
  it("labels the same calendar day as Today", () => {
    expect(dayLabel(T0, T0 + 3 * 60_000)).toBe("Today");
  });

  it("labels the prior calendar day as Yesterday", () => {
    expect(dayLabel(T0 - DAY, T0)).toBe("Yesterday");
  });

  it("falls back to an absolute date for older messages", () => {
    const label = dayLabel(T0 - 30 * DAY, T0);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
    expect(label).toMatch(/2026/);
  });
});
