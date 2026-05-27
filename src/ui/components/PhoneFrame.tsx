import { createSignal, Show, type JSX } from "solid-js";
import { orientationOf, type Orientation } from "../lib/media-orientation";

export type { Orientation };

/**
 * Reactive orientation that detects itself from a media element's intrinsic
 * dimensions. Attach `measure` to a `<video>`'s `onLoadedMetadata` or an
 * `<img>`'s `onLoad`; until then `orientation()` stays at `initial` (portrait by
 * default). `reset()` returns to `initial` — call it when the source changes so a
 * new item re-detects instead of inheriting the previous one's orientation.
 */
export function createOrientation(initial: Orientation = "portrait") {
  const [orientation, setOrientation] = createSignal<Orientation>(initial);
  const measure = (el: HTMLVideoElement | HTMLImageElement | null | undefined): void => {
    if (!el) return;
    const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    setOrientation(orientationOf(w, h));
  };
  return { orientation, measure, reset: () => setOrientation(initial) };
}

/**
 * A handset frame around media: a dark rounded bezel (themed dark on purpose so it
 * reads as a phone on either app theme) with a notch. Orientation only moves the
 * notch and tunes the corner radius — the content itself drives the screen's shape,
 * so portrait reels and landscape clips both sit flush without letterboxing.
 *
 * Sizing is delegated to the call site:
 *  - default (lightbox): the frame shrink-wraps the child, which carries its own
 *    `max-h`/`max-w`.
 *  - `fill` (grid tiles): the frame stretches to its parent box and the child uses
 *    `h-full w-full object-cover`.
 * `compact` thins the bezel and drops the notch for small thumbnails.
 */
export function PhoneFrame(props: {
  orientation: Orientation;
  compact?: boolean;
  fill?: boolean;
  class?: string;
  children: JSX.Element;
}): JSX.Element {
  const landscape = () => props.orientation === "landscape";
  return (
    <div
      class={`relative bg-zinc-900 shadow-xl ring-1 ring-white/10 ${props.class ?? ""}`}
      classList={{
        "p-[3px] rounded-2xl": props.compact,
        "p-2.5 rounded-[2rem]": !props.compact,
        "block h-full w-full": props.fill,
        "inline-block": !props.fill,
      }}
    >
      <div
        class="relative overflow-hidden bg-black"
        classList={{
          "rounded-xl": props.compact,
          "rounded-[1.6rem]": !props.compact,
          "h-full w-full": props.fill,
        }}
      >
        {props.children}
        {/* Notch / dynamic island — only on the larger frame; top-center for
            portrait, on the left edge for landscape. */}
        <Show when={!props.compact}>
          <span
            aria-hidden="true"
            class="pointer-events-none absolute z-10 rounded-full bg-black/70 backdrop-blur-sm"
            classList={{
              "left-1/2 top-2 h-1.5 w-16 -translate-x-1/2": !landscape(),
              "left-2 top-1/2 h-16 w-1.5 -translate-y-1/2": landscape(),
            }}
          />
        </Show>
      </div>
    </div>
  );
}
