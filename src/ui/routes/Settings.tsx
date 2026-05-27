import { createSignal, onMount, Show, type JSX } from "solid-js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useApp } from "../state/app";
import { ImportPanel } from "../components/ImportPanel";
import { downloadDir } from "../lib/db";
import { checkYtdlp } from "../lib/downloads";
import {
  getCookiesPath,
  getFetchAvatarsEnabled,
  getParallelism,
  setCookiesPath,
  setFetchAvatarsEnabled,
  setParallelism,
} from "../lib/settings";
import { persistTheme, resolveTheme, type Theme } from "../lib/theme";

export default function Settings(): JSX.Element {
  const app = useApp();
  const [theme, setTheme] = createSignal<Theme>("dark");

  const [parallel, setParallel] = createSignal(1);
  const [cookies, setCookies] = createSignal<string | undefined>(undefined);
  const [downloadsPath, setDownloadsPath] = createSignal("");
  const [ytdlpVersion, setYtdlpVersion] = createSignal<string | null | undefined>(undefined);
  const [fetchAvatars, setFetchAvatars] = createSignal(false);

  onMount(async () => {
    setTheme(resolveTheme());

    setParallel(getParallelism());
    setCookies(getCookiesPath());
    setFetchAvatars(getFetchAvatarsEnabled());
    try {
      setDownloadsPath(await downloadDir());
    } catch {
      /* leave blank if the command isn't available */
    }
    setYtdlpVersion(await checkYtdlp());
  });

  const toggle = () => {
    const next: Theme = theme() === "dark" ? "light" : "dark";
    setTheme(next);
    persistTheme(next);
  };

  const changeParallel = (n: number) => {
    setParallelism(n);
    setParallel(getParallelism());
  };

  const pickCookies = async () => {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Cookies file", extensions: ["txt"] }],
    });
    if (typeof selected === "string") {
      setCookiesPath(selected);
      setCookies(selected);
    }
  };

  const clearCookies = () => {
    setCookiesPath(null);
    setCookies(undefined);
  };

  const toggleFetchAvatars = () => {
    const next = !fetchAvatars();
    setFetchAvatarsEnabled(next);
    setFetchAvatars(next);
  };

  return (
    <div class="mx-auto max-w-3xl px-8 py-10">
      <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>

      <section class="mt-8 rounded-xl border border-border bg-surface p-5">
        <h2 class="text-sm font-medium text-ink">Appearance</h2>
        <div class="mt-3 flex items-center justify-between">
          <span class="text-sm text-muted">Theme</span>
          <button
            class="rounded-lg border border-border px-4 py-2 text-sm capitalize hover:bg-surface-2"
            onClick={toggle}
          >
            {theme()}
          </button>
        </div>
      </section>

      <section class="mt-6 rounded-xl border border-border bg-surface p-5">
        <h2 class="text-sm font-medium text-ink">Downloads</h2>
        <p class="mt-1 text-xs text-muted">
          Saved videos are fetched with the bundled yt-dlp and stored on your device.
        </p>

        <div class="mt-4 flex items-center justify-between gap-4">
          <div>
            <span class="text-sm text-ink">Parallel downloads</span>
            <p class="text-xs text-muted">Instagram rate-limits above one stream — 1 is safest.</p>
          </div>
          <select
            value={parallel()}
            onChange={(e) => changeParallel(Number(e.currentTarget.value))}
            class="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          >
            <option value="1">1 (safest)</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </div>

        <div class="mt-4 flex items-center justify-between gap-4">
          <div class="min-w-0">
            <span class="text-sm text-ink">Cookies file</span>
            <p class="truncate text-xs text-muted">
              {cookies() ? cookies() : "Optional — needed for login-walled posts."}
            </p>
          </div>
          <div class="flex shrink-0 gap-2">
            <Show when={cookies()}>
              <button
                class="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-ink"
                onClick={clearCookies}
              >
                Clear
              </button>
            </Show>
            <button
              class="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2"
              onClick={() => void pickCookies()}
            >
              Choose…
            </button>
          </div>
        </div>

        <div class="mt-4 flex items-center justify-between gap-4">
          <div class="min-w-0">
            <span class="text-sm text-ink">Downloads folder</span>
            <p class="truncate font-mono text-xs text-muted">{downloadsPath() || "—"}</p>
          </div>
          <button
            class="shrink-0 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-40"
            disabled={!downloadsPath()}
            onClick={() => void openExternal(downloadsPath()).catch(() => undefined)}
          >
            Open folder
          </button>
        </div>

        <div class="mt-4 flex items-center justify-between gap-4">
          <span class="text-sm text-ink">yt-dlp</span>
          <span class="text-xs text-muted">
            {ytdlpVersion() === undefined
              ? "Checking…"
              : ytdlpVersion()
                ? `v${ytdlpVersion()}`
                : "Not found"}
          </span>
        </div>
      </section>

      <section class="mt-6 rounded-xl border border-border bg-surface p-5">
        <h2 class="text-sm font-medium text-ink">Friends' photos (Instagram)</h2>
        <div class="mt-3 flex items-center justify-between gap-4">
          <div class="min-w-0">
            <span class="text-sm text-ink">Fetch Instagram profile pictures</span>
            <p class="mt-0.5 text-xs text-muted">
              Demetafy's only network feature. When on, the Connections page can download your
              contacts' current Instagram photos to this device, using your saved cookies file —
              off by default, and nothing else ever leaves your machine. Facebook isn't supported
              (its export has no handle to look up).
            </p>
          </div>
          <button
            class="shrink-0 rounded-lg border px-4 py-2 text-sm"
            classList={{
              "border-accent bg-accent text-accent-ink": fetchAvatars(),
              "border-border hover:bg-surface-2": !fetchAvatars(),
            }}
            onClick={toggleFetchAvatars}
          >
            {fetchAvatars() ? "On" : "Off"}
          </button>
        </div>
      </section>

      <section class="mt-6 rounded-xl border border-border bg-surface p-5">
        <h2 class="text-sm font-medium text-ink">Archive</h2>
        <Show
          when={app.archive()}
          fallback={<p class="mt-1 text-xs text-muted">No archive imported yet.</p>}
        >
          {(ar) => (
            <div class="mt-1">
              <p class="truncate font-mono text-xs text-muted" title={ar().source_path}>
                {ar().source_path}
              </p>
              <p class="mt-1 text-xs text-muted">
                Imported {new Date(ar().ingested_at).toLocaleString()}
                <Show when={app.overview()}>
                  {(ov) => (
                    <>
                      {" · "}
                      {ov().savedItems.toLocaleString()} saved · {ov().messages.toLocaleString()}{" "}
                      messages · {ov().threads.toLocaleString()} threads
                    </>
                  )}
                </Show>
              </p>
            </div>
          )}
        </Show>
        <p class="mt-4 text-xs text-muted">
          Re-importing replaces the data for an archive with the same path.
        </p>
        <div class="mt-3">
          <ImportPanel compact />
        </div>
      </section>
    </div>
  );
}
