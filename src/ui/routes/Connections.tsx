import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
  type JSX,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { openExternal } from "../lib/external";
import { fetchConnections, fetchThreads, type Connection } from "../lib/queries";
import { connectionKey, participantKeySet, threadsForConnection } from "../lib/connection-threads";
import { avatarFetch, fetchAvatarMap } from "../lib/avatars";
import { getFetchAvatarsEnabled } from "../lib/settings";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { useApp } from "../state/app";

const ROW_HEIGHT = 60;

// Labels + display order for connection kinds. Instagram: following/followers/
// close_friends/blocked. Facebook: friends/following. Chips are data-driven so
// both services render without a hardcoded per-service list.
const KIND_LABELS: Record<string, string> = {
  following: "Following",
  followers: "Followers",
  friends: "Friends",
  close_friends: "Close friends",
  blocked: "Blocked",
};
const KIND_ORDER = Object.keys(KIND_LABELS);
const kindLabel = (k: string): string => KIND_LABELS[k] ?? k;

export default function Connections(): JSX.Element {
  const app = useApp();
  const navigate = useNavigate();
  const [all] = createResource(
    () => app.activeArchiveId(),
    (id) => fetchConnections(id ?? undefined),
  );
  // Threads for the active account, to link a connection to the chat(s) you share.
  const [threads] = createResource(
    () => app.activeArchiveId(),
    (id) => fetchThreads(id ?? undefined),
  );
  // Cached IG avatars (handle → media path), opt-in feature; empty for Facebook.
  const [avatarMap, { refetch: refetchAvatars }] = createResource(
    () => app.activeService(),
    (svc) => fetchAvatarMap(svc ?? undefined),
  );
  const conversationKeys = createMemo(() => participantKeySet(threads() ?? []));
  const hasConversation = (c: Connection): boolean =>
    conversationKeys().has(connectionKey(c.username));
  const openConversation = (c: Connection): void => {
    const best = threadsForConnection(c, threads() ?? [])[0];
    if (best) navigate(`/dms/${encodeURIComponent(best.slug)}`);
  };
  const [kindSel, setKind] = createSignal<string | null>(null);
  const [search, setSearch] = createSignal("");

  const counts = createMemo(() => {
    const map = new Map<string, number>();
    for (const c of all() ?? []) map.set(c.kind, (map.get(c.kind) ?? 0) + 1);
    return map;
  });

  const availableKinds = createMemo(() => {
    const present = [...counts().keys()];
    const ordered = KIND_ORDER.filter((k) => present.includes(k));
    const extra = present.filter((k) => !KIND_ORDER.includes(k)).sort();
    return [...ordered, ...extra];
  });

  // Effective kind: the chosen one if still present, else the first available.
  const kind = createMemo(() => {
    const avail = availableKinds();
    const sel = kindSel();
    return sel && avail.includes(sel) ? sel : (avail[0] ?? "");
  });

  const visible = createMemo(() => {
    const list = (all() ?? []).filter((c) => c.kind === kind());
    const q = search().trim().toLowerCase();
    return q ? list.filter((c) => c.username.toLowerCase().includes(q)) : list;
  });

  // Opt-in IG avatar fetch (the one network feature). The button targets the
  // currently-shown list so the user controls scope, and only un-cached handles.
  const canFetchAvatars = (): boolean =>
    app.activeService() === "instagram" && getFetchAvatarsEnabled();
  const uncachedHandles = createMemo(() => {
    const map = avatarMap();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of visible()) {
      const key = c.username.toLowerCase();
      if (!key || seen.has(key) || map?.has(key)) continue;
      seen.add(key);
      out.push(c.username);
    }
    return out;
  });
  // Refresh the map when a fetch batch finishes so new photos appear.
  let wasRunning = false;
  createEffect(() => {
    const running = avatarFetch.state.running;
    if (wasRunning && !running) void refetchAvatars();
    wasRunning = running;
  });

  let scrollEl!: HTMLDivElement;
  const virtualizer = createVirtualizer({
    get count() {
      return visible().length;
    },
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const openProfile = (c: Connection) => {
    if (c.href) openExternal(c.href);
  };

  return (
    <div class="flex h-full flex-col">
      <div class="shrink-0 border-b border-border px-8 py-5">
        <div class="flex items-center justify-between gap-4">
          <h1 class="text-2xl font-semibold tracking-tight">Connections</h1>
          <Show when={canFetchAvatars()}>
            <button
              class="shrink-0 rounded-lg border border-border px-4 py-2 text-sm hover:border-accent disabled:opacity-40"
              disabled={avatarFetch.state.running || uncachedHandles().length === 0}
              title="Download these contacts' Instagram profile photos (uses your login)"
              onClick={() => void avatarFetch.start(uncachedHandles())}
            >
              {avatarFetch.state.running
                ? `Fetching ${avatarFetch.state.done}/${avatarFetch.state.total}…`
                : `Fetch photos (${uncachedHandles().length})`}
            </button>
          </Show>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <For each={availableKinds()}>
            {(k) => (
              <button
                onClick={() => setKind(k)}
                class="rounded-full border border-border px-3 py-1 text-sm text-muted hover:text-ink"
                classList={{ "!border-accent !bg-accent !text-accent-ink": kind() === k }}
              >
                {kindLabel(k)}
                <span class="ml-1.5 text-xs opacity-70">{(counts().get(k) ?? 0).toLocaleString()}</span>
              </button>
            )}
          </For>
        </div>
        <input
          type="search"
          placeholder="Search…"
          class="mt-3 w-64 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-muted"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
      </div>

      <div ref={scrollEl} class="min-h-0 flex-1 overflow-y-auto px-8 py-4">
        <Show when={!all.loading} fallback={<SkeletonList rowClass="h-[60px]" />}>
          <Show
            when={visible().length > 0}
            fallback={
              <Show
                when={search().trim()}
                fallback={
                  <EmptyState
                    icon="connections"
                    title="Nothing in this list"
                    hint="No connections in this category."
                  />
                }
              >
                <EmptyState title="No matches" hint="No connections match your search." />
              </Show>
            }
          >
            <div
              style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}
            >
              <For each={virtualizer.getVirtualItems()}>
                {(vrow) => {
                  const c = (): Connection => visible()[vrow.index]!;
                  return (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: `${ROW_HEIGHT}px`,
                        transform: `translateY(${vrow.start}px)`,
                      }}
                    >
                      <div class="flex h-full items-center gap-3 border-b border-border/60 pr-2">
                        <Avatar name={c().username} src={avatarMap()?.get(c().username.toLowerCase())} />
                        {/* Instagram connections carry a profile URL → @handle link.
                            Facebook gives only a name (no URL) → plain, non-clickable. */}
                        <Show
                          when={c().href}
                          fallback={
                            <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                              {c().username}
                            </span>
                          }
                        >
                          <button
                            class="min-w-0 flex-1 truncate text-left text-sm font-medium text-ink hover:text-accent"
                            onClick={() => openProfile(c())}
                            title={c().href || c().username}
                          >
                            @{c().username}
                          </button>
                        </Show>
                        <Show when={hasConversation(c())}>
                          <button
                            type="button"
                            class="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-surface hover:text-accent"
                            title={`Open your conversation with ${c().username}`}
                            onClick={() => openConversation(c())}
                          >
                            <Icon name="dms" class="h-4 w-4" />
                          </button>
                        </Show>
                        <Show when={c().followedAt > 0}>
                          <span class="shrink-0 text-xs text-muted">
                            {new Date(c().followedAt).toLocaleDateString()}
                          </span>
                        </Show>
                      </div>
                    </div>
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
