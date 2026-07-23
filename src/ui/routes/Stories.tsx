import { createMemo, createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { fetchStories, type Story } from '../lib/queries';
import { ArchiveImage, FramedVideoThumb, isVideoUri } from '../components/ArchiveMedia';
import { EmptyState } from '../components/EmptyState';
import { MediaReel } from '../components/MediaReel';
import { SkeletonGrid } from '../components/Skeleton';
import { vmediaUrl } from '../lib/media';
import { useApp } from '../state/app';
import { type ViewerItem } from '../state/viewer';
import PageHeader from '../components/PageHeader';
import { formatArchiveMonth, formatArchiveTimestamp } from '../lib/presentation';

function storyItems(list: Story[]): ViewerItem[] {
  return list.map((s) => ({
    key: `story:${s.createdAt}:${s.uri}`,
    kind: isVideoUri(s.uri) ? 'video' : 'image',
    src: vmediaUrl(s.uri),
    caption: s.title || undefined,
    timestampMs: s.createdAt,
    source: s.sourceApp === 'FB' ? 'Story · via Facebook' : 'Story',
    sourceRoute: { label: 'Stories', href: '/stories' },
  }));
}

function StoryCard(props: { story: Story; onOpen: () => void }): JSX.Element {
  const s = props.story;
  return (
    <button
      type="button"
      onClick={props.onOpen}
      class="block overflow-hidden rounded-xl border border-border bg-surface text-left transition-opacity hover:opacity-90"
    >
      <div class="relative aspect-[9/16] bg-surface-2">
        <Show
          when={isVideoUri(s.uri)}
          fallback={<ArchiveImage uri={s.uri} class="h-full w-full object-cover" />}
        >
          <FramedVideoThumb src={vmediaUrl(s.uri)} class="absolute inset-0" />
        </Show>
        <Show when={s.sourceApp === 'FB'}>
          <span class="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
            via Facebook
          </span>
        </Show>
      </div>
      <div class="p-2">
        <Show when={s.title}>
          <p class="line-clamp-2 text-sm text-ink">{s.title}</p>
        </Show>
        <p class="text-xs text-muted">{formatArchiveTimestamp(s.createdAt)}</p>
      </div>
    </button>
  );
}

export default function Stories(): JSX.Element {
  const app = useApp();
  const [stories] = createResource(
    () => app.activeArchiveId(),
    (id) => fetchStories(id ?? undefined),
  );

  const storyList = () => {
    if (stories.error) throw stories.error;
    return stories() ?? [];
  };

  const [reel, setReel] = createSignal<{ items: ViewerItem[]; index: number } | null>(null);
  const openGroup = (list: Story[], index: number): void => {
    setReel({ items: storyItems(list), index });
  };

  // Stories arrive newest-first; bucket consecutive ones by month label.
  const groups = createMemo(() => {
    const out: Array<{ label: string; items: Story[] }> = [];
    for (const s of storyList()) {
      const label = formatArchiveMonth(s.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(s);
      else out.push({ label, items: [s] });
    }
    return out;
  });

  return (
    <div class="flex h-full flex-col">
      <div class="shrink-0 px-8 pt-5">
        <PageHeader
          title="Stories"
          description={
            stories.loading
              ? 'Loading archived stories…'
              : `${storyList().length.toLocaleString()} archived stories`
          }
        />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        <Show
          when={!stories.loading}
          fallback={
            <SkeletonGrid
              tileClass="aspect-[9/16]"
              gridClass="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
            />
          }
        >
          <Show
            when={storyList().length > 0}
            fallback={
              <EmptyState
                icon="stories"
                title="No stories archived"
                hint="Stories you posted that Instagram kept in your archive will appear here."
              />
            }
          >
            <For each={groups()}>
              {(g) => (
                <section class="mb-8">
                  <h2 class="mb-3 text-sm font-medium text-muted">{g.label}</h2>
                  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    <For each={g.items}>
                      {(s, i) => <StoryCard story={s} onOpen={() => openGroup(g.items, i())} />}
                    </For>
                  </div>
                </section>
              )}
            </For>
          </Show>
        </Show>
      </div>

      <Show when={reel()}>
        {(r) => (
          <Portal>
            <div class="fixed inset-0 z-50 bg-black">
              <MediaReel
                items={r().items}
                startIndex={r().index}
                progress="segments"
                autoplay={app.autoplay()}
                resetKey={r().items[0]?.key ?? 'stories'}
                onClose={() => setReel(null)}
                onEnd={() => setReel(null)}
              />
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
}
