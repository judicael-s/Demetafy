/**
 * Build a URL the WebView can fetch for a media entry inside the archive zip,
 * served by the `vmedia` URI scheme registered in `src-tauri/src/media.rs`.
 *
 * Mirrors Tauri's own `convertFileSrc` platform branching: on Windows custom
 * schemes are exposed as `http://<scheme>.localhost/`, elsewhere as
 * `<scheme>://localhost/`. The entry path is `encodeURIComponent`-encoded
 * (slashes become %2F); the Rust handler percent-decodes it back.
 */
let mediaService: string | null = null;

/**
 * Record the service whose archive `vmediaUrl` resolves against. Every browse surface
 * shows one service at a time, so the active service (set by app state on import and on
 * switch) tells the `vmedia` handler which logical archive a zip entry belongs to.
 * Without it the handler falls back to the newest archive, which serves the wrong
 * service's bytes once both Instagram and Facebook are imported.
 */
export function setMediaService(service: string | null): void {
  mediaService = service;
}

export function vmediaUrl(entryPath: string): string {
  const encoded = encodeURIComponent(entryPath);
  const path = mediaService ? `${encodeURIComponent(mediaService)}/${encoded}` : encoded;
  return navigator.userAgent.includes("Windows")
    ? `http://vmedia.localhost/${path}`
    : `vmedia://localhost/${path}`;
}

/**
 * Build a URL for a yt-dlp-downloaded file on disk, served by the `dmedia` scheme
 * (`src-tauri/src/downloads.rs`). Same Windows/other branching as `vmediaUrl`.
 * `relPath` is relative to the downloads root (`<collection-slug>/<id>.<ext>`).
 */
export function dmediaUrl(relPath: string): string {
  const encoded = encodeURIComponent(relPath);
  return navigator.userAgent.includes("Windows")
    ? `http://dmedia.localhost/${encoded}`
    : `dmedia://localhost/${encoded}`;
}
