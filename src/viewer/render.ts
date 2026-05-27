/**
 * Server-rendered HTML for the Phase 0 viewer. No framework, no JS — just
 * template-literal functions that return strings. Phase 1 will replace this
 * with a real Solid.js/React + Tauri WebView setup; for now this proves the
 * data pipeline end-to-end without committing to a frontend stack.
 *
 * All user-supplied content (captions, names, URLs) MUST go through `esc()`.
 * Mojibake fix already happened at parse time, so what we render is real UTF-8.
 */

/** HTML-escape user content. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function fmtDateTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

export function layout(title: string, body: string, currentNav?: string): string {
  const navItems: Array<[string, string]> = [
    ['/', 'overview'],
    ['/saved', 'saved'],
    ['/collections', 'collections'],
    ['/threads', 'threads'],
    ['/stories', 'stories'],
    ['/reposts', 'reposts'],
    ['/posts', 'posts'],
  ];
  const nav = navItems
    .map(
      ([href, name]) =>
        `<a href="${href}" class="${name === currentNav ? 'active' : ''}">${name}</a>`,
    )
    .join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)} — Demetafy</title>
<style>
  :root { color-scheme: light dark; --accent: #5b21b6; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         margin: 0; line-height: 1.5; }
  header { display: flex; align-items: center; gap: 1.5rem; padding: 0.75rem 1.5rem;
           border-bottom: 1px solid #8884; }
  header h1 { margin: 0; font-size: 1.1rem; font-weight: 600; color: var(--accent); }
  nav { display: flex; gap: 1rem; }
  nav a { color: inherit; text-decoration: none; opacity: 0.7; font-size: 0.9rem; }
  nav a:hover, nav a.active { opacity: 1; font-weight: 600; }
  main { padding: 1.5rem; max-width: 1100px; margin: 0 auto; }
  h2 { font-size: 1.4rem; margin-top: 0; }
  h3 { font-size: 1.1rem; }
  a { color: var(--accent); }
  .muted { opacity: 0.6; font-size: 0.9rem; }
  .meta { font-size: 0.85rem; opacity: 0.7; }
  table { border-collapse: collapse; width: 100%; }
  td, th { padding: 0.4rem 0.6rem; text-align: left; border-bottom: 1px solid #8882; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1rem; }
  .card { padding: 0.75rem; border: 1px solid #8884; border-radius: 6px; }
  .card video, .card img { width: 100%; max-height: 320px; object-fit: cover;
                            border-radius: 4px; background: #0001; }
  .card .url { font-size: 0.75rem; word-break: break-all; opacity: 0.7; }
  .card .caption { font-size: 0.9rem; margin-top: 0.4rem;
                   display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
                   overflow: hidden; }
  .badge { display: inline-block; padding: 1px 6px; font-size: 0.7rem;
           background: #8884; border-radius: 3px; margin-right: 3px; }
  .pager { display: flex; gap: 0.75rem; justify-content: center; margin: 1.5rem 0; }
  .msg { padding: 0.5rem 0; border-top: 1px solid #8882; }
  .msg .who { font-weight: 600; }
  .msg .when { font-size: 0.75rem; opacity: 0.6; }
  .msg .body { margin-top: 0.2rem; white-space: pre-wrap; }
  .msg .media { font-size: 0.75rem; opacity: 0.6; }
  .msg .reactions { margin-top: 0.2rem; font-size: 0.85rem; }
  .stat { display: inline-block; min-width: 160px; margin-right: 1rem;
          padding: 0.6rem 1rem; border: 1px solid #8884; border-radius: 4px;
          margin-bottom: 0.5rem; }
  .stat .label { font-size: 0.75rem; opacity: 0.7; }
  .stat .value { font-size: 1.3rem; font-weight: 600; }
</style>
</head>
<body>
<header>
  <h1>Demetafy</h1>
  <nav>${nav}</nav>
</header>
<main>
${body}
</main>
</body>
</html>`;
}

export function pager(currentPage: number, totalPages: number, baseUrl: string): string {
  if (totalPages <= 1) return '';
  const parts: string[] = [];
  if (currentPage > 1) parts.push(`<a href="${baseUrl}?p=${currentPage - 1}">← prev</a>`);
  parts.push(`<span class="muted">page ${currentPage} of ${totalPages}</span>`);
  if (currentPage < totalPages) parts.push(`<a href="${baseUrl}?p=${currentPage + 1}">next →</a>`);
  return `<div class="pager">${parts.join('')}</div>`;
}
