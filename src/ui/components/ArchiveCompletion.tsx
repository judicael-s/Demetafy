import { createEffect, createResource, createSignal, on, onCleanup, Show, type JSX } from "solid-js";
import { fetchDownloadStats } from "../lib/queries";
import { downloadQueue, fillArchive } from "../lib/downloads";
import { queueCounts } from "../lib/download-queue";

/**
 * "Completing your archive" card: an honest 3-slice progress bar (downloaded /
 * remaining / unavailable) over the link-only posts (saved + DM-shared) that
 * need a yt-dlp fetch, plus a one-click background "Download all my posts".
 *
 * The percentage is downloaded ÷ reachable, so it can honestly hit 100% of what
 * is recoverable — `unavailable` (deleted/login-walled) is shown as its own slice
 * rather than dragging the bar to a number that can never complete. Reused on
 * Home + Profile. The bar fills "bit by bit" via a debounced stats refetch as the
 * background queue completes items.
 */
export function ArchiveCompletion(props: { archiveId?: number; service?: string }): JSX.Element {
  // Object source (always truthy) so the resource fetches even when `archiveId` is
  // undefined (= all), and refetches when the active account flips. `service` only
  // drives the Instagram/Facebook wording below.
  const [stats, { refetch }] = createResource(
    () => ({ archiveId: props.archiveId }),
    (src) => fetchDownloadStats(src.archiveId),
  );
  const [busy, setBusy] = createSignal(false);
  const noun = (): string => (props.service === "facebook" ? "shared videos" : "posts");

  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      () => {
        const c = queueCounts(downloadQueue.state);
        return c.done + c.failed;
      },
      () => {
        clearTimeout(timer);
        timer = setTimeout(() => void refetch(), 600);
      },
      { defer: true },
    ),
  );
  onCleanup(() => clearTimeout(timer));

  const active = () => queueCounts(downloadQueue.state).active;
  const pct = () => {
    const s = stats();
    if (!s || s.reachable === 0) return 0;
    return Math.round((s.downloaded / s.reachable) * 100);
  };

  const fill = async (): Promise<void> => {
    setBusy(true);
    try {
      await fillArchive(props.archiveId);
    } finally {
      setBusy(false);
    }
  };

  const buttonLabel = (remaining: number): string => {
    if (active() > 0) return `Downloading… (${active().toLocaleString()} left)`;
    if (remaining === 0) return "All caught up";
    const what = props.service === "facebook" ? "shared videos" : "my posts";
    return `Download all ${what} (${remaining.toLocaleString()})`;
  };

  return (
    <Show
      when={stats()}
      fallback={
        <div class="rounded-xl border border-border bg-surface p-5 text-sm text-muted">
          Checking your archive…
        </div>
      }
    >
      {(s) => (
        <div class="rounded-xl border border-border bg-surface p-5">
          <Show
            when={s().total > 0}
            fallback={
              <p class="text-sm text-muted">
                {props.service === "facebook"
                  ? "No downloadable videos found in your conversations — your post and album media is already saved offline."
                  : "No downloadable posts found — your conversation, story, and profile media is already saved offline."}
              </p>
            }
          >
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <h2 class="text-sm font-medium text-ink">Completing your archive</h2>
                <p class="mt-0.5 text-xs text-muted">
                  {s().downloaded.toLocaleString()} of {s().reachable.toLocaleString()} reachable{" "}
                  {noun()} downloaded
                  <Show when={s().unavailable > 0}>
                    {" · "}
                    {s().unavailable.toLocaleString()} unavailable
                  </Show>
                </p>
              </div>
              <span class="shrink-0 text-2xl font-semibold tabular-nums">{pct()}%</span>
            </div>

            <div
              class="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-valuenow={pct()}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${noun()} downloaded`}
            >
              <div
                class="bg-emerald-500"
                style={{ width: `${(s().downloaded / s().total) * 100}%` }}
              />
              <div class="bg-accent/40" style={{ width: `${(s().remaining / s().total) * 100}%` }} />
              <div
                class="bg-border"
                style={{ width: `${(s().unavailable / s().total) * 100}%` }}
                title="Deleted or login-walled — can't be recovered"
              />
            </div>

            <div class="mt-4 flex flex-wrap items-center gap-3">
              <button
                class="rounded-lg btn-brand px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
                disabled={busy() || active() > 0 || s().remaining === 0}
                onClick={() => void fill()}
              >
                {buttonLabel(s().remaining)}
              </button>
              <Show when={s().remaining > 0 && active() === 0}>
                <span class="text-xs text-muted">
                  Runs in the background — keep browsing.{" "}
                  {props.service === "facebook"
                    ? "Some may be unavailable."
                    : "~40% are typically unavailable."}
                </span>
              </Show>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
