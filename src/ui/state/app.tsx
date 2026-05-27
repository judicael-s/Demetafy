import {
  createContext,
  createSignal,
  onMount,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js";
import { ingestArchive, type ProgressFn } from "../lib/ingest";
import {
  fetchLatestArchive,
  fetchOverview,
  fetchProfile,
  fetchServices,
  type ArchiveRow,
  type Overview,
  type ProfileRow,
} from "../lib/queries";
import { setMediaService } from "../lib/media";

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
  archive: Accessor<ArchiveRow | null>;
  /** Distinct imported services, most-recent first (drives the switcher). */
  services: Accessor<string[]>;
  /** The service whose content is currently shown; null until anything imported. */
  activeService: Accessor<string | null>;
  toasts: Accessor<Toast[]>;
  refresh: () => Promise<void>;
  ingest: (paths: string | string[], onProgress?: ProgressFn) => Promise<void>;
  /** Flip the active service and re-scope all cached data. */
  setActiveService: (service: string) => Promise<void>;
  pushToast: (kind: Toast["kind"], message: string) => void;
  dismissToast: (id: number) => void;
}

const AppContext = createContext<AppStore>();

export function AppProvider(props: ParentProps) {
  const [loading, setLoading] = createSignal(true);
  const [ingesting, setIngesting] = createSignal(false);
  const [profile, setProfile] = createSignal<ProfileRow | null>(null);
  const [overview, setOverview] = createSignal<Overview | null>(null);
  const [archive, setArchive] = createSignal<ArchiveRow | null>(null);
  const [services, setServices] = createSignal<string[]>([]);
  const [activeService, setActive] = createSignal<string | null>(null);
  const [toasts, setToasts] = createSignal<Toast[]>([]);

  const ready = () => (overview()?.archives ?? 0) > 0;

  let toastId = 0;
  const pushToast: AppStore["pushToast"] = (kind, message) => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, kind, message }]);
    if (kind !== "error") {
      setTimeout(() => dismissToast(id), 4000);
    }
  };
  const dismissToast = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  async function refresh() {
    const svc = await fetchServices();
    setServices(svc);
    // Default to the most-recently-imported service; keep the user's current
    // choice when it's still present (e.g. after re-importing the other one).
    let active = activeService();
    if (active === null || !svc.includes(active)) {
      active = svc[0] ?? null;
      setActive(active);
    }
    // Keep media resolution scoped to the active service (see setMediaService).
    setMediaService(active);
    const s = active ?? undefined;
    const [ov, pr, ar] = await Promise.all([
      fetchOverview(s),
      fetchProfile(s),
      fetchLatestArchive(s),
    ]);
    setOverview(ov);
    setProfile(pr);
    setArchive(ar);
  }

  /** Flip the active service (the IG/FB switcher) and re-scope all cached data. */
  const setActiveService = async (svc: string) => {
    if (svc === activeService()) return;
    setActive(svc);
    await refresh();
  };

  async function ingest(paths: string | string[], onProgress?: ProgressFn) {
    if (ingesting()) return;
    const partPaths = Array.isArray(paths) ? paths : [paths];
    setIngesting(true);
    try {
      const counts = await ingestArchive(partPaths, onProgress);
      await refresh();
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
    archive,
    services,
    activeService,
    toasts,
    refresh,
    ingest,
    setActiveService,
    pushToast,
    dismissToast,
  };

  return <AppContext.Provider value={store}>{props.children}</AppContext.Provider>;
}

export function useApp(): AppStore {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within <AppProvider>");
  return ctx;
}
