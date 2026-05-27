import {
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { fetchThreads, type ThreadSummary } from "../lib/queries";
import { Avatar } from "../components/Avatar";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { useApp } from "../state/app";

const ROW_HEIGHT = 76;

type SortKey = "recency" | "count" | "alpha";

// Friendly labels + display order for thread categories. Instagram uses
// inbox/message_requests/broadcast; Facebook adds archived/filtered/encrypted.
// Chips are driven by which categories actually appear, so both services work
// without a hardcoded per-service list.
const SOURCE_LABELS: Record<string, string> = {
  inbox: "Inbox",
  message_requests: "Requests",
  archived_threads: "Archived",
  filtered_threads: "Filtered",
  e2ee_cutover: "Encrypted",
  broadcast: "Broadcast",
};
const SOURCE_ORDER = Object.keys(SOURCE_LABELS);
const sourceLabel = (s: string): string => SOURCE_LABELS[s] ?? s;

function displayTitle(t: ThreadSummary): string {
  return t.title || t.participants.join(", ") || t.slug;
}

function ThreadRow(props: { thread: ThreadSummary; onOpen: (slug: string) => void }): JSX.Element {
  const t = props.thread;
  const title = displayTitle(t);
  const date = () => (t.lastMessageAt ? new Date(t.lastMessageAt).toLocaleDateString() : "");
  const isGroup = t.participants.length > 2;
  return (
    <button
      class="flex h-[76px] w-full items-center gap-3 border-b border-border px-2 text-left transition-colors hover:bg-surface"
      onClick={() => props.onOpen(t.slug)}
    >
      <Avatar name={title} class="size-11 text-sm" />
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2">
          <span class="truncate font-medium text-ink">{title}</span>
          <Show when={isGroup}>
            <span class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
              {t.participants.length} people
            </span>
          </Show>
        </div>
        <p class="truncate text-sm text-muted">{t.lastPreview || "Media"}</p>
      </div>
      <div class="shrink-0 text-right">
        <div class="text-xs text-muted">{date()}</div>
        <div class="mt-0.5 text-xs tabular-nums text-muted opacity-70">
          {t.messageCount.toLocaleString()} msgs
        </div>
      </div>
    </button>
  );
}

export default function Dms(): JSX.Element {
  const navigate = useNavigate();
  const app = useApp();
  const [threads] = createResource(
    () => app.activeService(),
    (svc) => fetchThreads(svc ?? undefined),
  );
  const [sourceSel, setSource] = createSignal<string | null>(null);
  const [sort, setSort] = createSignal<SortKey>("recency");

  const counts = createMemo(() => {
    const c = new Map<string, number>();
    for (const t of threads() ?? []) c.set(t.source, (c.get(t.source) ?? 0) + 1);
    return c;
  });

  // Categories present in the loaded threads, ordered; unknown ones appended.
  const availableSources = createMemo(() => {
    const present = [...counts().keys()];
    const ordered = SOURCE_ORDER.filter((s) => present.includes(s));
    const extra = present.filter((s) => !SOURCE_ORDER.includes(s)).sort();
    return [...ordered, ...extra];
  });

  // Effective selection: the chosen category if still present, else the first
  // available — keeps a valid selection when switching service changes the set.
  const source = createMemo(() => {
    const avail = availableSources();
    const sel = sourceSel();
    return sel && avail.includes(sel) ? sel : (avail[0] ?? "inbox");
  });

  const view = createMemo(() => {
    const rows = (threads() ?? []).filter((t) => t.source === source());
    const s = sort();
    const sorted = [...rows];
    if (s === "recency") {
      sorted.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
    } else if (s === "count") {
      sorted.sort((a, b) => b.messageCount - a.messageCount);
    } else {
      sorted.sort((a, b) => displayTitle(a).localeCompare(displayTitle(b)));
    }
    return sorted;
  });

  let scrollEl!: HTMLDivElement;
  const virtualizer = createVirtualizer({
    get count() {
      return view().length;
    },
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Reset scroll to top whenever the filtered/sorted set changes.
  onMount(() => {
    const stop = () => scrollEl?.scrollTo({ top: 0 });
    onCleanup(stop);
  });

  const open = (slug: string) => navigate(`/dms/${encodeURIComponent(slug)}`);

  return (
    <div class="flex h-full flex-col">
      <div class="shrink-0 border-b border-border px-8 py-5">
        <div class="flex items-center justify-between gap-4">
          <h1 class="text-2xl font-semibold tracking-tight">Messages</h1>
          <label class="flex items-center gap-2 text-sm text-muted">
            Sort
            <select
              class="rounded-lg border border-border bg-surface px-2 py-1 text-sm text-ink"
              value={sort()}
              onChange={(e) => setSort(e.currentTarget.value as SortKey)}
            >
              <option value="recency">Recent</option>
              <option value="count">Most messages</option>
              <option value="alpha">Name</option>
            </select>
          </label>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <For each={availableSources()}>
            {(s) => (
              <button
                class="rounded-full border border-border px-3 py-1 text-sm text-muted hover:text-ink"
                classList={{
                  "!border-accent !bg-accent !text-accent-ink": source() === s,
                }}
                onClick={() => {
                  setSource(s);
                  scrollEl?.scrollTo({ top: 0 });
                }}
              >
                {sourceLabel(s)}
                <span class="ml-1.5 text-xs opacity-70">{counts().get(s) ?? 0}</span>
              </button>
            )}
          </For>
        </div>
      </div>

      <div ref={scrollEl} class="min-h-0 flex-1 overflow-y-auto px-8 py-3">
        <Show when={!threads.loading} fallback={<SkeletonList />}>
          <Show
            when={view().length > 0}
            fallback={
              <EmptyState
                icon="dms"
                title="No conversations here"
                hint="This folder has no threads — try another category above."
              />
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
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vrow.start}px)`,
                      height: `${ROW_HEIGHT}px`,
                    }}
                  >
                    <ThreadRow thread={view()[vrow.index]!} onOpen={open} />
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
