import {
  createContext,
  createMemo,
  createSignal,
  onMount,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js";
import { ingestArchive, type ProgressFn } from "../lib/ingest";
import {
  fetchArchives,
  fetchOverview,
  fetchProfile,
  type ArchiveAccount,
  type Overview,
  type ProfileRow,
} from "../lib/queries";
import { setMediaArchive } from "../lib/media";
import { getAutoplayEnabled, setAutoplayEnabled } from "../lib/settings";

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  message: string;
}

export interface AppStore {
  loading: Accessor<boolean>;
  ready: Accessor<boolean>;
  ingesting: Accessor<boolean>;
  profile: Accessor<ProfileRow | null>;
  overview: Accessor<Overview | null>;
  /** Every imported archive (account), most-recent first. Drives the switcher. */
  archives: Accessor<ArchiveAccount[]>;
  /** The active account whose content is shown; null until anything is imported. */
  activeArchive: Accessor<ArchiveAccount | null>;
  /** The active account's id — the scope passed to every content query. */
  activeArchiveId: Accessor<number | null>;
  /** The active account's service (instagram | facebook). Drives nav + route guards. */
  activeService: Accessor<string | null>;
  /** Distinct imported services (drives the "import your other data" prompts). */
  services: Accessor<string[]>;
  toasts: Accessor<Toast[]>;
  autoplay: Accessor<boolean>;
  refresh: () => Promise<void>;
  ingest: (paths: string | string[], onProgress?: ProgressFn) => Promise<void>;
  /** Flip the active account and re-scope all cached data. */
  setActiveArchive: (id: number) => Promise<void>;
  pushToast: (kind: Toast["kind"], message: string) => void;
  dismissToast: (id: number) => void;
  setAutoplay: (on: boolean) => void;
}

const AppContext = createContext<AppStore>();

export function AppProvider(props: ParentProps) {
  const [loading, setLoading] = createSignal(true);
  const [ingesting, setIngesting] = createSignal(false);
  const [profile, setProfile] = createSignal<ProfileRow | null>(null);
  const [overview, setOverview] = createSignal<Overview | null>(null);
  const [archives, setArchives] = createSignal<ArchiveAccount[]>([]);
  const [activeArchiveId, setActiveId] = createSignal<number | null>(null);
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  const [autoplay, setAutoplaySignal] = createSignal(getAutoplayEnabled());

  const ready = () => (overview()?.archives ?? 0) > 0;

  // Derived so the rest of the app keeps thinking in terms of the active account
  // and its service without each consumer re-deriving from the archive list.
  const activeArchive = createMemo(
    () => archives().find((a) => a.id === activeArchiveId()) ?? null,
  );
  const activeService = createMemo(() => activeArchive()?.service ?? null);
  const services = createMemo(() => [...new Set(archives().map((a) => a.service))]);

  let toastId = 0;
  const pushToast: AppStore["pushToast"] = (kind, message) => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, kind, message }]);
    if (kind !== "error") {
      setTimeout(() => dismissToast(id), 4000);
    }
  };
  const dismissToast = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const setAutoplay = (on: boolean): void => {
    setAutoplayEnabled(on);
    setAutoplaySignal(on);
  };

  async function refresh(selectNewest = false) {
    const list = await fetchArchives();
    setArchives(list);
    // Default to the most-recently-imported account; keep the current choice when
    // it's still present (e.g. after importing or removing another one). After an
    // import we jump to the newest so the user lands on what they just added.
    let active = activeArchiveId();
    if (selectNewest || active === null || !list.some((a) => a.id === active)) {
      active = list[0]?.id ?? null;
    }
    setActiveId(active);
    // Keep media resolution scoped to the active account (see setMediaArchive).
    setMediaArchive(active);
    const id = active ?? undefined;
    const [ov, pr] = await Promise.all([fetchOverview(id), fetchProfile(id)]);
    setOverview(ov);
    setProfile(pr);
  }

  /** Flip the active account (the switcher) and re-scope all cached data. */
  const setActiveArchive = async (id: number) => {
    if (id === activeArchiveId()) return;
    setActiveId(id);
    await refresh();
  };

  async function ingest(paths: string | string[], onProgress?: ProgressFn) {
    if (ingesting()) return;
    const partPaths = Array.isArray(paths) ? paths : [paths];
    setIngesting(true);
    try {
      const counts = await ingestArchive(partPaths, onProgress);
      await refresh(true);
      const empty =
        counts.messages === 0 &&
        counts.savedItems === 0 &&
        counts.stories === 0 &&
        counts.posts === 0 &&
        counts.albums === 0;
      if (empty) {
        pushToast(
          "info",
          "Imported, but this archive had no saved items or messages — it may be a partial export.",
        );
      } else {
        pushToast(
          "success",
          `Imported ${counts.messages.toLocaleString()} messages from your archive.`,
        );
      }
    } finally {
      setIngesting(false);
    }
  }

  onMount(async () => {
    try {
      await refresh();
    } catch (e) {
      pushToast("error", `Could not read the index: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  });

  const store: AppStore = {
    loading,
    ready,
    ingesting,
    profile,
    overview,
    archives,
    activeArchive,
    activeArchiveId,
    activeService,
    services,
    toasts,
    autoplay,
    refresh,
    ingest,
    setActiveArchive,
    pushToast,
    dismissToast,
    setAutoplay,
  };

  return <AppContext.Provider value={store}>{props.children}</AppContext.Provider>;
}

export function useApp(): AppStore {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within <AppProvider>");
  return ctx;
}
