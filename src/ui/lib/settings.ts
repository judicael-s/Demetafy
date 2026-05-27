/**
 * Downloader settings, persisted in `localStorage` (same store as the theme
 * toggle). Deliberately NOT the Tauri store plugin — these are non-sensitive and
 * a local desktop app's localStorage is durable enough. The cookies *path* is a
 * string pointer the user opted into; cookie *contents* are never stored here.
 */

const PARALLEL_KEY = "demetafy-dl-parallel";
const COOKIES_KEY = "demetafy-cookies-path";
const FETCH_AVATARS_KEY = "demetafy-fetch-avatars";

/** Concurrent yt-dlp downloads, clamped 1–3. Default 1: Instagram 429s fast
 *  above one concurrent stream (Phase 0 finding). */
export function getParallelism(): number {
  const raw = Number.parseInt(localStorage.getItem(PARALLEL_KEY) ?? "1", 10);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(3, Math.max(1, raw));
}

export function setParallelism(n: number): void {
  localStorage.setItem(PARALLEL_KEY, String(Math.min(3, Math.max(1, Math.trunc(n)))));
}

/** Opt-in cookies.txt path for login-walled content. Undefined when unset. */
export function getCookiesPath(): string | undefined {
  const v = localStorage.getItem(COOKIES_KEY);
  return v && v.length > 0 ? v : undefined;
}

export function setCookiesPath(path: string | null): void {
  if (path && path.length > 0) localStorage.setItem(COOKIES_KEY, path);
  else localStorage.removeItem(COOKIES_KEY);
}

/** Opt-in: fetch friends' Instagram profile photos from the network. OFF by
 *  default — this is the one feature that calls Meta and uses the login cookies. */
export function getFetchAvatarsEnabled(): boolean {
  return localStorage.getItem(FETCH_AVATARS_KEY) === "1";
}

export function setFetchAvatarsEnabled(on: boolean): void {
  if (on) localStorage.setItem(FETCH_AVATARS_KEY, "1");
  else localStorage.removeItem(FETCH_AVATARS_KEY);
}
