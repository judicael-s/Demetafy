/**
 * Match a connection (follower/friend/etc.) to the DM threads you share with them.
 *
 * Facebook connections are real names, identical to the names stored in a thread's
 * `participants[]` — so the match is exact and reliable. Instagram connections are
 * `@handles` while participants are display names, so IG matches fuzzily on an
 * alphanumeric key ("john.doe" ~ "John Doe"). Many IG handles won't resolve to a
 * thread, which is expected; the UI only offers the affordance when something does.
 */
import type { Connection, ThreadSummary } from "./queries";

/** Collapse a name or @handle to a comparison key: lowercased alphanumerics only. */
export function connectionKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * All distinct participant keys across the given threads. Lets a caller answer
 * "does this connection appear in any conversation?" in O(1) instead of scanning
 * every thread per connection row.
 */
export function participantKeySet(threads: ThreadSummary[]): Set<string> {
  const keys = new Set<string>();
  for (const t of threads) {
    for (const p of t.participants) keys.add(connectionKey(p));
  }
  return keys;
}

/**
 * Threads that include the connection as a participant, best match first:
 * one-to-one conversations rank ahead of group threads, then most-recent first —
 * so "open your conversation with them" lands on the natural 1:1 when one exists.
 */
export function threadsForConnection(
  connection: Pick<Connection, "username">,
  threads: ThreadSummary[],
): ThreadSummary[] {
  const target = connectionKey(connection.username);
  if (!target) return [];
  return threads
    .filter((t) => t.participants.some((p) => connectionKey(p) === target))
    .sort((a, b) => {
      const aGroup = a.participants.length > 2 ? 1 : 0;
      const bGroup = b.participants.length > 2 ? 1 : 0;
      if (aGroup !== bGroup) return aGroup - bGroup;
      return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
    });
}
