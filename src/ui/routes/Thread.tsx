import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  Show,
  Switch,
  type JSX,
} from "solid-js";
import { A, useParams } from "@solidjs/router";
import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  fetchSelfSender,
  fetchThread,
  type MsgMedia,
  type MsgReaction,
  type ThreadMessage,
} from "../lib/queries";
import { dmediaUrl, vmediaUrl } from "../lib/media";
import { ArchiveVideo, FramedVideoThumb, isVideoUri } from "../components/ArchiveMedia";
import { downloadQueue } from "../lib/downloads";
import { DM_SLUG, itemKey } from "../lib/download-queue";
import {
  effLocalPathFor,
  effStatusFor,
  effThumbPathFor,
  isDownloaded,
  statusLabel,
  statusTone,
} from "../lib/download-ui";
import { isDownloadableShare } from "../lib/links";
import { Avatar, avatarColor } from "../components/Avatar";
import { buildChatRows, dayLabel, type ChatRow } from "../lib/chat-grouping";
import { threadMediaItems } from "../lib/thread-media";
import { viewer, type ViewerItem } from "../state/viewer";
import { useApp } from "../state/app";

// Meta auto-inserts a standalone message when someone reacts; it duplicates the
// reaction already attached to the target message. Strings are English even in
// non-English archives, and the "Reacted" form carries a trailing space, so the
// pattern tolerates trailing whitespace. Extend if other locales surface.
const REACTION_PSEUDO_PATTERNS: RegExp[] = [/^Reacted .+ to your message\s*$/, /^Liked a message$/];

function isReactionPseudo(content: string): boolean {
  return REACTION_PSEUDO_PATTERNS.some((re) => re.test(content));
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function hasMedia(m: MsgMedia): boolean {
  return m.photos.length + m.videos.length + m.gifs.length + m.audio.length > 0;
}

// Meta writes "<name> sent an attachment." as the content of a media-only
// message; once we render the actual media that caption is redundant noise.
function isAttachmentNotice(content: string): boolean {
  return / sent an attachment\.?\s*$/.test(content);
}

function MediaItem(props: {
  uri: string;
  kind: "image" | "video" | "audio";
  onOpen?: () => void;
}): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  const url = () => vmediaUrl(props.uri);
  return (
    <Show
      when={!failed()}
      fallback={
        <span class="inline-block rounded border border-border/60 px-1.5 py-0.5 text-xs opacity-60">
          media unavailable
        </span>
      }
    >
      <Switch>
        <Match when={props.kind === "image"}>
          <button type="button" onClick={props.onOpen} class="block">
            <img
              src={url()}
              class="max-h-72 max-w-full rounded-lg"
              onError={() => setFailed(true)}
            />
          </button>
        </Match>
        <Match when={props.kind === "video"}>
          <button type="button" onClick={props.onOpen} class="relative block">
            <FramedVideoThumb src={url()} fill={false} class="block max-h-72 w-auto" />
          </button>
        </Match>
        <Match when={props.kind === "audio"}>
          <audio src={url()} controls class="w-full" onError={() => setFailed(true)} />
        </Match>
      </Switch>
    </Show>
  );
}

/** A square thumbnail in the per-thread media gallery; opens the shared viewer. */
function MediaTile(props: { item: ViewerItem; onOpen: () => void }): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  return (
    <button
      type="button"
      onClick={props.onOpen}
      class="relative block aspect-square overflow-hidden rounded-lg bg-surface-2 transition-opacity hover:opacity-90"
    >
      <Show
        when={!failed()}
        fallback={
          <div class="flex h-full w-full items-center justify-center text-xs text-muted">
            unavailable
          </div>
        }
      >
        <Show
          when={props.item.kind === "image"}
          fallback={
            <FramedVideoThumb
              src={props.item.src ?? ""}
              poster={props.item.poster}
              class="absolute inset-0"
            />
          }
        >
          <img
            src={props.item.src}
            alt=""
            loading="lazy"
            class="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        </Show>
      </Show>
    </button>
  );
}

function groupReactions(rs: MsgReaction[]): Array<{ reaction: string; actors: string[] }> {
  const map = new Map<string, string[]>();
  for (const r of rs) {
    const arr = map.get(r.reaction) ?? [];
    arr.push(r.actor);
    map.set(r.reaction, arr);
  }
  return [...map.entries()].map(([reaction, actors]) => ({ reaction, actors }));
}

/**
 * A post/reel shared into the thread. The share is a permalink (not extracted
 * media), so when it points at a downloadable post we offer the same yt-dlp
 * fetch as the Saved view — keyed by message id, played inline via dmedia once
 * downloaded. Non-downloadable links (profiles, external URLs) just show text.
 */
function SharedPost(props: { msg: ThreadMessage }): JSX.Element {
  const share = () => props.msg.media.share!;
  const key = () => itemKey("message", props.msg.id);
  const status = () => effStatusFor(key(), props.msg.downloadStatus, downloadQueue.state);
  const live = () => downloadQueue.state.items[key()];
  const localPath = () => effLocalPathFor(key(), props.msg.localPath, downloadQueue.state);
  const thumb = () => effThumbPathFor(key(), props.msg.thumbPath, downloadQueue.state);
  const downloadable = () => isDownloadableShare(share().link);
  const busy = () => status() === "queued" || status() === "running";
  const playable = () => isDownloaded(status()) && !!localPath();

  const buttonLabel = () => {
    if (busy()) return "Downloading…";
    if (status() === "none") return "Download";
    return "Retry";
  };

  const enqueue = () => {
    const link = share().link;
    if (link) {
      downloadQueue.enqueue([{ source: "message", refId: props.msg.id, url: link, slug: DM_SLUG }]);
    }
  };

  return (
    <div class="mt-1 rounded-lg border border-border/60 bg-bg/40 p-2 text-sm">
      <Show when={share().shareText}>
        <p class="whitespace-pre-wrap break-words">{share().shareText}</p>
      </Show>

      <Show when={playable()}>
        <Show
          when={isVideoUri(localPath()!)}
          fallback={
            <div class="mt-1 overflow-hidden rounded-md bg-black">
              <img src={dmediaUrl(localPath()!)} alt="" class="max-h-72 w-full object-contain" />
            </div>
          }
        >
          <div class="mt-1">
            <ArchiveVideo
              src={dmediaUrl(localPath()!)}
              poster={thumb() ? dmediaUrl(thumb()!) : undefined}
              framed
              class="block max-h-72 w-auto"
            />
          </div>
        </Show>
      </Show>

      <Show when={share().link}>
        <p class="mt-1 break-all font-mono text-xs opacity-70">{share().link}</p>
      </Show>

      <Show when={downloadable() && !playable()}>
        <div class="mt-1.5 flex items-center gap-2">
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
    </div>
  );
}

function DaySeparator(props: { ts: number }): JSX.Element {
  return (
    <div class="flex justify-center py-2">
      <span class="rounded-full bg-surface px-3 py-0.5 text-[11px] font-medium text-muted">
        {dayLabel(props.ts)}
      </span>
    </div>
  );
}

function MessageBubble(props: {
  row: ChatRow;
  group: boolean;
  openMedia: (uri: string) => void;
}): JSX.Element {
  const m = () => props.row.msg;
  const self = () => props.row.self;
  const runStart = () => props.row.runStart;
  const reactions = createMemo(() => groupReactions(m().reactions));
  const showText = () => m().content && !(hasMedia(m().media) && isAttachmentNotice(m().content));
  // Per-bubble avatars/labels are group-chat only; in a 1:1 the other person is
  // the same every time, so they'd be redundant noise (IG-style).
  const groupIncoming = () => props.group && !self();

  return (
    <>
      <Show when={props.row.dayStart}>
        <DaySeparator ts={m().timestampMs} />
      </Show>
      <div class="px-1 pb-0.5" classList={{ "pt-1.5": runStart(), "pt-0.5": !runStart() }}>
        <div class="flex gap-2">
          <Show when={groupIncoming()}>
            <div class="w-7 shrink-0">
              <Show when={runStart()}>
                <Avatar name={m().sender} class="size-7 text-[10px]" />
              </Show>
            </div>
          </Show>
          <div
            class="flex min-w-0 flex-1 flex-col"
            classList={{ "items-end": self(), "items-start": !self() }}
          >
            <Show when={groupIncoming() && runStart()}>
              <span
                class="mb-0.5 ml-1 text-xs font-medium"
                style={{ color: avatarColor(m().sender) }}
              >
                {m().sender}
              </span>
            </Show>
            <div
              class="max-w-[75%] rounded-2xl px-3.5 py-2"
              classList={{
                "bg-accent text-accent-ink": self(),
                "bg-surface text-ink": !self(),
              }}
            >
              <Show when={showText()}>
                <p class="whitespace-pre-wrap break-words text-sm">{m().content}</p>
              </Show>

              <Show when={m().media.share}>
                <SharedPost msg={m()} />
              </Show>

              <Show when={hasMedia(m().media)}>
                <div class="mt-1 flex flex-col gap-1.5">
                  <For each={m().media.photos}>
                    {(u) => <MediaItem uri={u} kind="image" onOpen={() => props.openMedia(u)} />}
                  </For>
                  <For each={m().media.gifs}>
                    {(u) => <MediaItem uri={u} kind="image" onOpen={() => props.openMedia(u)} />}
                  </For>
                  <For each={m().media.videos}>
                    {(u) => <MediaItem uri={u} kind="video" onOpen={() => props.openMedia(u)} />}
                  </For>
                  <For each={m().media.audio}>{(u) => <MediaItem uri={u} kind="audio" />}</For>
                </div>
              </Show>

              <div class="mt-1 text-[10px] opacity-60">{fmtTime(m().timestampMs)}</div>
            </div>

            <Show when={reactions().length > 0}>
              <div
                class="mt-1 flex flex-wrap gap-1"
                classList={{ "mr-1": self(), "ml-1": !self() }}
              >
                <For each={reactions()}>
                  {(r) => (
                    <span
                      class="rounded-full border border-border bg-surface px-1.5 py-0.5 text-xs"
                      title={r.actors.join(", ")}
                    >
                      {r.reaction}
                      <Show when={r.actors.length > 1}>
                        <span class="ml-0.5 opacity-70">{r.actors.length}</span>
                      </Show>
                    </span>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Thread(): JSX.Element {
  const params = useParams();
  const app = useApp();
  const slug = () => decodeURIComponent(params.slug ?? "");

  const [detail] = createResource(
    () => ({ s: slug(), id: app.activeArchiveId() }),
    ({ s, id }) => fetchThread(s, id ?? undefined),
  );
  const [selfSender] = createResource(
    () => app.activeArchiveId(),
    (id) => fetchSelfSender(id ?? undefined),
  );

  const [search, setSearch] = createSignal("");
  const [hidePseudo, setHidePseudo] = createSignal(false);
  const [atBottom, setAtBottom] = createSignal(true);
  const [view, setView] = createSignal<"messages" | "media">("messages");

  const selfNames = createMemo(() => {
    const set = new Set<string>();
    const s = selfSender();
    if (s) set.add(s);
    const p = app.profile();
    if (p?.display_name) set.add(p.display_name);
    if (p?.username) set.add(p.username);
    return set;
  });
  const isSelf = (sender: string) => selfNames().has(sender);

  // Group chats (3+ participants) get sender labels on incoming bubbles.
  const isGroup = createMemo(() => (detail()?.thread.participants.length ?? 0) > 2);

  const visible = createMemo(() => {
    const d = detail();
    if (!d) return [] as ThreadMessage[];
    let msgs = d.messages;
    if (hidePseudo()) msgs = msgs.filter((m) => !isReactionPseudo(m.content));
    const q = search().trim().toLowerCase();
    if (q) msgs = msgs.filter((m) => m.content.toLowerCase().includes(q));
    return msgs;
  });

  // Presentation flags (date separators, sender runs) computed once, parallel
  // to `visible()` so the virtualizer's index mapping stays 1:1.
  const rows = createMemo(() => buildChatRows(visible(), isSelf));

  // All thread media flattened once, for the gallery + inline bubble taps; a
  // tapped item opens the shared viewer at its position (matched by resolved src).
  const threadItems = createMemo(() => threadMediaItems(detail()?.messages ?? []));
  const openMedia = (uri: string): void => {
    const src = vmediaUrl(uri);
    const idx = threadItems().findIndex((i) => i.src === src);
    if (idx >= 0) viewer.open(threadItems(), idx);
  };

  // Downloadable posts/reels shared in THIS conversation (whole thread, not just the
  // filtered view) — powers the "download the whole conversation's shares" action.
  const shareTargets = createMemo(() =>
    (detail()?.messages ?? []).filter((m) => isDownloadableShare(m.media.share?.link)),
  );
  const pendingShares = createMemo(
    () =>
      shareTargets().filter(
        (m) =>
          !isDownloaded(effStatusFor(itemKey("message", m.id), m.downloadStatus, downloadQueue.state)),
      ).length,
  );
  const downloadAllShares = (): void => {
    downloadQueue.enqueue(
      shareTargets().map((m) => ({
        source: "message" as const,
        refId: m.id,
        url: m.media.share!.link!,
        slug: DM_SLUG,
      })),
    );
  };

  let scrollEl!: HTMLDivElement;
  const virtualizer = createVirtualizer({
    get count() {
      return visible().length;
    },
    getScrollElement: () => scrollEl,
    estimateSize: () => 64,
    overscan: 8,
  });

  // Land on the newest message when a thread first loads (chat convention).
  // Only when no search filter is active, so the user's filtered view is stable.
  let scrolledFor = "";
  createEffect(() => {
    const d = detail();
    if (!d || search() || hidePseudo()) return;
    if (scrolledFor === d.thread.slug) return;
    const n = visible().length;
    if (n === 0) return;
    scrolledFor = d.thread.slug;
    queueMicrotask(() => virtualizer.scrollToIndex(n - 1, { align: "end" }));
  });

  // Show the jump-to-newest affordance once the user has scrolled up ~1 screen.
  const onScroll = () => {
    const el = scrollEl;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight <= el.clientHeight);
  };
  const scrollToBottom = () => {
    const n = rows().length;
    if (n > 0) virtualizer.scrollToIndex(n - 1, { align: "end" });
  };

  return (
    <div class="flex h-full flex-col">
      <div class="shrink-0 border-b border-border px-6 py-4">
        <A href="/dms" class="text-sm text-muted hover:text-ink">
          ← Messages
        </A>
        <Show when={detail()} fallback={<h1 class="mt-2 text-xl font-semibold">Loading…</h1>}>
          {(d) => (
            <div class="mt-2 flex items-center justify-between gap-4">
              <div class="min-w-0">
                <h1 class="truncate text-xl font-semibold tracking-tight">
                  {d().thread.title || d().thread.participants.join(", ") || d().thread.slug}
                </h1>
                <p class="text-xs text-muted">
                  {d().thread.participants.length} participant
                  {d().thread.participants.length === 1 ? "" : "s"} ·{" "}
                  {d().thread.messageCount.toLocaleString()} messages · {d().thread.source}
                </p>
              </div>
              <Show when={shareTargets().length > 0}>
                <button
                  type="button"
                  class="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-40"
                  disabled={pendingShares() === 0}
                  onClick={downloadAllShares}
                  title="Download every post/reel shared in this conversation"
                >
                  {pendingShares() > 0 ? `Download ${pendingShares()} shared` : "Shared posts saved"}
                </button>
              </Show>
            </div>
          )}
        </Show>

        <div class="mt-3 flex flex-wrap items-center gap-3">
          <div class="inline-flex rounded-lg border border-border p-0.5 text-sm">
            <button
              type="button"
              class="rounded-md px-3 py-1"
              classList={{
                "bg-accent text-accent-ink": view() === "messages",
                "text-muted": view() !== "messages",
              }}
              onClick={() => setView("messages")}
            >
              Messages
            </button>
            <button
              type="button"
              class="rounded-md px-3 py-1"
              classList={{
                "bg-accent text-accent-ink": view() === "media",
                "text-muted": view() !== "media",
              }}
              onClick={() => setView("media")}
            >
              Media
            </button>
          </div>

          <Show when={view() === "messages"}>
            <input
              type="search"
              placeholder="Search this conversation…"
              class="w-64 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-muted"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
            <Show when={search().trim()}>
              <span class="text-xs text-muted">{visible().length.toLocaleString()} matches</span>
            </Show>
            <label class="ml-auto flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={hidePseudo()}
                onChange={(e) => setHidePseudo(e.currentTarget.checked)}
              />
              Hide reaction notices
            </label>
          </Show>
          <Show when={view() === "media"}>
            <span class="text-xs text-muted">{threadItems().length.toLocaleString()} items</span>
          </Show>
        </div>
      </div>

      <Show
        when={view() === "messages"}
        fallback={
          <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Show
              when={threadItems().length > 0}
              fallback={<p class="text-sm text-muted">No media in this conversation.</p>}
            >
              <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                <For each={threadItems()}>
                  {(it, i) => (
                    <MediaTile item={it} onOpen={() => viewer.open(threadItems(), i())} />
                  )}
                </For>
              </div>
            </Show>
          </div>
        }
      >
        <div class="relative min-h-0 flex-1">
          <div ref={scrollEl} onScroll={onScroll} class="h-full overflow-y-auto px-6 py-3">
            <Show
              when={!detail.loading}
              fallback={<p class="text-sm text-muted">Loading messages…</p>}
            >
              <Show
                when={visible().length > 0}
                fallback={
                  <p class="text-sm text-muted">
                    {search().trim()
                      ? "No messages match your search."
                      : "No messages in this thread."}
                  </p>
                }
              >
                <div
                  style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    position: "relative",
                    width: "100%",
                  }}
                >
                  <For each={virtualizer.getVirtualItems()}>
                    {(vrow) => (
                      <div
                        data-index={vrow.index}
                        ref={(el) => queueMicrotask(() => virtualizer.measureElement(el))}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${vrow.start}px)`,
                        }}
                      >
                        <MessageBubble
                          row={rows()[vrow.index]!}
                          group={isGroup()}
                          openMedia={openMedia}
                        />
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>

          <Show when={!atBottom() && visible().length > 0}>
            <button
              type="button"
              onClick={scrollToBottom}
              aria-label="Scroll to latest"
              class="absolute bottom-4 right-4 flex size-9 items-center justify-center rounded-full border border-border bg-surface text-ink shadow-lg transition-opacity hover:opacity-90"
            >
              <svg viewBox="0 0 24 24" class="h-5 w-5 fill-current" aria-hidden="true">
                <path d="M12 16l-6-6h12z" />
              </svg>
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
