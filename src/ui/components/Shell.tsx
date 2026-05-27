import { ErrorBoundary, Show, type JSX, type ParentProps } from "solid-js";
import { useApp } from "../state/app";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Toaster } from "./Toaster";
import { Onboarding } from "./Onboarding";
import { DownloadsDock } from "./DownloadsDock";
import { MediaViewer } from "./MediaViewer";

/** Friendly fallback for any error thrown while a route renders (e.g. a failed
 *  DB query in a route's createResource). Keeps the sidebar/top bar mounted and
 *  offers a retry, instead of blanking the window or showing a misleading
 *  "No items" empty state. */
function RouteError(props: { err: unknown; reset: () => void }): JSX.Element {
  return (
    <div class="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <p class="text-lg font-medium text-ink">Something went wrong loading this page.</p>
      <p class="max-w-md break-words text-sm text-muted">
        {props.err instanceof Error ? props.err.message : String(props.err)}
      </p>
      <button
        onClick={() => props.reset()}
        class="rounded-lg btn-brand px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}

/** Router root layout: gates on load/ready, then frames routes with sidebar + top bar. */
export function Shell(props: ParentProps): JSX.Element {
  const app = useApp();
  return (
    <Show
      when={!app.loading()}
      fallback={
        <div class="flex h-screen items-center justify-center bg-bg text-muted">Loading…</div>
      }
    >
      <Show when={app.ready()} fallback={<Onboarding />}>
        <div class="flex h-screen overflow-hidden">
          <Sidebar />
          <div class="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main class="min-h-0 flex-1 overflow-y-auto">
              <ErrorBoundary fallback={(err, reset) => <RouteError err={err} reset={reset} />}>
                {props.children}
              </ErrorBoundary>
            </main>
          </div>
        </div>
        <DownloadsDock />
        <MediaViewer />
      </Show>
      <Toaster />
    </Show>
  );
}
