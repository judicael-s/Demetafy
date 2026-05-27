/**
 * Presentation helpers shared by the Saved view and the downloads dock: how a
 * download status maps to a label/colour, the effective status (live queue state
 * wins over the persisted DB value), and the output-folder slug sanitizer.
 */
import type { DownloadStatus, QueueState } from "./download-queue";

export type EffStatus = DownloadStatus | "none";

/** Persisted DB status → queue-style status ('none' when never attempted). */
export function dbToStatus(dbStatus: string): EffStatus {
  switch (dbStatus) {
    case "downloaded":
      return "ok";
    case "login_walled":
      return "loginWalled";
    case "dead":
      return "dead";
    case "error":
      return "error";
    default:
      return "none";
  }
}

/**
 * Effective download status for a queue key: a live in-memory queue entry wins
 * over the persisted DB value. Callers build the key via `itemKey(source, id)`,
 * so this works for both saved items and DM-shared posts.
 */
export function effStatusFor(key: string, dbStatus: string, q: QueueState): EffStatus {
  return q.items[key]?.status ?? dbToStatus(dbStatus);
}

/** Best video playback path: the live queue result first, then the persisted value. */
export function effLocalPathFor(
  key: string,
  dbLocalPath: string | null,
  q: QueueState,
): string | null {
  return q.items[key]?.localPath ?? dbLocalPath;
}

/** Best poster path: the live queue result first, then the persisted value. */
export function effThumbPathFor(
  key: string,
  dbThumbPath: string | null,
  q: QueueState,
): string | null {
  return q.items[key]?.thumbPath ?? dbThumbPath;
}

export function isDownloaded(s: EffStatus): boolean {
  return s === "ok" || s === "skipped";
}

export function statusLabel(s: EffStatus): string {
  switch (s) {
    case "queued":
      return "Queued";
    case "running":
      return "Downloading";
    case "ok":
    case "skipped":
      return "Downloaded";
    case "loginWalled":
      return "Login required";
    case "dead":
      return "Unavailable";
    case "error":
      return "Failed";
    case "none":
      return "";
  }
}

/** Tailwind text colour for a status chip/dot. */
export function statusTone(s: EffStatus): string {
  switch (s) {
    case "ok":
    case "skipped":
      return "text-emerald-400";
    case "queued":
    case "running":
      return "text-accent";
    case "loginWalled":
      return "text-amber-400";
    case "error":
      return "text-red-400";
    case "dead":
    case "none":
      return "text-muted";
  }
}

/** Sanitize a collection name into a safe single-segment output folder slug. */
export function sanitizeSlug(name: string | undefined): string {
  if (!name) return "_saved";
  const s = name
    .replace(/[^\w-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return s.length > 0 ? s : "_saved";
}
