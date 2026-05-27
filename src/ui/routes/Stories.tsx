import { createMemo, createResource, For, Show, type JSX } from "solid-js";
import { fetchStories, type Story } from "../lib/queries";
import { ArchiveImage, FramedVideoThumb, isVideoUri } from "../components/ArchiveMedia";
import { EmptyState } from "../components/EmptyState";
import { SkeletonGrid } from "../components/Skeleton";
import { vmediaUrl } from "../lib/media";
import { viewer, type ViewerItem } from "../state/viewer";

function monthLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long" });
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
        <Show when={s.sourceApp === "FB"}>
          <span class="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
            via Facebook
          </span>
        </Show>
      </div>
      <div class="p-2">
        <Show when={s.title}>
          <p class="line-clamp-2 text-sm text-ink">{s.title}</p>
        </Show>
        <p class="text-xs text-muted">{new Date(s.createdAt).toLocaleDateString()}</p>
      </div>
    </button>
  );
}

export default function Stories(): JSX.Element {
  const [stories] = createResource(fetchStories);

  const flat = (): Story[] => stories() ?? [];
  const viewerItems = createMemo<ViewerItem[]>(() =>
    flat().map((s) => ({
      kind: isVideoUri(s.uri) ? "video" : "image",
      src: vmediaUrl(s.uri),
      caption: s.title || undefined,
      timestampMs: s.createdAt,
    })),
  );
  const openAt = (s: Story): void => viewer.open(viewerItems(), flat().indexOf(s));

  // Stories arrive newest-first; bucket consecutive ones by month label.
  const groups = createMemo(() => {
    const out: Array<{ label: string; items: Story[] }> = [];
    for (const s of stories() ?? []) {
      const label = monthLabel(s.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(s);
      else out.push({ label, items: [s] });
    }
    return out;
  });

  return (
    <div class="flex h-full flex-col">
      <div class="shrink-0 border-b border-border px-8 py-5">
        <h1 class="text-2xl font-semibold tracking-tight">Stories</h1>
        <Show when={stories()}>
          <p class="mt-1 text-sm text-muted">{stories()!.length} archived</p>
        </Show>
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
            when={(stories()?.length ?? 0) > 0}
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
                    <For each={g.items}>{(s) => <StoryCard story={s} onOpen={() => openAt(s)} />}</For>
                  </div>
                </section>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  );
}
