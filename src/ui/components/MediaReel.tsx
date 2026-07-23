import {
  createEffect,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import type { ViewerItem } from "../state/viewer";
import { openExternal } from "../lib/external";
import { shouldHandleMediaShortcut } from "../lib/media-controls";
import { useApp } from "../state/app";

/** Per-image dwell before auto-advancing (videos advance on `ended`). */
const IMAGE_MS = 5000;
/** Above this, segmented progress bars become unreadable, so fall back to a single
 *  bar + counter even in "segments" mode. */
const SEGMENT_MAX = 30;

export interface MediaReelProps {
  items: ViewerItem[];
  startIndex?: number;
  /** "segments": one bar per item (Stories). "single": one playback bar + counter
   *  (Feed). Defaults to "single". */
  progress?: "segments" | "single";
  /** When provided, renders a close button and binds Escape. */
  onClose?: () => void;
  /** Called when advancing past the last item. Defaults to looping to the start. */
  onEnd?: () => void;
  autoplay?: boolean;
  onIndexChange?: (index: number, item: ViewerItem) => void;
  resetKey?: string;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Full-bleed, auto-advancing media player. Drives both the Stories viewer (modal,
 * segmented progress) and the mixed Feed route (embedded, single progress). It is
 * index-driven and windowed — only the current slide (keyed) and an offscreen
 * preload of the next render — so it scales to thousands of items without a giant
 * DOM. Tap zones / hold-to-pause / swipe / wheel / keyboard all navigate; video
 * autoplays muted (unmute is a user gesture). Honors `prefers-reduced-motion` by
 * disabling autoplay and auto-advance (manual only).
 */
export function MediaReel(props: MediaReelProps): JSX.Element {
  const app = useApp();
  const reduced = prefersReducedMotion();
  const [index, setIndex] = createSignal(props.startIndex ?? 0);
  const [muted, setMuted] = createSignal(true);
  const autoAdvance = (): boolean => props.autoplay === true && !reduced;
  const [paused, setPaused] = createSignal(!autoAdvance());
  const [prog, setProg] = createSignal(0); // 0..1 for the current item

  let containerEl: HTMLDivElement | undefined;
  let videoEl: HTMLVideoElement | undefined;

  const len = (): number => props.items.length;
  const cur = (): ViewerItem | undefined => props.items[index()];
  const nextItem = (): ViewerItem | undefined => props.items[index() + 1];
  const useSegments = (): boolean => props.progress === "segments" && len() <= SEGMENT_MAX;

  // Appending media keeps the current position. Only an explicit context change resets it.
  createEffect(
    on(
      () => props.resetKey,
      () => setIndex(props.startIndex ?? 0),
      { defer: true },
    ),
  );
  createEffect(() => {
    const enabled = props.autoplay === true;
    setPaused(!(enabled && !reduced));
  });
  createEffect(() => {
    const last = len() - 1;
    if (index() > last) setIndex(Math.max(0, last));
  });
  createEffect(
    on(index, (i) => {
      const item = props.items[i];
      if (item) props.onIndexChange?.(i, item);
    }),
  );

  function next(): void {
    const i = index();
    if (i < len() - 1) setIndex(i + 1);
    else if (props.onEnd) props.onEnd();
    else setIndex(0);
  }
  function prev(): void {
    setIndex((i) => Math.max(0, i - 1));
  }

  // Per-slide lifecycle: automatic video playback and image dwell both require
  // explicit autoplay opt-in, and reduced motion always wins.
  createEffect(
    on([index, autoAdvance], ([i, automatic]) => {
      setProg(0);
      setPaused(!automatic);
      if (automatic && props.items[i]?.kind === "image") startImageTimer();
    }),
  );

  function startImageTimer(): void {
    let start = performance.now();
    let raf = 0;
    const tick = (t: number): void => {
      if (paused()) {
        start = t - prog() * IMAGE_MS; // freeze elapsed while held
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min(1, (t - start) / IMAGE_MS);
      setProg(p);
      if (p >= 1) {
        next();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(raf));
  }

  // Reflect hold-to-pause onto the live <video>.
  createEffect(() => {
    if (cur()?.kind !== "video" || !videoEl) return;
    if (paused()) videoEl.pause();
    else void videoEl.play().catch(() => {});
  });

  // Keyboard controls for the lifetime of the player.
  createEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      switch (e.key) {
        case "Escape":
          props.onClose?.();
          break;
        case "ArrowDown":
        case "ArrowRight":
          e.preventDefault();
          next();
          break;
        case "ArrowUp":
        case "ArrowLeft":
          e.preventDefault();
          prev();
          break;
        case " ":
          if (!shouldHandleMediaShortcut(e.target)) break;
          e.preventDefault();
          setPaused((p) => !p);
          break;
        case "m":
        case "M":
          if (shouldHandleMediaShortcut(e.target)) setMuted((m) => !m);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  let lastWheel = 0;
  const onWheel = (e: WheelEvent): void => {
    if (Math.abs(e.deltaY) < 20) return;
    const now = Date.now();
    if (now - lastWheel < 350) return;
    lastWheel = now;
    if (e.deltaY > 0) next();
    else prev();
  };

  // Tap zones (left=prev, right=next, center=play/pause), hold-to-pause, vertical
  // swipe to navigate — distinguished on pointerup.
  let downX = 0;
  let downY = 0;
  let holdTimer = 0;
  let holding = false;
  const onPointerDown = (e: PointerEvent): void => {
    downX = e.clientX;
    downY = e.clientY;
    holding = false;
    holdTimer = window.setTimeout(() => {
      holding = true;
      setPaused(true);
    }, 220);
  };
  const releaseHold = (): void => window.clearTimeout(holdTimer);
  const onPointerUp = (e: PointerEvent): void => {
    releaseHold();
    if (holding) {
      holding = false;
      setPaused(false);
      return;
    }
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 45) {
      const along = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
      if (along < 0) next();
      else prev();
      return;
    }
    const rect = containerEl?.getBoundingClientRect();
    if (!rect) {
      setPaused((p) => !p);
      return;
    }
    const x = e.clientX - rect.left;
    if (x < rect.width * 0.33) prev();
    else if (x > rect.width * 0.66) next();
    else setPaused((p) => !p);
  };
  const onPointerCancel = (): void => {
    releaseHold();
    if (holding) {
      holding = false;
      setPaused(false);
    }
  };

  const segFill = (i: number): number => {
    const idx = index();
    if (i < idx) return 100;
    if (i > idx) return 0;
    return prog() * 100;
  };

  return (
    <div
      ref={containerEl}
      class="relative h-full w-full select-none overflow-hidden bg-black"
      onWheel={onWheel}
    >
      {/* Interaction layer — sibling of the chrome so button clicks don't reach it. */}
      <div
        class="absolute inset-0 z-10"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />

      {/* Media stage. Keyed on index (+1 so 0 stays truthy) so each slide mounts a
          fresh element: the focused video autoplays and the previous tears down. */}
      <Show when={index() + 1} keyed>
        <div class="absolute inset-0 flex items-center justify-center">
          <Show when={cur()}>
            {(it) => (
              <Show
                when={it().kind === "video"}
                fallback={
                  <img
                    src={it().src}
                    alt={it().caption ?? ""}
                    decoding="async"
                    class="max-h-full max-w-full object-contain"
                  />
                }
              >
                <video
                  ref={(el) => (videoEl = el)}
                  src={it().src}
                  poster={it().poster}
                  autoplay={autoAdvance()}
                  muted={muted()}
                  playsinline
                  preload="metadata"
                  class="max-h-full max-w-full object-contain"
                  onTimeUpdate={(e) => {
                    const v = e.currentTarget;
                    if (v.duration) setProg(v.currentTime / v.duration);
                  }}
                  onCanPlay={(e) => {
                    if (!paused()) void e.currentTarget.play().catch(() => {});
                  }}
                  onEnded={() => {
                    if (autoAdvance()) next();
                  }}
                />
              </Show>
            )}
          </Show>
        </div>
      </Show>

      {/* Paused glyph */}
      <Show when={paused()}>
        <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div class="flex size-16 items-center justify-center rounded-full bg-black/40 text-3xl text-white">
            ❚❚
          </div>
        </div>
      </Show>

      {/* Progress */}
      <div class="absolute inset-x-0 top-0 z-20 p-2">
        <Show
          when={useSegments()}
          fallback={
            <div class="flex items-center gap-2">
              <div class="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
                <div class="h-full rounded-full bg-white" style={{ width: `${prog() * 100}%` }} />
              </div>
              <span class="shrink-0 text-[11px] tabular-nums text-white/70">
                {index() + 1} / {len()}
              </span>
            </div>
          }
        >
          <div class="flex gap-1">
            <For each={props.items}>
              {(_, i) => (
                <div class="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
                  <div class="h-full rounded-full bg-white" style={{ width: `${segFill(i())}%` }} />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Top-right controls */}
      <div class="absolute right-2 top-4 z-20 flex items-center gap-2">
        <button
          type="button"
          aria-label={paused() ? "Play" : "Pause"}
          aria-pressed={!paused()}
          class="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
          onClick={() => setPaused((p) => !p)}
        >
          {paused() ? "Play" : "Pause"}
        </button>
        <button
          type="button"
          aria-label={`Autoplay ${autoAdvance() ? "On" : "Off"}`}
          aria-pressed={autoAdvance()}
          disabled={reduced}
          title={reduced ? "Autoplay is unavailable while reduced motion is enabled." : undefined}
          class="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20 disabled:opacity-60"
          onClick={() => {
            const next = props.autoplay !== true;
            app.setAutoplay(next);
            setPaused(!(next && !reduced));
          }}
        >
          Autoplay {autoAdvance() ? "On" : "Off"}
        </button>
        <Show when={cur()?.kind === "video"}>
          <button
            type="button"
            aria-label={muted() ? "Unmute" : "Mute"}
            class="flex size-9 items-center justify-center rounded-full bg-white/10 text-sm text-white hover:bg-white/20"
            onClick={() => setMuted((m) => !m)}
          >
            {muted() ? "🔇" : "🔊"}
          </button>
        </Show>
        <Show when={cur()?.openExternalUrl}>
          {(url) => (
            <button
              type="button"
              class="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
              onClick={() => openExternal(url())}
            >
              Open original
            </button>
          )}
        </Show>
        <Show when={props.onClose}>
          <button
            type="button"
            aria-label="Close"
            class="flex size-9 items-center justify-center rounded-full bg-white/10 text-lg text-white hover:bg-white/20"
            onClick={() => props.onClose!()}
          >
            ✕
          </button>
        </Show>
      </div>

      {/* Provenance chip + caption */}
      <Show when={cur()?.source || cur()?.caption || cur()?.timestampMs}>
        <div class="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/70 to-transparent p-4 pt-10">
          <Show when={cur()?.source}>
            <span class="inline-block rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white">
              {cur()!.source}
            </span>
          </Show>
          <Show when={cur()?.caption}>
            <p class="mt-2 line-clamp-3 max-w-2xl whitespace-pre-wrap break-words text-sm text-white/90">
              {cur()!.caption}
            </p>
          </Show>
          <Show when={cur()?.timestampMs}>
            <p class="mt-1 text-xs text-white/50">{fmtTime(cur()!.timestampMs!)}</p>
          </Show>
        </div>
      </Show>

      {/* Offscreen preload of the next slide */}
      <Show when={nextItem()}>
        {(n) => (
          <div class="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0" aria-hidden="true">
            <Show when={n().kind === "image"} fallback={<video src={n().src} preload="metadata" />}>
              <img src={n().src} alt="" />
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
