import { splitProps, type Component, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

export type SurfaceProps = JSX.HTMLAttributes<HTMLElement> & {
  as?: "section" | "div";
  title?: string;
  children: JSX.Element;
  class?: string;
};

const Surface: Component<SurfaceProps> = (props) => {
  const [local, rest] = splitProps(props, ["as", "title", "children", "class"]);

  return (
    <Dynamic
      component={local.as ?? "section"}
      class={["surface rounded-lg border border-border p-6", local.class]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {local.title && (
        <h2 class="mb-4 text-base font-semibold leading-5 tracking-[-0.01em] text-ink">
          {local.title}
        </h2>
      )}
      {local.children}
    </Dynamic>
  );
};

export default Surface;
