import { Show, type JSX } from 'solid-js';
import { Icon, type IconName } from './Icon';

export function EmptyState(props: {
  icon?: IconName;
  title: string;
  hint?: string;
  action?: JSX.Element;
}): JSX.Element {
  return (
    <div
      class="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface/40 px-6 py-12 text-center"
      role="status"
    >
      <Show when={props.icon}>
        {(name) => (
          <div class="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-2 text-muted">
            <Icon name={name()} class="h-6 w-6" />
          </div>
        )}
      </Show>
      <p class="text-sm font-semibold leading-5 text-ink">{props.title}</p>
      <Show when={props.hint}>
        <p class="mt-2 max-w-md text-sm leading-6 text-muted">{props.hint}</p>
      </Show>
      <Show when={props.action}>
        <div class="mt-6">{props.action}</div>
      </Show>
    </div>
  );
}
