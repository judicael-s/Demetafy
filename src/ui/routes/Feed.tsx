import { createMemo, createResource, createSignal, Show, type JSX } from 'solid-js';
import { fetchFeed } from '../lib/queries';
import { feedItemToViewer, seededShuffle } from '../lib/feed';
import { MediaReel } from '../components/MediaReel';
import { EmptyState } from '../components/EmptyState';
import Button from '../components/Button';
import { SkeletonGrid } from '../components/Skeleton';
import { useApp } from '../state/app';
import type { ViewerItem } from '../state/viewer';

type Order = 'shuffle' | 'recent';

export default function Feed(): JSX.Element {
  const app = useApp();
  const [feed] = createResource(
    () => app.activeArchiveId(),
    (id) => fetchFeed(id ?? undefined),
  );
  const rows = () => {
    if (feed.error) throw feed.error;
    return feed() ?? [];
  };
  const [order, setOrder] = createSignal<Order>('shuffle');
  const [seed, setSeed] = createSignal(1);

  const items = createMemo<ViewerItem[]>(() => {
    const mapped = rows()
      .map(feedItemToViewer)
      .filter((x): x is ViewerItem => x !== null);
    if (order() === 'recent') {
      return mapped.slice().sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0));
    }
    return seededShuffle(mapped, seed());
  });

  const shuffle = (): void => {
    setOrder('shuffle');
    setSeed((s) => s + 1);
  };

  return (
    <div class="relative h-full w-full bg-bg">
      <Show
        when={!feed.loading}
        fallback={
          <div class="h-full p-4">
            <SkeletonGrid
              tiles={1}
              tileClass="h-full min-h-72"
              gridClass="mx-auto h-full max-w-xl"
            />
          </div>
        }
      >
        <Show
          when={items().length > 0}
          fallback={
            <div class="flex h-full items-center justify-center">
              <EmptyState
                icon="feed"
                title="Nothing to play yet"
                hint="Stories, posts, and conversation media appear here. Download saved posts and reposts to add them to the mix."
              />
            </div>
          }
        >
          <MediaReel items={items()} progress="single" />

          {/* Order toggle (small chips → flat bg-accent per branding) */}
          <div class="absolute left-3 top-3 z-30 flex gap-1 rounded-full bg-black/40 p-1">
            <Button
              variant={order() === 'shuffle' ? 'primary' : 'ghost'}
              size="sm"
              class={order() === 'shuffle' ? '' : '!text-white/80 hover:!text-white'}
              onClick={shuffle}
            >
              Shuffle
            </Button>
            <Button
              variant={order() === 'recent' ? 'primary' : 'ghost'}
              size="sm"
              class={order() === 'recent' ? '' : '!text-white/80 hover:!text-white'}
              onClick={() => setOrder('recent')}
            >
              Recent
            </Button>
          </div>
        </Show>
      </Show>
    </div>
  );
}
