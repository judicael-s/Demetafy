import { createMemo, createResource, createSignal, Show, type JSX } from "solid-js";
import { fetchFeed } from "../lib/queries";
import { feedItemToViewer, seededShuffle } from "../lib/feed";
import { MediaReel } from "../components/MediaReel";
import { EmptyState } from "../components/EmptyState";
import { useApp } from "../state/app";
import type { ViewerItem } from "../state/viewer";

type Order = "shuffle" | "recent";

export default function Feed(): JSX.Element {
  const app = useApp();
  const [feed] = createResource(
    () => app.activeArchiveId(),
    (id) => fetchFeed(id ?? undefined),
  );
  const [order, setOrder] = createSignal<Order>("shuffle");
  const [seed, setSeed] = createSignal(1);

  const items = createMemo<ViewerItem[]>(() => {
    const mapped = (feed() ?? [])
      .map(feedItemToViewer)
      .filter((x): x is ViewerItem => x !== null);
    if (order() === "recent") {
      return mapped.slice().sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0));
    }
    return seededShuffle(mapped, seed());
  });

  const shuffle = (): void => {
    setOrder("shuffle");
    setSeed((s) => s + 1);
  };

  const tabClass = (active: boolean): string =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
      active ? "bg-accent text-accent-ink" : "text-white/70 hover:text-white"
    }`;

  return (
    <div class="relative h-full w-full bg-black">
      <Show
        when={!feed.loading}
        fallback={<div class="flex h-full items-center justify-center text-muted">Loading…</div>}
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
            <button type="button" class={tabClass(order() === "shuffle")} onClick={shuffle}>
              Shuffle
            </button>
            <button
              type="button"
              class={tabClass(order() === "recent")}
              onClick={() => setOrder("recent")}
            >
              Recent
            </button>
          </div>
        </Show>
      </Show>
    </div>
  );
}
