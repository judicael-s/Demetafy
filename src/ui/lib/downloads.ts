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

/** Verify the bundled yt-dlp sidecar runs (Rust spawns it). Returns the trimmed
 *  `--version` string, or null on any failure. Surfaced in Settings. */
export async function checkYtdlp(): Promise<string | null> {
  try {
    return await invoke<string | null>("ytdlp_version");
  } catch {
    return null;
  }
}

/** Enqueue every not-yet-fetched, recoverable download for a one-click "complete
 *  my archive" background fetch. Scoped to one service when given (Instagram =
 *  saved + DM shares; Facebook = DM shares). Returns how many were queued. */
export async function fillArchive(service?: string): Promise<number> {
  const targets = await fetchDownloadTargets(service);
  downloadQueue.enqueue(targets);
  return targets.length;
}
