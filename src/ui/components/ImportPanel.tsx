import { createSignal, Show, type JSX } from "solid-js";
import { open as openDialog, confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { useApp } from "../state/app";
import { IngestError, type IngestProgress } from "../lib/ingest";
import { fillArchive } from "../lib/downloads";
import { parseDevArchivePaths, prepareArchiveSelection } from "../lib/import-selection";
import Button from "./Button";
import Surface from "./Surface";

interface UiError {
  title: string;
  body: string;
}

/** Map a thrown ingest failure to user-facing copy. Wording lives here in the
 *  view layer; the orchestrator only tags errors with a stable `code`. */
function toUiError(e: unknown): UiError {
  if (e instanceof IngestError) {
    switch (e.code) {
      case "corrupt":
        return {
          title: "Couldn't read that file",
          body: "It may be incomplete or not a .zip archive. If your export came in multiple parts, make sure you've downloaded every part and select all parts together.",
        };
      case "partial_facebook":
        return {
          title: "Select every Facebook archive part",
          body: "This looks like only the media part(s) of a Facebook export. Meta puts the JSON metadata/taxonomy in one separate .zip; select every file from the same facebook-{user}-{date} export before importing.",
        };
      case "not_instagram":
        return {
          title: "That doesn't look like an Instagram export",
          body: "Make sure you chose JSON format (not HTML) and the Instagram profile when requesting your download.",
        };
    }
  }
  return { title: "Import failed", body: e instanceof Error ? e.message : String(e) };
}

function phaseLabel(p: IngestProgress): string {
  switch (p.phase) {
    case "opening":
      return "Opening archive…";
    case "indexing":
      return "Indexing archive parts…";
    case "checking":
      return "Checking selected parts…";
    case "reading":
      return "Reading profile & saved items…";
    case "messages":
      return "Parsing messages…";
    case "writing":
      return "Saving to index…";
    case "done":
      return "Finishing up…";
  }
}

const isDeterminate = (p: IngestProgress): boolean =>
  p.phase === "messages" && (p.total ?? 0) > 0;

const pct = (p: IngestProgress): number =>
  Math.min(100, Math.round(((p.current ?? 0) / (p.total || 1)) * 100));

/**
 * The import surface used by the empty-state onboarding and the Settings
 * re-import section. Native file picker is the primary path; a dev-only path
 * box stays available for the headless verification recipe.
 */
export function ImportPanel(props: { compact?: boolean }): JSX.Element {
  const app = useApp();
  const [progress, setProgress] = createSignal<IngestProgress | null>(null);
  const [error, setError] = createSignal<UiError | null>(null);
  const [devPath, setDevPath] = createSignal("");
  const [done, setDone] = createSignal(false);
  const [queued, setQueued] = createSignal<number | null>(null);

  const run = async (paths: string[]) => {
    if (app.ingesting()) return;
    setError(null);
    setDone(false);
    setQueued(null);
    setProgress({ phase: "opening" });
    try {
      await app.ingest(paths, (p) => setProgress(p));
      setDone(true);
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setProgress(null);
    }
  };

  const runSelection = async (selected: string | string[] | null) => {
    const prepared = prepareArchiveSelection(selected);
    if (prepared === null) return;
    if (!prepared.ok) {
      setError({ title: prepared.title, body: prepared.body });
      return;
    }
    if (prepared.needsConfirmation) {
      const confirmed = await confirmDialog(
        `Only continue if Meta's download page/email showed this same total (for example, “File ${prepared.paths.length} of ${prepared.paths.length}”) and you've selected every .zip from this export.`,
        {
          title: `Import ${prepared.label}?`,
          kind: "warning",
          okLabel: "Import",
          cancelLabel: "Cancel",
        },
      );
      if (!confirmed) return;
    }
    await run(prepared.paths);
  };

  const startFill = async () => {
    setQueued(await fillArchive());
  };

  const pick = async () => {
    if (app.ingesting()) return;
    setError(null);
    const selected = await openDialog({
      multiple: true,
      directory: false,
      title: "Choose your Meta archive zip parts",
      filters: [{ name: "Meta export (.zip)", extensions: ["zip"] }],
    });
    await runSelection(selected as string | string[] | null);
  };

  return (
    <div>
      <Show when={!app.ingesting()} fallback={<ProgressBlock get={progress} />}>
        <Button
          variant="primary"
          onClick={() => void pick()}
          class={props.compact ? undefined : "pointer-target w-full"}
        >
          {props.compact ? "Choose file(s)…" : "Choose archive"}
        </Button>

        {import.meta.env.DEV && (
          <form
            class="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const paths = parseDevArchivePaths(devPath());
              if (paths.length > 0) void runSelection(paths);
            }}
          >
            <input
              type="text"
              value={devPath()}
              onInput={(e) => setDevPath(e.currentTarget.value)}
              placeholder="dev: paste one path, or multiple paths separated by ; / new lines"
              class="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-muted focus:border-accent"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!devPath().trim()}
              class="shrink-0"
            >
              Import path
            </Button>
          </form>
        )}

        <Show when={error()}>
          {(err) => (
            <Surface as="div" title={err().title} class="mt-5 !p-4 text-left">
              <p class="text-sm leading-6 text-muted">{err().body}</p>
              <Button size="sm" onClick={() => void pick()} class="mt-3">
                Choose another file
              </Button>
            </Surface>
          )}
        </Show>

        <Show when={done() && !error()}>
          <Surface as="div" title="Archive imported ✓" class="mt-5 !p-4 text-left">
            <p class="text-sm leading-6 text-muted">
              Conversations, stories and profile are ready to browse offline. Saved & shared posts
              are only links — fetch them now to keep them forever (runs in the background; ~40% may
              be unavailable).
            </p>
            <Show
              when={queued() === null}
              fallback={
                <p class="mt-3 text-sm text-accent">
                  Downloading {queued()?.toLocaleString()} posts in the background — see the
                  Downloads dock.
                </p>
              }
            >
              <Button variant="primary" onClick={() => void startFill()} class="mt-3">
                Download all my posts
              </Button>
            </Show>
          </Surface>
        </Show>
      </Show>
    </div>
  );
}

function ProgressBlock(props: { get: () => IngestProgress | null }): JSX.Element {
  return (
    <Show when={props.get()} fallback={<div class="text-sm text-muted">Importing…</div>}>
      {(p) => (
        <div>
          <div class="flex items-center justify-between text-sm text-ink">
            <span>{phaseLabel(p())}</span>
            <Show when={isDeterminate(p())}>
              <span class="tabular-nums text-muted">
                {p().current} / {p().total} threads
              </span>
            </Show>
          </div>
          <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              class="h-full rounded-full bg-accent transition-[width] duration-200"
              classList={{ "w-full animate-pulse": !isDeterminate(p()) }}
              style={isDeterminate(p()) ? { width: `${pct(p())}%` } : undefined}
            />
          </div>
        </div>
      )}
    </Show>
  );
}
