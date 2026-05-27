import { createSignal, Show, type JSX } from "solid-js";
import { vmediaUrl } from "../lib/media";
import { PhoneFrame, createOrientation } from "./PhoneFrame";

/**
 * An `<img>` sourced from the archive zip via the `vmedia` scheme, with a
 * graceful fallback when the entry can't be loaded (deleted / excluded media).
 */
export function ArchiveImage(props: { uri: string; alt?: string; class?: string }): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  return (
    <Show
      when={!failed()}
      fallback={
        <div class={`flex items-center justify-center bg-surface-2 text-xs text-muted ${props.class ?? ""}`}>
          unavailable
        </div>
      }
    >
      <img
        src={vmediaUrl(props.uri)}
        alt={props.alt ?? ""}
        class={props.class}
        onError={() => setFailed(true)}
      />
    </Show>
  );
}

export function isVideoUri(uri: string): boolean {
  return /\.(mp4|mov|webm|m4v)$/i.test(uri);
}

/**
 * A `<video controls>` with a consistent "unavailable" fallback (mirrors
 * `ArchiveImage`) and a loading treatment so a buffering video isn't a black
 * void. `src` is any media URL (vmedia for in-zip, dmedia for downloaded).
 * `poster` is the real downloaded thumbnail when available; without one, the
 * browser paints the first frame once `preload="metadata"` resolves, and we
 * show a play glyph + shimmer until then. Fullscreen uses the native control.
 */
export function ArchiveVideo(props: {
  src: string;
  poster?: string;
  class?: string;
  /** Wrap the player in a phone-handset frame, orientation auto-detected from the video. */
  framed?: boolean;
}): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const { orientation, measure } = createOrientation();
  const Player = (): JSX.Element => (
    <div class="relative">
      <video
        src={props.src}
        poster={props.poster}
        controls
        preload="metadata"
        class={props.class}
        onLoadedMetadata={(e) => measure(e.currentTarget)}
        onLoadedData={() => setReady(true)}
        onError={() => setFailed(true)}
      />
      <Show when={!ready() && !props.poster}>
        <div class="pointer-events-none absolute inset-0 flex animate-pulse items-center justify-center bg-surface-2/40">
          <svg viewBox="0 0 24 24" class="h-10 w-10 fill-white/80" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </Show>
    </div>
  );
  return (
    <Show
      when={!failed()}
      fallback={
        <div class={`flex items-center justify-center bg-surface-2 text-xs text-muted ${props.class ?? ""}`}>
          media unavailable
        </div>
      }
    >
      <Show when={props.framed} fallback={<Player />}>
        <PhoneFrame orientation={orientation()}>
          <Player />
        </PhoneFrame>
      </Show>
    </Show>
  );
}

/**
 * A muted, non-interactive video poster wrapped in a compact phone frame, for
 * thumbnails that open the full viewer on click. Orientation auto-detects from the
 * video; a play glyph marks it as playable. Falls back to an "unavailable" box if
 * the source can't load (mirrors ArchiveImage/ArchiveVideo).
 *
 * `fill` (default true) stretches the frame to its parent box with `object-cover`
 * for grid tiles — here `class` sizes/positions the frame (e.g. `absolute inset-0`).
 * `fill={false}` lets the frame shrink-wrap the poster for inline use (e.g. a chat
 * bubble) — here `class` sizes the video itself (e.g. `max-h-72 w-auto`).
 */
export function FramedVideoThumb(props: {
  src: string;
  poster?: string;
  class?: string;
  fill?: boolean;
  glyph?: boolean;
}): JSX.Element {
  const fill = (): boolean => props.fill ?? true;
  const [failed, setFailed] = createSignal(false);
  const { orientation, measure } = createOrientation();
  return (
    <Show
      when={!failed()}
      fallback={
        <div class={`flex items-center justify-center bg-surface-2 text-xs text-muted ${props.class ?? ""}`}>
          unavailable
        </div>
      }
    >
      <PhoneFrame orientation={orientation()} compact fill={fill()} class={fill() ? props.class : undefined}>
        <video
          src={props.src}
          poster={props.poster}
          preload="metadata"
          muted
          class={fill() ? "h-full w-full object-cover" : (props.class ?? "")}
          onLoadedMetadata={(e) => measure(e.currentTarget)}
          onError={() => setFailed(true)}
        />
        <Show when={props.glyph ?? true}>
          <span class="pointer-events-none absolute inset-0 flex items-center justify-center">
            <svg viewBox="0 0 24 24" class="h-10 w-10 fill-white/90 drop-shadow" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </Show>
      </PhoneFrame>
    </Show>
  );
}
