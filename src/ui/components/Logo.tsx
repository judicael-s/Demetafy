import { createUniqueId, type JSX } from "solid-js";

/** Demetafy brand mark: a gradient "D" on a dark polar-grey tile with a 1px
 *  Instagram-gradient border. Scalable SVG (also exportable to the app icon).
 *  Decorative by default — pair it with the "Demetafy" wordmark for the label.
 *  Gradient stops mirror --ig-gradient in app.css; keep them in sync. */
export function Logo(props: { size?: number; class?: string }): JSX.Element {
  // createUniqueId keeps the gradient id unique per instance, so multiple logos
  // on one page never collide on a duplicate DOM id.
  const gid = createUniqueId();
  const size = () => props.size ?? 32;
  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 32 32"
      class={props.class}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="#feda75" />
          <stop offset="0.25" stop-color="#fa7e1e" />
          <stop offset="0.5" stop-color="#d62976" />
          <stop offset="0.75" stop-color="#962fbf" />
          <stop offset="1" stop-color="#4f5bd5" />
        </linearGradient>
      </defs>
      {/* Tile: dark polar grey fill, 1px gradient border (inset 0.5 so the
          stroke sits fully inside the 32-unit box). */}
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="8"
        fill="#1b1f26"
        stroke={`url(#${gid})`}
        stroke-width="1"
      />
      {/* Gradient D glyph: outer stem+bulge with softened outer corners. The
          right curve uses rx=10 ry=6.5 so it tops out at x=24. */}
      <path
        d="M8 9.5 L14 9.5 A10 6.5 0 0 1 14 22.5 L8 22.5 Z"
        fill={`url(#${gid})`}
        stroke={`url(#${gid})`}
        stroke-width="1.1"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      {/* Counter (the hole in the D), repainted in the tile color. Inner
          curve rx=6.5 ry=3 keeps a uniform 3.5-unit stroke around the arc. */}
      <path
        d="M11.5 13 L14 13 A6.5 3 0 0 1 14 19 L11.5 19 Z"
        fill="#1b1f26"
      />
    </svg>
  );
}
