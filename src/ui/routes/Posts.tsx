import { createMemo, createResource, For, Show, type JSX } from "solid-js";
import { ArchiveImage, FramedVideoThumb, isVideoUri } from "../components/ArchiveMedia";
import { EmptyState } from "../components/EmptyState";
import { SkeletonGrid, SkeletonList } from "../components/Skeleton";
import { fetchOwnPosts, fetchPosts, type FacebookPost } from "../lib/queries";
import { vmediaUrl } from "../lib/media";
import { openExternal } from "../lib/external";
import { useApp } from "../state/app";
import { viewer, type ViewerItem } from "../state/viewer";

function fmtSize(bytes: number | null): string {
  if (bytes == null) return "";
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

function fmtDate(msOrSec: number | null): string {
  if (!msOrSec) return "";
  const ms = msOrSec < 10_000_000_000 ? msOrSec * 1000 : msOrSec;
  return new Date(ms).toLocaleString();
}

function mediaItem(uri: string, caption?: string, timestampMs?: number | null): ViewerItem {
  return {
    kind: isVideoUri(uri) ? "video" : "image",
    src: vmediaUrl(uri),
    caption,
    timestampMs: timestampMs ?? undefined,
  };
}

function FacebookPosts(): JSX.Element {
  const [posts] = createResource(() => fetchPosts("facebook"));

  const itemsFor = (post: FacebookPost): ViewerItem[] =>
    post.media.map((m) => mediaItem(m.uri, post.text || post.title, m.createdAt ?? post.createdAt));

  return (
    <div class="flex h-full flex-col">
      <div class="shrink-0 border-b border-border px-8 py-5">
        <h1 class="text-2xl font-semibold tracking-tight">Posts</h1>
        <Show when={posts()}>
          <p class="mt-1 text-sm text-muted">{posts()!.length} timeline posts</p>
        </Show>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        <Show when={!posts.loading} fallback={<SkeletonList rows={5} rowClass="h-40" />}>
          <Show
            when={(posts()?.length ?? 0) > 0}
            fallback={
              <EmptyState
                icon="posts"
                title="No timeline posts"
                hint="Your Facebook timeline posts will appear here."
              />
            }
          >
            <div class="space-y-4">
              <For each={posts()}>
                {(post) => {
                  const items = () => itemsFor(post);
                  return (
                    <article class="rounded-xl border border-border bg-surface p-4">
                      <div class="mb-3 text-xs text-muted">{fmtDate(post.createdAt)}</div>
                      <Show when={post.title}>
                        <h2 class="mb-2 text-sm font-medium text-ink">{post.title}</h2>
                      </Show>
                      <Show when={post.text}>
                        <p class="whitespace-pre-wrap text-sm leading-6 text-ink">{post.text}</p>
                      </Show>
                      <Show when={post.links.length > 0}>
                        <div class="mt-3 space-y-1">
                          <For each={post.links}>
                            {(link) => (
                              <a
                                class="block cursor-pointer truncate text-sm text-accent hover:underline"
                                href={link}
                                onClick={(e) => {
                                  e.preventDefault();
                                  openExternal(link);
                                }}
                              >
                                {link}
                              </a>
                            )}
                          </For>
                        </div>
                      </Show>
                      <Show when={post.media.length > 0}>
                        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                          <For each={post.media}>
                            {(m, i) => (
                              <button
                                type="button"
                                onClick={() => viewer.open(items(), i())}
                                class="relative block aspect-square overflow-hidden rounded-lg bg-surface-2 text-left transition-opacity hover:opacity-90"
                              >
                                <Show
                                  when={isVideoUri(m.uri)}
                                  fallback={<ArchiveImage uri={m.uri} class="h-full w-full object-cover" />}
                                >
                                  <FramedVideoThumb src={vmediaUrl(m.uri)} class="absolute inset-0" />
                                </Show>
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                    </article>
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

function InstagramPosts(): JSX.Element {
  const [posts] = createResource(fetchOwnPosts);

  const viewerItems = createMemo<ViewerItem[]>(() =>
    (posts() ?? []).map((p) => mediaItem(p.uri)),
  );

  return (
    <div class="flex h-full flex-col">
      <div class="shrink-0 border-b border-border px-8 py-5">
        <h1 class="text-2xl font-semibold tracking-tight">Posts</h1>
        <Show when={posts()}>
          <p class="mt-1 text-sm text-muted">{posts()!.length} recovered</p>
        </Show>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        <div class="mb-6 rounded-xl border border-dashed border-border bg-surface p-4 text-sm text-muted">
          Meta's 2026-05 “Download Your Information” export omits the posts index, so these media
          files were recovered directly from the archive — without captions, timestamps, or
          engagement counts.
        </div>

        <Show when={!posts.loading} fallback={<SkeletonGrid />}>
          <Show
            when={(posts()?.length ?? 0) > 0}
            fallback={
              <EmptyState
                icon="posts"
                title="No post media found"
                hint="Recovered media from your Instagram posts will appear here."
              />
            }
          >
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              <For each={posts()}>
                {(p, i) => (
                  <button
                    type="button"
                    onClick={() => viewer.open(viewerItems(), i())}
                    class="block overflow-hidden rounded-xl border border-border bg-surface text-left transition-opacity hover:opacity-90"
                  >
                    <div class="relative aspect-square bg-surface-2">
                      <Show
                        when={isVideoUri(p.uri)}
                        fallback={<ArchiveImage uri={p.uri} class="h-full w-full object-cover" />}
                      >
                        <FramedVideoThumb src={vmediaUrl(p.uri)} class="absolute inset-0" />
                      </Show>
                    </div>
                    <div class="p-2">
                      <p class="truncate font-mono text-xs text-muted">{p.mediaId}</p>
                      <p class="text-xs text-muted">
                        {p.ext?.toUpperCase()}
                        <Show when={p.sizeBytes != null}> · {fmtSize(p.sizeBytes)}</Show>
                      </p>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

export default function Posts(): JSX.Element {
  const app = useApp();
  return <Show when={app.activeService() === "facebook"} fallback={<InstagramPosts />}><FacebookPosts /></Show>;
}
