import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { startServer } from "./server.js";

// Static media fixtures dropped into a temp dir the server indexes at boot. The
// body is ASCII (MIME is decided by extension, never sniffed) so we can read it
// straight back and prove the bytes round-trip. `note.xyz` exercises the
// unknown-extension → application/octet-stream fallback.
const MEDIA: Record<string, { mime: string; body: string }> = {
  "clip.mp4": { mime: "video/mp4", body: "fake-mp4-bytes" },
  "photo.png": { mime: "image/png", body: "fake-png-bytes" },
  "note.xyz": { mime: "application/octet-stream", body: "mystery-bytes" },
};

let server: Server;
let base: string;
let mediaDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  // The server logs a startup banner to stdout — silence it so test output stays clean.
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  mediaDir = mkdtempSync(path.join(tmpdir(), "demetafy-viewer-"));
  for (const [name, { body }] of Object.entries(MEDIA)) {
    writeFileSync(path.join(mediaDir, name), body);
  }
  // Port 0 → OS assigns a free port; an in-memory DB gets a freshly migrated
  // (empty) schema, which is all the route smoke tests need.
  server = startServer({ port: 0, dbPath: ":memory:", mediaRoot: mediaDir });
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  base = `http://localhost:${port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
  rmSync(mediaDir, { recursive: true, force: true });
  logSpy.mockRestore();
});

describe("viewer server — media serving", () => {
  it("serves indexed media with the extension-mapped MIME type and exact bytes", async () => {
    for (const [name, { mime, body }] of Object.entries(MEDIA)) {
      const res = await fetch(`${base}/media/saved/${name}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(mime);
      expect(await res.text()).toBe(body);
    }
  });

  it("returns 404 for a media path that isn't on disk", async () => {
    // Guard the fetch with a timeout: if the stream-error path ever regresses to
    // writing headers twice, the response hangs instead of 404-ing — fail fast.
    const res = await fetch(`${base}/media/saved/missing.mp4`, {
      signal: AbortSignal.timeout(4000),
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  // The `/media/saved/` path-traversal guard (403) is intentionally NOT asserted
  // here: WHATWG `new URL()` normalizes `..` segments out of `pathname` before the
  // handler sees them, and leaves `%2e%2e` percent-encoded (so it resolves to a
  // literal filename inside mediaRoot). The guard is unreachable defense-in-depth
  // from the HTTP surface — exercising it would require calling internals we don't expose.
});

describe("viewer server — routing", () => {
  it("renders the overview at / on an empty index", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Overview");
  });

  it("renders every top-level route on an empty index without throwing", async () => {
    const routes = ["/saved", "/collections", "/threads", "/stories", "/reposts", "/posts"];
    const statuses = await Promise.all(
      routes.map(async (r) => [r, (await fetch(`${base}${r}`)).status] as const),
    );
    expect(statuses).toEqual(routes.map((r) => [r, 200] as const));
  });

  it("404s an unknown thread slug with a descriptive message", async () => {
    const res = await fetch(`${base}/thread/does-not-exist`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Thread not found: does-not-exist");
  });

  it("404s an unknown route", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});
