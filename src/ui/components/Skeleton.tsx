import { For, type JSX } from "solid-js";

/** Pulsing placeholder rows for list routes (Messages, Connections, Reposts). */
export function SkeletonList(props: { rows?: number; rowClass?: string }): JSX.Element {
  return (
    <div class="space-y-2">
      <For each={Array.from({ length: props.rows ?? 8 })}>
        {() => <div class={`animate-pulse rounded-lg bg-surface-2 ${props.rowClass ?? "h-16"}`} />}
      </For>
    </div>
  );
}

/** Pulsing placeholder tiles for grid routes (Saved, Stories, Posts, Albums). */
export function SkeletonGrid(props: {
  tiles?: number;
  tileClass?: string;
  gridClass?: string;
}): JSX.Element {
  return (
    <div class={props.gridClass ?? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"}>
      <For each={Array.from({ length: props.tiles ?? 10 })}>
        {() => <div class={`animate-pulse rounded-xl bg-surface-2 ${props.tileClass ?? "aspect-[4/5]"}`} />}
      </For>
    </div>
  );
}
