import { For, type JSX } from 'solid-js';

const skeletonClass =
  'animate-pulse rounded-lg border border-border/50 bg-surface-2 motion-reduce:animate-none';

export function SkeletonList(props: { rows?: number; rowClass?: string }): JSX.Element {
  return (
    <div class="space-y-2" aria-hidden="true">
      <For each={Array.from({ length: props.rows ?? 8 })}>
        {() => <div class={`${skeletonClass} ${props.rowClass ?? 'h-16'}`} />}
      </For>
    </div>
  );
}

export function SkeletonGrid(props: {
  tiles?: number;
  tileClass?: string;
  gridClass?: string;
}): JSX.Element {
  return (
    <div
      class={
        props.gridClass ??
        'grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
      }
      aria-hidden="true"
    >
      <For each={Array.from({ length: props.tiles ?? 10 })}>
        {() => <div class={`${skeletonClass} ${props.tileClass ?? 'aspect-[4/5]'}`} />}
      </For>
    </div>
  );
}
