import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useApp } from "../state/app";
import { Icon } from "./Icon";
import { ArchiveImage } from "./ArchiveMedia";

export function TopBar(): JSX.Element {
  const app = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("");
  let input!: HTMLInputElement;

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

  return (
    <header class="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-surface px-5">
      <form class="relative max-w-md flex-1" onSubmit={submit}>
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
          <Icon name="search" class="h-4 w-4" />
        </span>
        <input
          ref={input}
          type="search"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search messages, saved, reposts…"
          aria-label="Search messages, saved, and reposts"
          aria-keyshortcuts="Meta+K Control+K"
          class="w-full rounded-lg border border-border bg-bg py-2 pl-9 pr-12 text-sm text-ink outline-none placeholder:text-muted focus:border-accent"
        />
        <kbd class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
          ⌘K
        </kbd>
      </form>

      <div class="ml-auto flex items-center gap-3">
        <Show when={label()}>
          <span class="text-sm text-muted">{label()}</span>
        </Show>
        <div aria-hidden="true" class="size-9 overflow-hidden rounded-full bg-surface-2">
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
