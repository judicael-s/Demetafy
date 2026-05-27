import { open as shellOpen } from "@tauri-apps/plugin-shell";

/**
 * Open a URL in the user's default browser — but only `http(s)`. Links rendered from
 * the archive (connection profiles, repost source URLs, post permalinks) are
 * attacker-influenced, so a `file://` or other-scheme value must never reach the OS
 * handler. Invalid or non-web URLs are silently ignored.
 *
 * Use this for any archive-derived URL. App-computed local paths (e.g. opening the
 * downloads folder in Settings) deliberately keep the raw `@tauri-apps/plugin-shell`
 * `open`, since they aren't web URLs.
 */
export function openExternal(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    void shellOpen(url).catch(() => undefined);
  }
}
