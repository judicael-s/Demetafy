import { For, type JSX } from "solid-js";
import { useApp } from "../state/app";

const KIND_CLASS: Record<string, string> = {
  info: "border-border bg-surface-2 text-ink",
  success: "border-emerald-700 bg-emerald-950/70 text-emerald-200",
  error: "border-red-800 bg-red-950/70 text-red-200",
};

export function Toaster(): JSX.Element {
  const app = useApp();
  return (
    <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      <For each={app.toasts()}>
        {(t) => (
          <div
            class={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${KIND_CLASS[t.kind]}`}
            role="status"
          >
            <span class="flex-1">{t.message}</span>
            <button
              class="shrink-0 text-muted hover:text-ink"
              aria-label="Dismiss"
              onClick={() => app.dismissToast(t.id)}
            >
              ✕
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
