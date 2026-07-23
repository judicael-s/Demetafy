import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
  untrack,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { A } from "@solidjs/router";
import { viewer, type ViewerItem } from "../state/viewer";
import { downloadQueue } from "../lib/downloads";
import {
  effStatusFor,
  effLocalPathFor,
  effThumbPathFor,
  isDownloaded,
  statusLabel,
} from "../lib/download-ui";
import { isVideoUri } from "./ArchiveMedia";
import { PhoneFrame, createOrientation } from "./PhoneFrame";
import { dmediaUrl } from "../lib/media";
import { openExternal } from "../lib/external";
import { shouldHandleMediaShortcut } from "../lib/media-controls";
import { useApp } from "../state/app";

interface ResolvedMedia {
  kind: "image" | "video";
  src: string;
  poster?: string;
}

/** Effective media for an item: a ready `src` wins; otherwise resolve a Saved
 *  download from the live queue/DB. `null` => not yet downloaded (show the CTA). */
function resolveItem(it: ViewerItem | undefined): ResolvedMedia | null {
  if (!it) return null;
  if (it.src) return { kind: it.kind, src: it.src, poster: it.poster };
  const d = it.download;
  if (d) {
    const lp = effLocalPathFor(d.key, d.dbLocalPath, downloadQueue.state);
    if (lp) {
      const tp = effThumbPathFor(d.key, d.dbThumbPath, downloadQueue.state);
      return {
        kind: isVideoUri(lp) ? "video" : "image",
        src: dmediaUrl(lp),
        poster: tp ? dmediaUrl(tp) : undefined,
      };
    }
  }
  return null;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const ARCHIVE_UNAVAILABLE = "This archive media entry is unavailable.";
const DOWNLOAD_MISSING = "This downloaded file is missing.";
const UNSUPPORTED_FORMAT = "This media format is not supported.";
const PLAYBACK_FAILED = "Playback failed. Try closing the viewer and opening this item again.";

function mediaFailure(src: string, media?: HTMLMediaElement): string {
  if (media?.error?.code === 4) return UNSUPPORTED_FORMAT;
  if (src.startsWith("vmedia:")) return ARCHIVE_UNAVAILABLE;
  if (src.startsWith("dmedia:")) return DOWNLOAD_MISSING;
  return PLAYBACK_FAILED;
}

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function MediaViewer(): JSX.Element {
  const app = useApp();
  const reduced = prefersReducedMotion();
  const cur = createMemo(() => viewer.state.items[viewer.state.index]);
  const resolved = createMemo(() => resolveItem(cur()));
  const nextResolved = createMemo(() => resolveItem(viewer.state.items[viewer.state.index + 1]));
  const count = () => viewer.state.items.length;

  const status = () => {
    const d = cur()?.download;
    return d ? effStatusFor(d.key, d.dbStatus, downloadQueue.state) : "none";
  };
  const progress = () => {
    const d = cur()?.download;
    return d ? (downloadQueue.state.items[d.key]?.progress ?? 0) : 0;
  };
  const busy = () => status() === "queued" || status() === "running";

  const [muted, setMuted] = createSignal(false);
  const [shown, setShown] = createSignal(false);
  const [mediaError, setMediaError] = createSignal<string | null>(null);
  const { orientation, measure, reset: resetOrientation } = createOrientation();
  let videoEl: HTMLVideoElement | undefined;
  let overlayEl: HTMLDivElement | undefined;
  let prevFocus: HTMLElement | null = null;

  // Fade in on each open (the overlay only mounts while open, so close is instant).
  createEffect(() => {
    if (viewer.state.open) requestAnimationFrame(() => setShown(true));
    else setShown(false);
  });

  // Re-detect orientation per slide: reset to portrait when the index changes, then
  // the freshly-mounted media's onLoadedMetadata reports its true shape.
  createEffect(on(() => viewer.state.index, () => {
    resetOrientation();
    setMediaError(null);
  }));

  // Body scroll lock + focus management tied to open state.
  createEffect(() => {
    if (viewer.state.open) {
      prevFocus = document.activeElement as HTMLElement | null;
      document.body.style.overflow = "hidden";
      queueMicrotask(() => overlayEl?.focus());
    } else {
      document.body.style.overflow = "";
      prevFocus?.focus();
      prevFocus = null;
    }
  });
  onCleanup(() => {
    document.body.style.overflow = "";
  });

  // Auto-enqueue the settled (dwelt-on) Saved slide only — never items flicked
  // past — so a fast scrub through an undownloaded set isn't a burst of requests.
  createEffect(() => {
    const open = viewer.state.open;
    const idx = viewer.state.index;
    if (!open) return;
    const timer = window.setTimeout(() => {
      untrack(() => {
        const d = viewer.state.items[idx]?.download;
        if (!d) return;
        const s = effStatusFor(d.key, d.dbStatus, downloadQueue.state);
        if (s === "none" || s === "error") d.enqueue();
      });
    }, 400);
    onCleanup(() => clearTimeout(timer));
  });

  // Keyboard controls, active only while open.
  createEffect(() => {
    if (!viewer.state.open) return;
    const onKey = (e: KeyboardEvent): void => {
      switch (e.key) {
        case "Escape":
          viewer.close();
          break;
        case "ArrowRight":
          viewer.next();
          break;
        case "ArrowLeft":
          viewer.prev();
          break;
        case " ":
          if (!shouldHandleMediaShortcut(e.target) || resolved()?.kind !== "video") break;
          e.preventDefault();
          if (videoEl?.paused) void videoEl.play().catch(() => setMediaError(PLAYBACK_FAILED));
          else videoEl?.pause();
          break;
        case "f":
        case "F":
          if (shouldHandleMediaShortcut(e.target) && resolved()?.kind === "video") {
            void videoEl?.requestFullscreen?.();
          }
          break;
        case "m":
        case "M":
          if (shouldHandleMediaShortcut(e.target)) setMuted((v) => !v);
          break;
        case "Tab":
          trapTab(e);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  function trapTab(e: KeyboardEvent): void {
    if (!overlayEl) return;
    const f = Array.from(
      overlayEl.querySelectorAll<HTMLElement>(
        'button, [href], video, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled"));
    if (f.length === 0) {
      e.preventDefault();
      overlayEl.focus();
      return;
    }
    const first = f[0]!;
    const last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  let lastSwipe = 0;
  const onWheel = (e: WheelEvent): void => {
    if (Math.abs(e.deltaX) < 30 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const now = Date.now();
    if (now - lastSwipe < 300) return;
    lastSwipe = now;
    if (e.deltaX > 0) viewer.next();
    else viewer.prev();
  };

  return (
    <Show when={viewer.state.open}>
      <Portal>
        <div
          ref={overlayEl}
          role="dialog"
          aria-modal="true"
          aria-label="Media viewer"
          tabindex={-1}
          onClick={() => viewer.close()}
          onWheel={onWheel}
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 outline-none transition-opacity duration-150"
          classList={{ "opacity-0": !shown(), "opacity-100": shown() }}
        >
          {/* Top bar: counter + close */}
          <div
            class="absolute inset-x-0 top-0 flex items-center justify-between p-4 text-white/90"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center gap-2">
              <span
                role="status"
                aria-live="polite"
                aria-atomic="true"
                class="rounded-full bg-white/10 px-3 py-1 text-sm tabular-nums"
              >
                {viewer.state.index + 1} / {count()}
              </span>
              <Show when={cur()?.sourceRoute}>
                {(route) => (
                  <A
                    href={route().href}
                    class="rounded-full bg-white/10 px-3 py-1 text-sm hover:bg-white/20"
                    onClick={() => viewer.close()}
                  >
                    Back to {route().label}
                  </A>
                )}
              </Show>
            </div>
            <div class="flex items-center gap-2">
              <Show when={cur()?.openExternalUrl}>
                {(url) => (
                  <button
                    type="button"
                    class="rounded-full bg-white/10 px-3 py-1 text-sm hover:bg-white/20"
                    onClick={() => openExternal(url())}
                  >
                    Open original
                  </button>
                )}
              </Show>
              <button
                type="button"
                aria-label="Close"
                class="flex size-9 items-center justify-center rounded-full bg-white/10 text-xl hover:bg-white/20"
                onClick={() => viewer.close()}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Prev / Next */}
          <Show when={true}>
            <button
              type="button"
              aria-label="Previous"
              disabled={viewer.state.index === 0}
              class="absolute left-3 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20 disabled:opacity-35"
              onClick={(e) => {
                e.stopPropagation();
                viewer.prev();
              }}
            >
              ‹
            </button>
          </Show>
          <Show when={true}>
            <button
              type="button"
              aria-label="Next"
              disabled={viewer.state.index >= count() - 1}
              class="absolute right-3 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20 disabled:opacity-35"
              onClick={(e) => {
                e.stopPropagation();
                viewer.next();
              }}
            >
              ›
            </button>
          </Show>

          {/* Stage */}
          <div
            class="flex max-h-[88vh] max-w-[88vw] flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Keyed on index (+1 so index 0 stays truthy) so each slide mounts a
                fresh element: the focused video autoplays and the previous one is
                torn down. Progress ticks don't recreate it (index is stable). */}
            <Show when={viewer.state.index + 1} keyed>
              <Show
                when={!mediaError() && resolved()}
                fallback={
                  <div class="flex flex-col items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-8 py-10 text-center text-white/80">
                    <p
                      class="text-sm"
                      role={mediaError() || isDownloaded(status()) ? "alert" : undefined}
                    >
                      <Show
                        when={mediaError()}
                        fallback={
                          <Show
                            when={status() === "loginWalled"}
                            fallback={
                              isDownloaded(status())
                                ? DOWNLOAD_MISSING
                                : "This post isn't downloaded yet."
                            }
                          >
                            Needs a logged-in session — add a cookies file in Settings.
                          </Show>
                        }
                      >
                        {(message) => message()}
                      </Show>
                    </p>
                    <Show when={!mediaError() && cur()?.download}>
                      <button
                        type="button"
                        disabled={busy()}
                        class="rounded-lg btn-brand px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
                        onClick={() => cur()!.download!.enqueue()}
                      >
                        {busy() ? `Downloading… ${Math.round(progress())}%` : "Download to view"}
                      </button>
                      <Show when={!busy() && status() !== "none" && status() !== "loginWalled"}>
                        <span class="text-xs text-white/60">{statusLabel(status())}</span>
                      </Show>
                    </Show>
                  </div>
                }
              >
                {(r) => (
                  <Show
                    when={r().kind === "video"}
                    fallback={
                      <img
                        src={r().src}
                        alt={cur()?.caption ?? ""}
                        class="max-h-[82vh] max-w-full rounded-lg object-contain"
                        onError={() => setMediaError(mediaFailure(r().src))}
                      />
                    }
                  >
                    <PhoneFrame orientation={orientation()}>
                      <video
                        ref={(el) => (videoEl = el)}
                        src={r().src}
                        poster={r().poster}
                        autoplay={app.autoplay() && !reduced}
                        controls
                        muted={muted()}
                        onLoadedMetadata={(e) => measure(e.currentTarget)}
                        onError={(e) => setMediaError(mediaFailure(r().src, e.currentTarget))}
                        class="block max-h-[78vh] max-w-full"
                      />
                    </PhoneFrame>
                  </Show>
                )}
              </Show>
            </Show>

            <Show when={cur()?.caption || cur()?.timestampMs}>
              <div class="mt-3 max-w-2xl text-center text-white/80">
                <Show when={cur()?.caption}>
                  <p class="max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-sm">
                    {cur()!.caption}
                  </p>
                </Show>
                <Show when={cur()?.timestampMs}>
                  <p class="mt-1 text-xs text-white/50">{fmtTime(cur()!.timestampMs!)}</p>
                </Show>
              </div>
            </Show>
          </div>

          {/* Offscreen preload of the next slide */}
          <Show when={nextResolved()}>
            {(n) => (
              <div
                class="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
                aria-hidden="true"
              >
                <Show
                  when={n().kind === "image"}
                  fallback={<video src={n().src} preload="metadata" />}
                >
                  <img src={n().src} alt="" />
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Portal>
    </Show>
  );
}
