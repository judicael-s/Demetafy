import { Show, type JSX } from "solid-js";
import { Icon, type IconName } from "./Icon";

/**
 * A friendly empty-state panel — optional glyph, a title, an optional hint —
 * replacing the bare "No items" text the content routes used to show.
 */
export function EmptyState(props: { icon?: IconName; title: string; hint?: string }): JSX.Element {
  return (
    <div class="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center">
      <Show when={props.icon}>
        {(name) => (
          <div class="flex size-12 items-center justify-center rounded-full bg-surface-2 text-muted">
            <Icon name={name()} class="h-6 w-6" />
          </div>
        )}
      </Show>
      <p class="text-sm font-medium text-ink">{props.title}</p>
      <Show when={props.hint}>
        <p class="max-w-sm text-sm text-muted">{props.hint}</p>
      </Show>
    </div>
  );
}
