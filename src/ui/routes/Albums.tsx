import { createResource, For, Show, type JSX } from 'solid-js';
import { ArchiveImage, FramedVideoThumb, isVideoUri } from '../components/ArchiveMedia';
import { EmptyState } from '../components/EmptyState';
import { SkeletonGrid } from '../components/Skeleton';
import { fetchAlbums, type FacebookAlbum } from '../lib/queries';
import { vmediaUrl } from '../lib/media';
import { useApp } from '../state/app';
import { viewer, type ViewerItem } from '../state/viewer';
import PageHeader from '../components/PageHeader';
import Surface from '../components/Surface';
import { formatArchiveTimestamp } from '../lib/presentation';

function viewerItems(album: FacebookAlbum): ViewerItem[] {
  return album.photos.map((p, ordinal) => ({
    key: `album:${album.id}:${ordinal}`,
    kind: isVideoUri(p.uri) ? 'video' : 'image',
    src: vmediaUrl(p.uri),
    caption: p.description ?? p.title ?? album.name,
    timestampMs: p.createdAt ?? undefined,
    sourceRoute: { label: album.name || 'Album', href: '/albums' },
  }));
}

export default function Albums(): JSX.Element {
  const app = useApp();
  const [albums] = createResource(
    () => app.activeArchiveId(),
    (id) => fetchAlbums(id ?? undefined),
  );
  const albumList = () => {
    if (albums.error) throw albums.error;
    return albums() ?? [];
  };

  return (
    <div class="flex h-full flex-col">
      <div class="shrink-0 px-8 pt-5">
        <PageHeader
          title="Albums"
          description={
            albums.loading
              ? 'Loading photo albums…'
              : `${albumList().length.toLocaleString()} photo albums`
          }
        />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        <Show
          when={!albums.loading}
          fallback={
            <SkeletonGrid
              tiles={6}
              tileClass="aspect-video"
              gridClass="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
            />
          }
        >
          <Show
            when={albumList().length > 0}
            fallback={
              <EmptyState
                icon="albums"
                title="No photo albums"
                hint="Your Facebook photo albums will appear here."
              />
            }
          >
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <For each={albumList()}>
                {(album) => {
                  const items = () => viewerItems(album);
                  const cover = () => album.coverPhotoUri ?? album.photos[0]?.uri;
                  return (
                    <Surface as="div" class="overflow-hidden !p-0">
                      <button
                        type="button"
                        disabled={items().length === 0}
                        onClick={() => viewer.open(items(), 0)}
                        class="block w-full bg-surface-2 text-left transition-opacity enabled:hover:opacity-90 disabled:cursor-default"
                      >
                        <Show
                          when={cover()}
                          fallback={
                            <div class="flex aspect-video items-center justify-center text-sm text-muted">
                              No photos
                            </div>
                          }
                        >
                          {(uri) => (
                            <div class="relative aspect-video">
                              <Show
                                when={isVideoUri(uri())}
                                fallback={
                                  <ArchiveImage uri={uri()} class="h-full w-full object-cover" />
                                }
                              >
                                <FramedVideoThumb src={vmediaUrl(uri())} class="absolute inset-0" />
                              </Show>
                            </div>
                          )}
                        </Show>
                      </button>
                      <div class="p-4">
                        <h2 class="font-medium text-ink">{album.name || 'Untitled album'}</h2>
                        <p class="mt-1 text-xs text-muted">
                          {album.photoCount.toLocaleString()} photos
                          <Show when={album.lastModified}>
                            {' '}
                            · {formatArchiveTimestamp(album.lastModified)}
                          </Show>
                        </p>
                        <Show when={album.description}>
                          <p class="mt-3 line-clamp-3 text-sm leading-6 text-muted">
                            {album.description}
                          </p>
                        </Show>
                        <Show when={album.photos.length > 1}>
                          <div class="mt-3 grid grid-cols-5 gap-1">
                            <For each={album.photos.slice(0, 5)}>
                              {(photo, i) => (
                                <button
                                  type="button"
                                  onClick={() => viewer.open(items(), i())}
                                  class="relative block aspect-square overflow-hidden rounded bg-surface-2 transition-opacity hover:opacity-90"
                                >
                                  <Show
                                    when={isVideoUri(photo.uri)}
                                    fallback={
                                      <ArchiveImage
                                        uri={photo.uri}
                                        class="h-full w-full object-cover"
                                      />
                                    }
                                  >
                                    <FramedVideoThumb
                                      src={vmediaUrl(photo.uri)}
                                      class="absolute inset-0"
                                    />
                                  </Show>
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </Surface>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
