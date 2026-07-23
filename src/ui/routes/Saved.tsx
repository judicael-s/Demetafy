import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { A, useParams } from '@solidjs/router';
import { createVirtualizer } from '@tanstack/solid-virtual';
import { fetchCollections, fetchSavedItems, type SavedItem } from '../lib/queries';
import { downloadQueue } from '../lib/downloads';
import { itemKey } from '../lib/download-queue';
import { useApp } from '../state/app';
import {
  effLocalPathFor,
  effStatusFor,
  effThumbPathFor,
  isDownloaded,
  sanitizeSlug,
  statusLabel,
  statusTone,
} from '../lib/download-ui';
import { dmediaUrl } from '../lib/media';
import { PhoneFrame, createOrientation } from '../components/PhoneFrame';
import { EmptyState } from '../components/EmptyState';
import { SkeletonGrid } from '../components/Skeleton';
import { linkType, shortCode } from '../lib/links';
import { viewer, type ViewerItem } from '../state/viewer';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import { formatArchiveTimestamp } from '../lib/presentation';

// Image-first portrait tiles (4:5), Instagram-saved-grid style. Tile height is
// derived from the measured column width so the virtualizer row size and the card
// geometry stay in lockstep on resize.
const MIN_CARD_WIDTH = 200;
const GRID_GAP = 12; // px — must match the `gap-3` on each grid row
const TILE_RATIO = 5 / 4; // height / width (portrait)

function SavedCard(props: { item: SavedItem; onOpen: (i: SavedItem) => void }): JSX.Element {
  const { orientation, measure } = createOrientation();
  const key = () => itemKey('saved', props.item.id);
  const date = () => formatArchiveTimestamp(props.item.savedAt);
  const status = () => effStatusFor(key(), props.item.downloadStatus, downloadQueue.state);
  const thumb = () => effThumbPathFor(key(), props.item.thumbPath, downloadQueue.state);
  const local = () => effLocalPathFor(key(), props.item.localPath, downloadQueue.state);
  // Poster precedence: a fetched thumbnail image (cheap <img>) wins; otherwise fall
  // back to the downloaded video's first frame. yt-dlp's --write-thumbnail fails on
  // most Instagram reels, so the video frame is what gives most downloaded items a poster.
  const posterVideo = () => (!thumb() && isDownloaded(status()) ? local() : null);
  const hasPoster = () => !!thumb() || !!posterVideo();
  const isVideo = () =>
    !!posterVideo() || linkType(props.item.url) === 'Reel' || linkType(props.item.url) === 'IGTV';
  const chip = () => {
    const s = status();
    if (s === 'running') return `${Math.round(downloadQueue.state.items[key()]?.progress ?? 0)}%`;
    return statusLabel(s);
  };
  return (
    <button
      class="group relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-surface text-left transition-colors hover:border-accent focus:outline-none focus-visible:border-accent"
      onClick={() => props.onOpen(props.item)}
    >
      {/* Poster fills the tile: a fetched thumbnail image, else the downloaded video's first frame. */}
      <Show when={thumb()}>
        {(t) => (
          <img src={dmediaUrl(t())} alt="" class="absolute inset-0 h-full w-full object-cover" />
        )}
      </Show>
      <Show when={posterVideo()}>
        {(v) => (
          // `#t=0.1` seeks to the first decodable frame so it paints as a still poster
          // (no autoplay). dmedia serves Range requests, so only the opening bytes load.
          <PhoneFrame orientation={orientation()} compact fill class="absolute inset-0">
            <video
              src={`${dmediaUrl(v())}#t=0.1`}
              class="h-full w-full object-cover"
              preload="metadata"
              aria-hidden="true"
              onLoadedMetadata={(e) => measure(e.currentTarget)}
            />
          </PhoneFrame>
        )}
      </Show>

      {/* Top scrim keeps the badge/date legible over a bright poster. */}
      <Show when={hasPoster()}>
        <div class="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/55 to-transparent" />
      </Show>

      <div class="relative z-10 flex items-center gap-2 p-2.5 text-[11px]">
        <span
          class="rounded-md px-1.5 py-0.5 font-semibold uppercase tracking-wide"
          classList={{
            'bg-black/55 text-white backdrop-blur-sm': hasPoster(),
            'bg-surface-2 text-ink': !hasPoster(),
          }}
        >
          {linkType(props.item.url)}
        </span>
        <span classList={{ 'text-white/85': hasPoster(), 'text-muted': !hasPoster() }}>
          {date()}
        </span>
        <Show when={status() !== 'none'}>
          <span
            class="ml-auto rounded-md px-1.5 py-0.5 font-semibold"
            classList={{
              'bg-black/55 text-white backdrop-blur-sm': hasPoster(),
              'bg-surface-2': !hasPoster(),
              [statusTone(status())]: !hasPoster(),
            }}
          >
            {chip()}
          </span>
        </Show>
      </div>

      {/* Play affordance for video posters (reels/IGTV, or a downloaded video frame). */}
      <Show when={hasPoster() && isVideo()}>
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            class="h-11 w-11 fill-white/90 drop-shadow-lg transition-transform group-hover:scale-110"
            aria-hidden="true"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </Show>

      {/* Caption: a scrim strip over the poster, or plain text when there's no poster yet. */}
      <Show
        when={hasPoster()}
        fallback={
          <p class="relative z-10 line-clamp-6 flex-1 px-3 pb-3 text-sm text-ink">
            {props.item.caption || <span class="text-muted">@ {shortCode(props.item.url)}</span>}
          </p>
        }
      >
        <div class="relative z-10 mt-auto bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-2.5 pt-10">
          <p class="line-clamp-2 text-xs leading-snug text-white/95 drop-shadow group-hover:line-clamp-4">
            {props.item.caption || <span class="text-white/70">@ {shortCode(props.item.url)}</span>}
          </p>
        </div>
      </Show>
    </button>
  );
}

export default function Saved(): JSX.Element {
  const app = useApp();
  const params = useParams();
  const collection = () => (params.slug ? decodeURIComponent(params.slug) : undefined);

  const [items] = createResource(
    () => ({ id: app.activeArchiveId(), c: collection() }),
    ({ id, c }) => fetchSavedItems(id ?? undefined, c),
  );
  const [collections] = createResource(
    () => app.activeArchiveId(),
    (id) => fetchCollections(id ?? undefined),
  );

  let scrollEl!: HTMLDivElement;
  const [width, setWidth] = createSignal(0);

  onMount(() => {
    setWidth(Math.max(0, scrollEl.clientWidth - 64)); // px-8 = 32px each side; refined by RO below
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(scrollEl);
    onCleanup(() => ro.disconnect());
  });

  // Pack as many MIN_CARD_WIDTH tiles (with GRID_GAP between) as fit; the resulting
  // column width drives the 4:5 tile height the virtualizer uses for each row.
  const cols = createMemo(() =>
    Math.max(1, Math.floor((width() + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP))),
  );
  const tileHeight = createMemo(() => {
    const c = cols();
    const colWidth = (width() - GRID_GAP * (c - 1)) / c;
    return Math.max(0, Math.round(colWidth * TILE_RATIO));
  });

  const list = () => {
    if (items.error) throw items.error;
    return items() ?? [];
  };
  const collectionList = () => {
    if (collections.error) throw collections.error;
    return collections() ?? [];
  };
  const rowCount = createMemo(() => Math.ceil(list().length / cols()));

  const virtualizer = createVirtualizer({
    get count() {
      return rowCount();
    },
    getScrollElement: () => scrollEl,
    estimateSize: () => tileHeight() + GRID_GAP,
    overscan: 4,
  });

  createEffect(() => {
    tileHeight();
    virtualizer.measure();
  });

  const rowItems = (rowIndex: number) => {
    const c = cols();
    return list().slice(rowIndex * c, rowIndex * c + c);
  };

  const slugFor = (it: SavedItem): string => sanitizeSlug(collection() ?? it.collections[0]);

  // Saved items carry no `src` — the viewer resolves the effective media (or shows
  // the "Download to view" CTA + dwell auto-enqueue) from the live queue/DB.
  const viewerItems = createMemo<ViewerItem[]>(() =>
    list().map((it) => ({
      key: `saved:${it.id}`,
      kind: 'video',
      caption: it.caption || undefined,
      timestampMs: it.savedAt,
      openExternalUrl: it.url,
      sourceRoute: { label: 'Saved', href: '/saved' },
      download: {
        key: itemKey('saved', it.id),
        enqueue: () =>
          downloadQueue.enqueue([
            { source: 'saved', refId: it.id, url: it.url, slug: slugFor(it) },
          ]),
        dbStatus: it.downloadStatus,
        dbLocalPath: it.localPath,
        dbThumbPath: it.thumbPath,
      },
    })),
  );
  const openAt = (it: SavedItem): void => viewer.open(viewerItems(), list().indexOf(it));

  const downloadAll = () => {
    const slug = sanitizeSlug(collection());
    downloadQueue.enqueue(
      list().map((it) => ({ source: 'saved', refId: it.id, url: it.url, slug })),
    );
  };

  return (
    <div class="flex h-full flex-col">
      <div class="shrink-0 border-b border-border px-8 py-5">
        <PageHeader
          title="Saved"
          description="Posts and reels preserved from your saved collections."
          actions={
            <Show when={collection() && list().length > 0}>
              <Button variant="secondary" onClick={downloadAll}>
                Download all ({list().length})
              </Button>
            </Show>
          }
        />
        <div class="mt-4 flex flex-wrap gap-2">
          <A
            href="/saved"
            end
            class="rounded-full border border-border px-3 py-1 text-sm text-muted hover:text-ink"
            activeClass="!border-accent !bg-accent !text-accent-ink"
          >
            All
          </A>
          <For each={collectionList()}>
            {(c) => (
              <A
                href={`/saved/c/${encodeURIComponent(c.name)}`}
                class="rounded-full border border-border px-3 py-1 text-sm text-muted hover:text-ink"
                activeClass="!border-accent !bg-accent !text-accent-ink"
              >
                {c.name}
                <span class="ml-1.5 text-xs opacity-70">{c.itemCount}</span>
              </A>
            )}
          </For>
        </div>
      </div>

      <div ref={scrollEl} class="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        <Show when={!items.loading} fallback={<SkeletonGrid />}>
          <Show
            when={list().length > 0}
            fallback={
              <EmptyState
                icon="saved"
                title="Nothing saved here"
                hint="Posts and reels you saved on Instagram will show up in this collection."
              />
            }
          >
            <p class="mb-4 text-sm text-muted">{list().length.toLocaleString()} items</p>
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                position: 'relative',
                width: '100%',
              }}
            >
              <For each={virtualizer.getVirtualItems()}>
                {(vrow) => (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vrow.start}px)`,
                      height: `${tileHeight()}px`,
                    }}
                  >
                    <div
                      class="grid h-full gap-3"
                      style={{ 'grid-template-columns': `repeat(${cols()}, minmax(0, 1fr))` }}
                    >
                      <For each={rowItems(vrow.index)}>
                        {(item) => <SavedCard item={item} onOpen={openAt} />}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
