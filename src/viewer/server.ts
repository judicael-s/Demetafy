import { createServer, type Server } from 'node:http';
import { createReadStream, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { openDb } from '../storage/db.js';
import {
  getOverview,
  getSavedItems,
  getCollections,
  getThreads,
  getThreadBySlug,
  getStories,
  getReposts,
  getOwnPosts,
  type SavedItemRow,
  type ThreadSummary,
  type ThreadDetail,
} from './queries.js';
import { esc, fmtDate, fmtDateTime, layout, pager } from './render.js';

const PAGE_SIZE = 60;

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
};

/**
 * Walk the downloaded-media tree once at startup and build a {mediaId → relPath}
 * map. Lets the viewer link to playable local files without re-globbing per
 * request. Returns empty map if the dir doesn't exist (no downloads yet).
 */
function buildDownloadIndex(rootDir: string): Map<string, string> {
  const map = new Map<string, string>();
  function walk(dir: string, sub = ''): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e);
      const rel = sub ? `${sub}/${e}` : e;
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full, rel);
        } else {
          const id = e.includes('.') ? e.slice(0, e.lastIndexOf('.')) : e;
          map.set(id, rel);
        }
      } catch {
        /* unreadable — skip */
      }
    }
  }
  walk(rootDir);
  return map;
}

function extractIgId(url: string): string | null {
  const m = /\/(reel|p|tv)\/([^/?#]+)/i.exec(url);
  return m && m[2] ? m[2] : null;
}

// ──────────────────────────────────────────────────────────────────────────
// Page renderers (functions returning HTML strings)
// ──────────────────────────────────────────────────────────────────────────

function renderOverview(db: import('node:sqlite').DatabaseSync): string {
  const data = getOverview(db);
  const profileBlock = data.profile
    ? `
      <h3>Profile</h3>
      <div class="meta">
        <strong>${esc(data.profile.displayName)}</strong> (@${esc(data.profile.username)})
        ${data.profile.email ? ` · ${esc(data.profile.email)}` : ''}
        ${data.profile.countryCode ? ` · ${esc(data.profile.countryCode)}` : ''}
        ${data.profile.isPrivate ? ' · <span class="badge">Private</span>' : ''}
      </div>`
    : '';

  const statsBlock = Object.entries(data.counts)
    .map(
      ([k, n]) =>
        `<div class="stat"><div class="label">${esc(k)}</div><div class="value">${n.toLocaleString()}</div></div>`,
    )
    .join('');

  const archivesBlock = data.archives
    .map(
      (a) =>
        `<tr><td>${a.id}</td><td>${esc(a.service)}</td><td>${fmtDateTime(a.ingestedAt.getTime())}</td><td class="muted">${esc(a.sourcePath)}</td></tr>`,
    )
    .join('');

  return layout(
    'Overview',
    `
    <h2>Overview</h2>
    ${profileBlock}
    <h3>Content</h3>
    ${statsBlock}
    <h3>Archives</h3>
    <table>
      <thead><tr><th>#</th><th>Service</th><th>Ingested</th><th>Source</th></tr></thead>
      <tbody>${archivesBlock}</tbody>
    </table>`,
    'overview',
  );
}

function renderSaved(
  db: import('node:sqlite').DatabaseSync,
  downloads: Map<string, string>,
  url: URL,
): string {
  const collection = url.searchParams.get('collection') ?? undefined;
  const page = Math.max(1, parseInt(url.searchParams.get('p') ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { items, total } = getSavedItems(db, {
    limit: PAGE_SIZE,
    offset,
    ...(collection ? { collection } : {}),
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const cards = items.map((item) => renderSavedCard(item, downloads)).join('');
  const baseUrl = '/saved' + (collection ? `?collection=${encodeURIComponent(collection)}` : '');
  const headerSuffix = collection
    ? ` <span class="muted">filtered by collection <code>${esc(collection)}</code></span>`
    : '';

  return layout(
    'Saved',
    `
    <h2>Saved (${total.toLocaleString()})${headerSuffix}</h2>
    <div class="grid">${cards}</div>
    ${pager(page, totalPages, baseUrl)}`,
    'saved',
  );
}

function renderSavedCard(item: SavedItemRow, downloads: Map<string, string>): string {
  const id = extractIgId(item.url);
  const local = id ? downloads.get(id) : null;
  const player = local
    ? local.endsWith('.mp4') || local.endsWith('.webm') || local.endsWith('.mov')
      ? `<video controls preload="none" src="/media/saved/${esc(local)}"></video>`
      : `<img src="/media/saved/${esc(local)}" loading="lazy" alt="">`
    : `<div class="muted">not downloaded — <a href="${esc(item.url)}" target="_blank" rel="noopener">open on Instagram ↗</a></div>`;
  const tags = item.collections.map((c) => `<span class="badge">${esc(c)}</span>`).join(' ');
  return `
    <div class="card">
      ${player}
      <div class="meta">${fmtDate(item.savedAt.getTime())} ${tags}</div>
      <div class="url"><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.url)}</a></div>
      <div class="caption">${esc(item.caption)}</div>
    </div>`;
}

function renderCollections(db: import('node:sqlite').DatabaseSync): string {
  const cols = getCollections(db);
  const rows = cols
    .map(
      (c) =>
        `<tr>
          <td><a href="/saved?collection=${encodeURIComponent(c.name)}">${esc(c.name)}</a></td>
          <td>${c.itemCount.toLocaleString()}</td>
          <td class="muted">${esc(c.type ?? '')}</td>
          <td class="muted">${esc(c.privacy ?? '')}</td>
        </tr>`,
    )
    .join('');
  return layout(
    'Collections',
    `<h2>Collections (${cols.length})</h2>
     <table>
       <thead><tr><th>Name</th><th>Items</th><th>Type</th><th>Privacy</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>`,
    'collections',
  );
}

function renderThreads(db: import('node:sqlite').DatabaseSync, url: URL): string {
  const source = url.searchParams.get('source') ?? undefined;
  const page = Math.max(1, parseInt(url.searchParams.get('p') ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { threads, total } = getThreads(db, {
    limit: PAGE_SIZE,
    offset,
    ...(source ? { source } : {}),
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const sourceFilter = `
    <div class="meta" style="margin-bottom:0.75rem">
      <a href="/threads">all</a> ·
      <a href="/threads?source=inbox">inbox</a> ·
      <a href="/threads?source=message_requests">message_requests</a> ·
      <a href="/threads?source=broadcast">broadcast</a>
    </div>`;

  const selfName = getOverview(db).profile?.displayName ?? null;
  const rows = threads.map((t) => renderThreadRow(t, selfName)).join('');
  const baseUrl = '/threads' + (source ? `?source=${encodeURIComponent(source)}` : '');

  return layout(
    'Threads',
    `<h2>Threads (${total.toLocaleString()})</h2>
     ${sourceFilter}
     <table>
       <thead><tr><th>Last activity</th><th>Source</th><th>Participants</th><th>Messages</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>
     ${pager(page, totalPages, baseUrl)}`,
    'threads',
  );
}

function renderThreadRow(t: ThreadSummary, selfName: string | null): string {
  const date = t.lastMessageAt ? fmtDate(t.lastMessageAt.getTime()) : '-';
  const who = t.participants.filter((p) => p !== selfName).join(', ') || t.participants.join(', ');
  return `<tr>
    <td>${date}</td>
    <td><span class="badge">${esc(t.source)}</span></td>
    <td><a href="/thread/${encodeURIComponent(t.slug)}">${esc(who)}</a></td>
    <td>${t.messageCount.toLocaleString()}</td>
  </tr>`;
}

function renderThread(t: ThreadDetail): string {
  const messages = t.messages
    .map((m) => {
      const mediaTags: string[] = [];
      for (const u of m.media.audio) mediaTags.push(`<div class="media">[audio: ${esc(u)}]</div>`);
      for (const u of m.media.photos) mediaTags.push(`<div class="media">[photo: ${esc(u)}]</div>`);
      for (const u of m.media.videos) mediaTags.push(`<div class="media">[video: ${esc(u)}]</div>`);
      for (const u of m.media.gifs) mediaTags.push(`<div class="media">[gif: ${esc(u)}]</div>`);
      const reactions = m.reactions
        .map((r) => `${esc(r.reaction)} ${esc(r.actor)}`)
        .join(' · ');
      return `<div class="msg">
        <span class="who">${esc(m.sender)}</span>
        <span class="when">${fmtDateTime(m.timestampMs)}</span>
        <div class="body">${esc(m.content)}</div>
        ${mediaTags.join('')}
        ${reactions ? `<div class="reactions">${reactions}</div>` : ''}
      </div>`;
    })
    .join('');

  return layout(
    `Thread: ${t.thread.slug}`,
    `<h2>${esc(t.thread.title || t.thread.slug)}</h2>
     <div class="meta">
       <span class="badge">${esc(t.thread.source)}</span>
       ${esc(t.thread.participants.join(', '))} ·
       ${t.thread.messageCount.toLocaleString()} messages ·
       slug <code>${esc(t.thread.slug)}</code>
     </div>
     <div style="margin-top:1rem">${messages}</div>
     <div class="meta" style="margin-top:1.5rem">
       <a href="/threads">← all threads</a>
     </div>`,
    'threads',
  );
}

function renderStories(db: import('node:sqlite').DatabaseSync): string {
  const stories = getStories(db);
  const rows = stories
    .map(
      (s) =>
        `<tr>
          <td>${fmtDate(s.createdAt.getTime())}</td>
          <td>${esc(s.title || '')}</td>
          <td class="muted">${esc(s.sourceApp ?? '')}</td>
          <td class="muted"><code>${esc(s.uri)}</code></td>
        </tr>`,
    )
    .join('');
  return layout(
    'Stories',
    `<h2>Stories (${stories.length})</h2>
     <p class="muted">Story media is inside the archive zip — not playable in this Phase 0 viewer.</p>
     <table>
       <thead><tr><th>Date</th><th>Title</th><th>Source</th><th>URI in archive</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>`,
    'stories',
  );
}

function renderReposts(db: import('node:sqlite').DatabaseSync): string {
  const reposts = getReposts(db);
  const rows = reposts
    .map(
      (r) =>
        `<tr>
          <td>${fmtDate(r.repostedAt.getTime())}</td>
          <td>${r.source.ownerUsername ? `@${esc(r.source.ownerUsername)}` : esc(r.source.ownerName)}</td>
          <td><a href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.url)}</a></td>
          <td>${esc(r.source.caption.slice(0, 120))}${r.source.caption.length > 120 ? '…' : ''}</td>
        </tr>`,
    )
    .join('');
  return layout(
    'Reposts',
    `<h2>Reposts (${reposts.length})</h2>
     <table>
       <thead><tr><th>Date</th><th>Owner</th><th>URL</th><th>Caption</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>`,
    'reposts',
  );
}

function renderOwnPostsPage(db: import('node:sqlite').DatabaseSync): string {
  const posts = getOwnPosts(db);
  const rows = posts
    .map(
      (p) =>
        `<tr>
          <td><code>${esc(p.mediaId)}</code></td>
          <td>${esc(p.ext)}</td>
          <td>${(p.sizeBytes / 1024).toFixed(1)} KB</td>
          <td class="muted"><code>${esc(p.uri)}</code></td>
        </tr>`,
    )
    .join('');
  return layout(
    'Own posts',
    `<h2>Own posts (${posts.length})</h2>
     <p class="muted">
       Meta DYI 2026-05 omits the posts JSON index — captions, timestamps, locations,
       and tags are not recoverable from this archive. Only the raw media files
       are present, inside the archive zip (not playable here).
     </p>
     <table>
       <thead><tr><th>Media ID</th><th>Ext</th><th>Size</th><th>URI in archive</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>`,
    'posts',
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Server
// ──────────────────────────────────────────────────────────────────────────

export interface ServerOptions {
  port: number;
  dbPath: string;
  /** Where downloaded media lives. Served at `/media/saved/<rel>`. */
  mediaRoot: string;
}

export function startServer(opts: ServerOptions): Server {
  const db = openDb(opts.dbPath);
  const downloads = buildDownloadIndex(opts.mediaRoot);
  const absMediaRoot = path.resolve(opts.mediaRoot);

  const server = createServer((req, res) => {
    const send = (status: number, contentType: string, body: string | Buffer): void => {
      res.writeHead(status, { 'Content-Type': contentType });
      res.end(body);
    };
    const sendHtml = (body: string): void => send(200, 'text/html; charset=utf-8', body);
    const sendError = (status: number, msg: string): void =>
      send(status, 'text/plain; charset=utf-8', msg);

    try {
      const reqUrl = new URL(req.url ?? '/', `http://localhost:${opts.port}`);
      const pathname = reqUrl.pathname;

      if (pathname === '/') return sendHtml(renderOverview(db));
      if (pathname === '/saved') return sendHtml(renderSaved(db, downloads, reqUrl));
      if (pathname === '/collections') return sendHtml(renderCollections(db));
      if (pathname === '/threads') return sendHtml(renderThreads(db, reqUrl));
      if (pathname === '/stories') return sendHtml(renderStories(db));
      if (pathname === '/reposts') return sendHtml(renderReposts(db));
      if (pathname === '/posts') return sendHtml(renderOwnPostsPage(db));

      if (pathname.startsWith('/thread/')) {
        const slug = decodeURIComponent(pathname.slice('/thread/'.length));
        const t = getThreadBySlug(db, slug);
        if (!t) return sendError(404, `Thread not found: ${slug}`);
        return sendHtml(renderThread(t));
      }

      if (pathname.startsWith('/media/saved/')) {
        const rel = pathname.slice('/media/saved/'.length);
        // Resolve and ensure containment in mediaRoot — block path traversal.
        const full = path.resolve(absMediaRoot, rel);
        if (!full.startsWith(absMediaRoot + path.sep) && full !== absMediaRoot) {
          return sendError(403, 'Forbidden');
        }
        const ext = path.extname(full).slice(1).toLowerCase();
        const mime = MIME[ext] ?? 'application/octet-stream';
        const stream = createReadStream(full);
        stream.on('error', () => sendError(404, 'Not found'));
        res.writeHead(200, { 'Content-Type': mime });
        stream.pipe(res);
        return;
      }

      return sendError(404, 'Not found');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendError(500, `Error: ${msg}`);
    }
  });

  server.listen(opts.port, () => {
    console.log(`Demetafy viewer at http://localhost:${opts.port}`);
    console.log(`  db:    ${opts.dbPath}`);
    console.log(`  media: ${opts.mediaRoot} (${downloads.size} downloaded file(s) indexed)`);
    console.log(`  Ctrl+C to stop.`);
  });

  server.on('close', () => db.close());
  return server;
}
