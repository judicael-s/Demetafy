/**
 * Client for the opt-in Instagram friend-avatar fetch (the one network feature).
 * `fetchAvatarMap` reads the cached handle→path map for rendering; `avatarFetch`
 * kicks off the throttled Rust worker and mirrors its progress events into a store.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createStore } from "solid-js/store";
import { getCookiesPath } from "./settings";

interface AvatarRow {
  handle: string;
  local_path: string;
}

interface AvatarProgressEvent {
  done: number;
  total: number;
  handle: string;
  status: string;
}

interface AvatarFetchState {
  running: boolean;
  done: number;
  total: number;
}

const [state, setState] = createStore<AvatarFetchState>({ running: false, done: 0, total: 0 });

let wired = false;
async function ensureWired(): Promise<void> {
  if (wired) return;
  wired = true;
  await listen<AvatarProgressEvent>("avatar://progress", (e) => {
    setState({ running: true, done: e.payload.done, total: e.payload.total });
  });
  await listen<number>("avatar://done", () => setState("running", false));
}

/** Successfully-cached IG avatars as handle (lowercased) → relative media path. */
export async function fetchAvatarMap(service?: string): Promise<Map<string, string>> {
  const rows = await invoke<AvatarRow[]>("query_avatars", { service: service ?? null });
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.handle.toLowerCase(), r.local_path);
  return map;
}

export const avatarFetch = {
  state,
  /** Start a throttled batch fetch for the given IG handles. Pass only handles
   *  that aren't already cached — the worker doesn't de-dupe. */
  async start(handles: string[]): Promise<void> {
    if (handles.length === 0) return;
    await ensureWired();
    setState({ running: true, done: 0, total: handles.length });
    await invoke("fetch_ig_avatars", { handles, cookiesPath: getCookiesPath() ?? null });
  },
};
