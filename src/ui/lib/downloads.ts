/**
 * App-wide download client singleton. The queue ITSELF lives in Rust now
 * (`src-tauri/src/downloader.rs`); this module wraps the thin TS mirror
 * (`createDownloadQueue`) with the app's settings getters and exposes the
 * `fillArchive` one-click helper plus the `checkYtdlp` sidecar probe. Imported by
 * the Saved view, the downloads dock, the media viewer, and the sidebar badge —
 * one shared mirror across the whole app.
 */
import { invoke } from "@tauri-apps/api/core";
import { createDownloadQueue } from "./download-queue";
import { fetchDownloadTargets } from "./queries";
import { getCookiesPath, getParallelism } from "./settings";

export const downloadQueue = createDownloadQueue({
  maxParallel: getParallelism,
  cookiesPath: getCookiesPath,
});

/** Sidecar probe result mirrored from Rust (`YtdlpStatus`): the running `--version`
 *  (null if the sidecar can't run), the version this build pins, and whether the
 *  running sidecar predates that pin. */
export interface YtdlpStatus {
  version: string | null;
  pinned: string;
  stale: boolean;
}

/** Probe the bundled yt-dlp sidecar (Rust spawns it). On any IPC failure, returns a
 *  not-found status rather than throwing, so Settings can render it directly. */
export async function checkYtdlp(): Promise<YtdlpStatus> {
  try {
    return await invoke<YtdlpStatus>("ytdlp_status");
  } catch {
    return { version: null, pinned: "", stale: false };
  }
}

/** Enqueue every not-yet-fetched, recoverable download for a one-click "complete
 *  my archive" background fetch. Scoped to one import when given (Instagram =
 *  saved + DM shares; Facebook = DM shares). Returns how many were queued. */
export async function fillArchive(archiveId?: number): Promise<number> {
  const targets = await fetchDownloadTargets(archiveId);
  downloadQueue.enqueue(targets);
  return targets.length;
}
