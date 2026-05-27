import { createMemo, createResource, For, Show, type JSX } from "solid-js";
import { openExternal } from "../lib/external";
import { fetchReposts, type Repost } from "../lib/queries";
import { downloadQueue } from "../lib/downloads";
import { itemKey, REPOST_SLUG } from "../lib/download-queue";
import {
  effLocalPathFor,
  effStatusFor,
  effThumbPathFor,
  isDownloaded,
  statusLabel,
  statusTone,
} from "../lib/download-ui";
import { dmediaUrl } from "../lib/media";
import { ArchiveVideo, isVideoUri } from "../components/ArchiveMedia";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { isDownloadableShare } from "../lib/links";

function RepostCard(props: { repost: Repost }): JSX.Element {
  const r = () => props.repost;
  const owner = () => r().sourceOwnerName || r().sourceOwnerUsername || "Unknown";
  const key = () => itemKey("repost", r().id);
  const status = () => effStatusFor(key(), r().downloadStatus, downloadQueue.state);
  const live = () => downloadQueue.state.items[key()];
  const localPath = () => effLocalPathFor(key(), r().localPath, downloadQueue.state);
  const thumb = () => effThumbPathFor(key(), r().thumbPath, downloadQueue.state);
  const downloadable = () => isDownloadableShare(r().sourceUrl);
  const busy = () => status() === "queued" || status() === "running";
  const playable = () => isDownloaded(status()) && !!localPath();
  const buttonLabel = () => (busy() ? "Downloading…" : status() === "none" ? "Download" : "Retry");
  const enqueue = () =>
    downloadQueue.enqueue([
      { source: "repost", refId: r().id, url: r().sourceUrl, slug: REPOST_SLUG },
    ]);

  return (
    <article class="rounded-xl border border-border bg-surface p-4">
      <div class="flex items-baseline justify-between gap-3">
        <div class="min-w-0">
          <span class="font-medium text-ink">{owner()}</span>
          <Show when={r().sourceOwnerUsername}>
            <span class="ml-1.5 text-sm text-muted">@{r().sourceOwnerUsername}</span>
          </Show>
        </div>
        <span class="shrink-0 text-xs text-muted">
          {new Date(r().repostedAt).toLocaleDateString()}
        </span>
      </div>

      <Show when={r().userText}>
        <p class="mt-2 text-sm italic text-muted">{r().userText}</p>
      </Show>

      <Show when={r().sourceCaption}>
        <p class="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{r().sourceCaption}</p>
      </Show>

      {/* Once fetched, show the media inline — same treatment as the Saved view. */}
      <Show when={playable()}>
        <Show
          when={isVideoUri(localPath()!)}
          fallback={
            <div class="mt-3 overflow-hidden rounded-lg bg-black">
              <img src={dmediaUrl(localPath()!)} alt="" class="max-h-[28rem] w-full object-contain" />
            </div>
          }
        >
          <div class="mt-3">
            <ArchiveVideo
              src={dmediaUrl(localPath()!)}
              poster={thumb() ? dmediaUrl(thumb()!) : undefined}
              framed
              class="block max-h-[28rem] w-auto"
            />
          </div>
        </Show>
      </Show>

      {/* Download control for downloadable permalinks not yet fetched. */}
      <Show when={downloadable() && !playable()}>
        <div class="mt-3 flex items-center gap-2">
          <button
            class="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
            disabled={busy()}
            onClick={enqueue}
          >
            {buttonLabel()}
          </button>
          <Show when={status() === "running"}>
            <span class="text-xs text-accent">{Math.round(live()?.progress ?? 0)}%</span>
          </Show>
          <Show when={status() !== "none" && status() !== "running"}>
            <span class={`text-xs ${statusTone(status())}`}>{statusLabel(status())}</span>
          </Show>
        </div>
      </Show>

      <Show when={status() === "loginWalled"}>
        <p class="mt-1 text-[11px] text-muted">
          Needs a logged-in session — add a cookies file in Settings, then retry.
        </p>
      </Show>
      <Show when={status() === "error" && live()?.reason}>
        <p class="mt-1 break-words text-[11px] text-red-400">{live()?.reason}</p>
      </Show>

      <button
        class="mt-3 block max-w-full truncate text-left font-mono text-xs text-accent hover:underline"
        title={r().sourceUrl}
        onClick={() => openExternal(r().sourceUrl)}
      >
        {r().sourceUrl}
      </button>
    </article>
  );
}

export default function Reposts(): JSX.Element {
  const [reposts] = createResource(fetchReposts);

  // Count of downloadable reposts not yet fetched — drives the "Download all" label.
  const pending = createMemo(
    () =>
      (reposts() ?? []).filter(
        (r) =>
          isDownloadableShare(r.sourceUrl) &&
          !isDownloaded(
            effStatusFor(itemKey("repost", r.id), r.downloadStatus, downloadQueue.state),
          ),
      ).length,
  );
  const hasDownloadable = () => (reposts() ?? []).some((r) => isDownloadableShare(r.sourceUrl));

  const downloadAll = () => {
    downloadQueue.enqueue(
      (reposts() ?? [])
        .filter((r) => isDownloadableShare(r.sourceUrl))
        .map((r) => ({ source: "repost" as const, refId: r.id, url: r.sourceUrl, slug: REPOST_SLUG })),
    );
  };

  return (
    <div class="flex h-full flex-col">
      <div class="shrink-0 border-b border-border px-8 py-5">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h1 class="text-2xl font-semibold tracking-tight">Reposts</h1>
            <Show when={reposts()}>
              <p class="mt-1 text-sm text-muted">{reposts()!.length} shared</p>
            </Show>
          </div>
          <Show when={hasDownloadable()}>
            <button
              class="shrink-0 rounded-lg border border-border px-4 py-2 text-sm hover:border-accent disabled:opacity-40"
              disabled={pending() === 0}
              onClick={downloadAll}
            >
              {pending() > 0 ? `Download all (${pending()})` : "All downloaded"}
            </button>
          </Show>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        <Show
          when={!reposts.loading}
          fallback={
            <div class="mx-auto max-w-2xl">
              <SkeletonList rows={4} rowClass="h-40" />
            </div>
          }
        >
          <Show
            when={(reposts()?.length ?? 0) > 0}
            fallback={
              <EmptyState
                icon="reposts"
                title="No reposts yet"
                hint="Posts you reshared to your feed will appear here."
              />
            }
          >
            <div class="mx-auto flex max-w-2xl flex-col gap-3">
              <For each={reposts()}>{(r) => <RepostCard repost={r} />}</For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
