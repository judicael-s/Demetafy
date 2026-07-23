import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { confirm, open as openDialog } from '@tauri-apps/plugin-dialog';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { useApp } from '../state/app';
import { ImportPanel } from '../components/ImportPanel';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import Surface from '../components/Surface';
import { deleteArchive, type ArchiveAccount } from '../lib/queries';
import { downloadDir } from '../lib/db';
import { checkYtdlp, type YtdlpStatus } from '../lib/downloads';
import {
  getCookiesPath,
  getFetchAvatarsEnabled,
  getParallelism,
  setCookiesPath,
  setFetchAvatarsEnabled,
  setParallelism,
} from '../lib/settings';
import { formatArchiveTimestamp } from '../lib/presentation';
import { persistTheme, resolveTheme, type Theme } from '../lib/theme';

const rowClass = 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6';

export default function Settings(): JSX.Element {
  const app = useApp();
  const [theme, setTheme] = createSignal<Theme>('dark');
  const [parallel, setParallel] = createSignal(1);
  const [cookies, setCookies] = createSignal<string | undefined>();
  const [downloadsPath, setDownloadsPath] = createSignal('');
  const [ytdlp, setYtdlp] = createSignal<YtdlpStatus>();
  const [fetchAvatars, setFetchAvatars] = createSignal(false);

  onMount(async () => {
    setTheme(resolveTheme());
    setParallel(getParallelism());
    setCookies(getCookiesPath());
    setFetchAvatars(getFetchAvatarsEnabled());
    try {
      setDownloadsPath(await downloadDir());
    } catch {
      // Storage remains unavailable until the native command is reachable.
    }
    setYtdlp(await checkYtdlp());
  });

  const toggleTheme = () => {
    const next: Theme = theme() === 'dark' ? 'light' : 'dark';
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
      filters: [{ name: 'Cookies file', extensions: ['txt'] }],
    });
    if (typeof selected === 'string') {
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
  const accountLabel = (account: ArchiveAccount): string =>
    account.username ? `@${account.username}` : (account.displayName ?? account.service);
  const removeAccount = async (account: ArchiveAccount): Promise<void> => {
    const label = accountLabel(account);
    const ok = await confirm(
      `Remove ${label}? This deletes its imported data from Demetafy's index. Your original archive files are not touched.`,
      { title: 'Remove account', kind: 'warning' },
    );
    if (!ok) return;
    try {
      await deleteArchive(account.id);
      await app.refresh();
      app.pushToast('success', `Removed ${label}.`);
    } catch {
      app.pushToast('error', `Could not remove ${label}. Try again.`);
    }
  };

  return (
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Settings"
        description="Manage archives, appearance, playback, downloads, and local storage."
      />

      <div class="mt-8 space-y-6">
        <Surface title="Account & archives">
          <p class="text-sm leading-6 text-muted">
            Each imported export stays separate. Switch accounts from the sidebar or add another
            archive below.
          </p>
          <Show
            when={app.archives().length > 0}
            fallback={<p class="mt-4 text-sm text-muted">No archive imported yet.</p>}
          >
            <ul class="mt-4 space-y-2">
              <For each={app.archives()}>
                {(account) => (
                  <li class="flex flex-col gap-3 rounded-lg border border-border bg-bg p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div class="min-w-0">
                      <p class="flex flex-wrap items-center gap-2 text-sm text-ink">
                        <span class="truncate font-medium">{accountLabel(account)}</span>
                        <span class="text-xs uppercase tracking-[0.08em] text-muted">
                          {account.service}
                        </span>
                        <Show when={app.activeArchiveId() === account.id}>
                          <span class="text-xs font-medium text-accent">Active account</span>
                        </Show>
                      </p>
                      <p class="mt-1 text-xs text-muted">
                        Imported {formatArchiveTimestamp(account.ingestedAt)} · source path hidden
                        for privacy
                      </p>
                    </div>
                    <Button variant="danger" size="sm" onClick={() => void removeAccount(account)}>
                      Remove
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <p class="mt-4 text-xs leading-5 text-muted">
            Re-importing the same archive refreshes its index. Original export files remain
            untouched.
          </p>
          <div class="mt-4">
            <ImportPanel compact />
          </div>
        </Surface>

        <Surface title="Appearance">
          <div class={rowClass}>
            <div>
              <p class="text-sm font-medium text-ink">Theme</p>
              <p class="mt-1 text-xs leading-5 text-muted">
                Use the calm light or dark archive palette.
              </p>
            </div>
            <Button variant="secondary" class="capitalize" onClick={toggleTheme}>
              {theme()}
            </Button>
          </div>
        </Surface>

        <Surface title="Playback">
          <div class={rowClass}>
            <div>
              <p class="text-sm font-medium text-ink">Autoplay</p>
              <p class="mt-1 text-xs leading-5 text-muted">
                Off by default. When on, videos and story-style sequences advance automatically.
              </p>
            </div>
            <Button
              variant={app.autoplay() ? 'primary' : 'secondary'}
              aria-pressed={app.autoplay()}
              onClick={() => app.setAutoplay(!app.autoplay())}
            >
              {app.autoplay() ? 'On' : 'Off'}
            </Button>
          </div>
        </Surface>

        <Surface title="Downloads & cookies">
          <p class="text-sm leading-6 text-muted">
            Saved posts and shared videos are fetched only when you start a download. Instagram
            avatar fetching is a separate opt-in below.
          </p>
          <div class={`mt-5 ${rowClass}`}>
            <div>
              <p class="text-sm font-medium text-ink">Parallel downloads</p>
              <p class="mt-1 text-xs text-muted">
                One stream is safest when Instagram rate-limits requests.
              </p>
            </div>
            <select
              value={parallel()}
              onChange={(event) => changeParallel(Number(event.currentTarget.value))}
              class="min-h-10 rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <option value="1">1 (safest)</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </div>
          <div class={`mt-5 ${rowClass}`}>
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink">Cookies file</p>
              <p class="mt-1 text-xs text-muted">
                {cookies()
                  ? 'Selected · path hidden for privacy'
                  : 'Optional · needed for login-walled posts'}
              </p>
            </div>
            <div class="flex gap-2">
              <Show when={cookies()}>
                <Button variant="ghost" size="sm" onClick={clearCookies}>
                  Clear
                </Button>
              </Show>
              <Button variant="secondary" size="sm" onClick={() => void pickCookies()}>
                Choose…
              </Button>
            </div>
          </div>
          <div class={`mt-5 ${rowClass}`}>
            <p class="text-sm font-medium text-ink">Downloader</p>
            <p class="text-xs text-muted">
              {ytdlp() === undefined
                ? 'Checking…'
                : ytdlp()!.version
                  ? `yt-dlp v${ytdlp()!.version}`
                  : 'Not available'}
            </p>
          </div>
          <Show when={ytdlp()?.stale}>
            <p class="mt-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-xs leading-5 text-ink">
              The bundled downloader may be out of date. Downloads can fail until the app is
              updated.
            </p>
          </Show>
        </Surface>

        <Surface title="Instagram avatars">
          <div class={rowClass}>
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink">Fetch Instagram profile pictures</p>
              <p class="mt-1 text-xs leading-5 text-muted">
                Off by default. When enabled, Connections can fetch current Instagram photos with
                your selected cookies. Facebook is unsupported because its export has no handle.
              </p>
            </div>
            <Button variant={fetchAvatars() ? 'primary' : 'secondary'} onClick={toggleFetchAvatars}>
              {fetchAvatars() ? 'On' : 'Off'}
            </Button>
          </div>
        </Surface>

        <Surface title="Storage">
          <div class={rowClass}>
            <div>
              <p class="text-sm font-medium text-ink">Downloads folder</p>
              <p class="mt-1 text-xs text-muted">
                {downloadsPath() ? 'Ready · path hidden for privacy' : 'Folder unavailable'}
              </p>
            </div>
            <Button
              variant="secondary"
              disabled={!downloadsPath()}
              onClick={() => void openExternal(downloadsPath()).catch(() => undefined)}
            >
              Open folder
            </Button>
          </div>
        </Surface>

        <Surface title="Diagnostics">
          <p class="text-sm leading-6 text-muted">
            Privacy-safe diagnostics are being prepared for the Windows beta. Demetafy does not send
            telemetry, and this section does not collect or upload archive data.
          </p>
        </Surface>
      </div>
    </div>
  );
}
