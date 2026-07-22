import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { useLocation, useNavigate, useSearchParams } from "@solidjs/router";
import { useApp } from "../state/app";
import { searchShortcutLabel } from "../lib/shell-ui";
import { Icon } from "./Icon";
import { ArchiveImage } from "./ArchiveMedia";

export function TopBar(): JSX.Element {
  const app = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [query, setQuery] = createSignal("");
  let input!: HTMLInputElement;
  let wasOnSearch = false;

  createEffect(() => {
    const isSearchRoute = location.pathname === "/search";
    const raw = params.q;
    const routeQuery = (Array.isArray(raw) ? raw[0] : raw) ?? "";
    if (isSearchRoute && !wasOnSearch) setQuery(routeQuery);
    wasOnSearch = isSearchRoute;
  });

  // Cmd/Ctrl+K focuses search.
  const onKeydown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      input.focus();
    }
  };
  onMount(() => window.addEventListener("keydown", onKeydown));
  onCleanup(() => window.removeEventListener("keydown", onKeydown));

  const submit = (e: Event) => {
    e.preventDefault();
    const q = query().trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  // Instagram has an @handle; Facebook has no username, so show the display name
  // plainly there instead of a fake "@Alex Rivera".
  const username = () => (app.profile()?.username ?? "").replace(/^@/, "");
  const displayName = () => app.profile()?.display_name ?? "";
  const photoUri = () => app.profile()?.profile_photo_uri ?? null;
  const label = () => (username() ? `@${username()}` : displayName());
  const initial = () => (displayName() || username()).charAt(0).toUpperCase() || "?";
  const shortcut = searchShortcutLabel(typeof navigator === "undefined" ? "" : navigator.platform);
  const searchDescription = () =>
    app.activeService() === "facebook"
      ? "Search messages in the active Facebook archive."
      : "Search messages, saved posts, and reposts in the active Instagram archive.";

  return (
    <header class="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 lg:gap-4 lg:px-5">
      <Show when={app.archives().length >= 2}>
        <label class="min-w-0 lg:hidden">
          <span class="visually-hidden">Active archive</span>
          <select
            value={app.activeArchiveId() ?? ""}
            aria-label="Active archive"
            onChange={(e) => void app.setActiveArchive(Number(e.currentTarget.value))}
            class="min-h-10 w-28 max-w-full truncate rounded-md border border-border bg-bg px-2 text-xs text-ink sm:w-36"
          >
            <For each={app.archives()}>
              {(acc) => (
                <option value={acc.id}>
                  {acc.username ? `@${acc.username}` : (acc.displayName ?? acc.service)} ·{" "}
                  {acc.service === "instagram"
                    ? "Instagram"
                    : acc.service === "facebook"
                      ? "Facebook"
                      : acc.service}
                </option>
              )}
            </For>
          </select>
        </label>
      </Show>

      <form class="relative min-w-0 max-w-md flex-1" onSubmit={submit}>
        <label for="archive-search" class="visually-hidden">
          Search this archive
        </label>
        <span id="archive-search-description" class="visually-hidden">
          {searchDescription()}
        </span>
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
          <Icon name="search" class="h-4 w-4" />
        </span>
        <input
          id="archive-search"
          ref={input}
          type="search"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search this archive…"
          aria-describedby="archive-search-description"
          aria-keyshortcuts="Meta+K Control+K"
          class="w-full rounded-lg border border-border bg-bg py-2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted focus:border-accent sm:pr-16"
        />
        <kbd class="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted sm:block">
          {shortcut}
        </kbd>
      </form>

      <div class="ml-auto flex items-center gap-3">
        <Show when={label()}>
          <span class="hidden text-sm text-muted xl:inline">{label()}</span>
        </Show>
        <div aria-hidden="true" class="hidden size-9 overflow-hidden rounded-full bg-surface-2 md:block">
          <Show
            when={photoUri()}
            fallback={
              <div class="flex h-full w-full items-center justify-center bg-accent text-sm font-semibold text-accent-ink">
                {initial()}
              </div>
            }
          >
            <ArchiveImage uri={photoUri()!} class="h-full w-full object-cover" />
          </Show>
        </div>
      </div>
    </header>
  );
}
