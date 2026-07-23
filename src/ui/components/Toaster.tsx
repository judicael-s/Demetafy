import { For, type JSX } from 'solid-js';
import { useApp } from '../state/app';
import Button from './Button';

const KIND_CLASS: Record<string, string> = {
  info: 'border-border bg-surface text-ink',
  success: 'border-emerald-700/60 bg-surface text-ink',
  error: 'border-danger/60 bg-surface text-ink',
};

export function Toaster(): JSX.Element {
  const app = useApp();
  return (
    <div
      class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
      aria-relevant="additions"
    >
      <For each={app.toasts()}>
        {(t) => (
          <div
            class={`pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-3 text-sm leading-5 shadow-lg ${KIND_CLASS[t.kind]}`}
            role={t.kind === 'error' ? 'alert' : 'status'}
          >
            <span class="min-w-0 flex-1">{t.message}</span>
            <Button
              variant="ghost"
              size="sm"
              class="!min-h-10 !w-10 shrink-0 !px-0"
              aria-label="Dismiss notification"
              onClick={() => app.dismissToast(t.id)}
            >
              <span aria-hidden="true">×</span>
            </Button>
          </div>
        )}
      </For>
    </div>
  );
}
