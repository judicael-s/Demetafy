import type { Component, JSX } from "solid-js";

export type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: JSX.Element;
};

const PageHeader: Component<PageHeaderProps> = (props) => (
  <header class="flex flex-col gap-6 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
    <div class="min-w-0">
      <h1 class="mb-2 text-balance text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink">
        {props.title}
      </h1>
      {props.description && (
        <p class="-mt-4 max-w-3xl text-sm leading-6 text-muted">{props.description}</p>
      )}
    </div>
    {props.actions && <div class="flex shrink-0 flex-wrap gap-2">{props.actions}</div>}
  </header>
);

export default PageHeader;
