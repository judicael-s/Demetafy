import { createMemo, createResource, For, Show, type JSX } from 'solid-js';
import { A, useSearchParams } from '@solidjs/router';
import { EmptyState } from '../components/EmptyState';
import { fetchSearch, type SearchResult } from '../lib/queries';
import { useApp } from '../state/app';
import PageHeader from '../components/PageHeader';
import { SkeletonList } from '../components/Skeleton';
import { formatArchiveTimestamp } from '../lib/presentation';

const KIND_LABEL: Record<string, string> = {
  message: 'Messages',
  saved: 'Saved',
  repost: 'Reposts',
};
// Conversations first (most often what someone is hunting for), then saved, then reposts.
const KIND_ORDER = ['message', 'saved', 'repost'];

function resultTitle(r: SearchResult): string {
  if (r.kind !== 'message') return r.kind === 'saved' ? 'Saved post' : 'Repost';
  if (r.title) return r.title;
  try {
    const names = JSON.parse(r.participants) as unknown;
    if (Array.isArray(names) && names.length > 0) return names.join(', ');
  } catch {
    /* malformed participants → fall back to the slug */
  }
  return r.slug ?? 'Conversation';
}

function resultHref(r: SearchResult): string {
  if (r.kind === 'message' && r.slug) return `/dms/${encodeURIComponent(r.slug)}`;
  return r.kind === 'saved' ? '/saved' : '/reposts';
}

export default function Search(): JSX.Element {
  const app = useApp();
  const [params] = useSearchParams();
  const query = (): string => {
    const raw = params.q;
    return (Array.isArray(raw) ? raw[0] : raw) ?? '';
  };

  const [results] = createResource(
    () => ({ q: query(), id: app.activeArchiveId() }),
    ({ q, id }) =>
      q.trim() ? fetchSearch(q, id ?? undefined) : Promise.resolve([] as SearchResult[]),
  );

  const resultList = () => {
    if (results.error) throw results.error;
    return results() ?? [];
  };

  const groups = createMemo(() => {
    const byKind = new Map<string, SearchResult[]>();
    for (const r of resultList()) {
      const arr = byKind.get(r.kind) ?? [];
      arr.push(r);
      byKind.set(r.kind, arr);
    }
    return KIND_ORDER.filter((k) => byKind.has(k)).map((k) => ({ kind: k, items: byKind.get(k)! }));
  });

  const total = (): number => resultList().length;

  return (
    <div class="flex h-full flex-col">
      <div class="shrink-0 px-8 pt-5">
        <PageHeader
          title="Search"
          description={
            !query()
              ? 'Search messages, saved posts, and reposts from the bar above.'
              : results.loading
                ? `Searching for “${query()}”…`
                : `${total().toLocaleString()} result${total() === 1 ? '' : 's'} for “${query()}”`
          }
        />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        <Show
          when={query()}
          fallback={
            <EmptyState
              icon="search"
              title="Search your archive"
              hint="Find anything across your messages, saved posts, and reposts."
            />
          }
        >
          <Show when={!results.loading} fallback={<SkeletonList rows={6} rowClass="h-20" />}>
            <Show
              when={total() > 0}
              fallback={
                <EmptyState
                  icon="search"
                  title="No matches"
                  hint={`Nothing matched “${query()}”. Try a different word.`}
                />
              }
            >
              <For each={groups()}>
                {(g) => (
                  <section class="mb-8">
                    <h2 class="mb-3 text-sm font-medium text-muted">
                      {KIND_LABEL[g.kind] ?? g.kind}
                      <span class="ml-1.5 text-xs opacity-70">{g.items.length}</span>
                    </h2>
                    <ul class="space-y-2">
                      <For each={g.items}>
                        {(r) => (
                          <li>
                            <A
                              href={resultHref(r)}
                              class="block rounded-lg border border-border bg-surface p-3 transition-colors hover:border-accent"
                            >
                              <div class="flex items-baseline justify-between gap-3">
                                <span class="truncate font-medium text-ink">{resultTitle(r)}</span>
                                <span class="shrink-0 text-xs text-muted">
                                  {formatArchiveTimestamp(r.timestamp, { explainMissing: true })}
                                </span>
                              </div>
                              <p class="mt-1 line-clamp-2 text-sm text-muted">
                                {r.snippet || <span class="italic">media</span>}
                              </p>
                            </A>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
