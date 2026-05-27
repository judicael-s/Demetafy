import type { ThreadMessage } from "./queries";

/**
 * Per-message presentation flags for the thread view, computed once over the
 * (already filtered) message list so the virtualizer's index mapping stays 1:1.
 * `dayStart` drives a date separator; `runStart` drives sender label/avatar and
 * bubble-gap tightening for consecutive same-sender messages.
 */
export interface ChatRow {
  msg: ThreadMessage;
  self: boolean;
  dayStart: boolean;
  runStart: boolean;
}

const DEFAULT_GAP_MS = 5 * 60_000;

function sameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function buildChatRows(
  messages: ThreadMessage[],
  isSelf: (sender: string) => boolean,
  gapMs: number = DEFAULT_GAP_MS,
): ChatRow[] {
  const rows: ChatRow[] = new Array(messages.length);
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const prev = i > 0 ? messages[i - 1]! : undefined;
    const dayStart = !prev || !sameLocalDay(prev.timestampMs, msg.timestampMs);
    const runStart =
      dayStart ||
      !prev ||
      prev.sender !== msg.sender ||
      msg.timestampMs - prev.timestampMs > gapMs;
    rows[i] = { msg, self: isSelf(msg.sender), dayStart, runStart };
  }
  return rows;
}

/** Human label for a date separator: "Today" / "Yesterday" / "May 14, 2026". */
export function dayLabel(ms: number, now: number = Date.now()): string {
  if (sameLocalDay(ms, now)) return "Today";
  if (sameLocalDay(ms, now - 24 * 60 * 60 * 1000)) return "Yesterday";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
