import { createSignal, For, Show, type JSX } from 'solid-js';
import { downloadQueue } from '../lib/downloads';
import { queueCounts, type DownloadItem } from '../lib/download-queue';
import { statusLabel, statusTone } from '../lib/download-ui';
import Button from './Button';
import Surface from './Surface';

function shortLabel(url: string): string {
  const m = /\/(?:p|reel|reels|tv)\/([^/?#]+)/.exec(url);
  return m?.[1] ?? 'Queued item';
}

// Recoverable failures worth a batch retry. `dead` (404/deleted) is excluded —
// it won't recover and would waste live requests; retry those individually.
const RETRYABLE: ReadonlySet<DownloadItem['status']> = new Set(['loginWalled', 'error']);

/** Bottom-right progress dock for the background download queue. Visible only
 *  while the queue has items; mounted once in the Shell so it spans all routes. */
export function DownloadsDock(): JSX.Element {
  const [collapsed, setCollapsed] = createSignal(false);
  const counts = () => queueCounts(downloadQueue.state);
  const rows = (): DownloadItem[] =>
    downloadQueue.state.order
      .map((id) => downloadQueue.state.items[id])
      .filter((it): it is DownloadItem => it !== undefined);
  const retryable = (): DownloadItem[] => rows().filter((it) => RETRYABLE.has(it.status));
  // A full-archive fill can queue thousands; only render a window so the dock
  // stays light. Running items sort first so progress is always visible.
  const VISIBLE = 40;
  const visibleRows = (): DownloadItem[] => {
    const all = rows();
    if (all.length <= VISIBLE) return all;
    const running = all.filter((it) => it.status === 'running' || it.status === 'queued');
    const rest = all.filter((it) => it.status !== 'running' && it.status !== 'queued');
    return [...running, ...rest].slice(0, VISIBLE);
  };

  // Re-queue every loginWalled/error item server-side (the Rust engine excludes
  // `dead`, matching RETRYABLE above). `retryable()` still drives the button label/count.
  const retryFailed = (): void => downloadQueue.retryFailed();

  return (
    <Show when={counts().total > 0}>
      <Surface
        as="div"
        class="fixed bottom-4 right-4 z-50 w-[min(20rem,calc(100vw-2rem))] overflow-hidden !p-0 shadow-xl"
      >
        <div class="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span class="text-sm font-medium text-ink">Downloads</span>
          <span class="text-xs text-muted">
            {counts().active > 0 ? `${counts().active} active` : `${counts().done} done`}
            {counts().failed > 0 ? ` · ${counts().failed} failed` : ''}
          </span>
          <div class="ml-auto flex items-center gap-1">
            <Show when={counts().active > 0}>
              <Button
                variant="danger"
                size="sm"
                title="Stop the queued downloads (in-flight ones finish)"
                onClick={() => downloadQueue.cancelAll()}
              >
                Stop
              </Button>
            </Show>
            <Show when={retryable().length > 0}>
              <Button variant="secondary" size="sm" onClick={retryFailed}>
                Retry failed ({retryable().length})
              </Button>
            </Show>
            <Show when={counts().active === 0}>
              <Button variant="ghost" size="sm" onClick={() => downloadQueue.clearFinished()}>
                Clear
              </Button>
            </Show>
            <Button
              variant="ghost"
              size="sm"
              class="!w-8 !px-0"
              aria-label={collapsed() ? 'Expand downloads' : 'Collapse downloads'}
              onClick={() => setCollapsed((c) => !c)}
            >
              <span aria-hidden="true">{collapsed() ? '▴' : '▾'}</span>
            </Button>
          </div>
        </div>
        <Show when={!collapsed()}>
          <ul class="max-h-72 overflow-y-auto">
            <For each={visibleRows()}>
              {(it) => (
                <li class="border-b border-border px-4 py-2 last:border-0">
                  <div class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                      {shortLabel(it.url)}
                    </span>
                    <span class={`shrink-0 text-[10px] font-medium ${statusTone(it.status)}`}>
                      {it.status === 'running'
                        ? `${Math.round(it.progress)}%`
                        : statusLabel(it.status)}
                    </span>
                  </div>
                  <Show when={it.status === 'running'}>
                    <div class="mt-1.5 h-1 overflow-hidden rounded bg-surface-2">
                      <div
                        class="h-full bg-accent transition-[width]"
                        style={{ width: `${it.progress}%` }}
                      />
                    </div>
                  </Show>
                </li>
              )}
            </For>
            <Show when={rows().length > VISIBLE}>
              <li class="px-4 py-2 text-center text-[10px] text-muted">
                + {(rows().length - VISIBLE).toLocaleString()} more in queue
              </li>
            </Show>
          </ul>
        </Show>
      </Surface>
    </Show>
  );
}
