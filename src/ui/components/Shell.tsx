import { ErrorBoundary, Show, type JSX, type ParentProps } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useApp } from "../state/app";
import Button from "./Button";
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
  const navigate = useNavigate();

  return (
    <div class="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <p class="text-lg font-medium text-ink">Something went wrong loading this page.</p>
      <p class="max-w-md break-words text-sm text-muted">
        This route could not be displayed, but the rest of your archive is still available.
      </p>
      <div class="mt-2 flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={() => props.reset()}>
          Try again
        </Button>
        <Button onClick={() => navigate("/")}>Return home</Button>
      </div>
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
          <a href="#main-content" class="skip-link">
            Skip to main content
          </a>
          <Sidebar />
          <div class="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main id="main-content" tabIndex={-1} class="min-h-0 flex-1 overflow-y-auto">
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
