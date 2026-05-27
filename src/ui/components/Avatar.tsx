import { createSignal, Show, type JSX } from "solid-js";
import { dmediaUrl } from "../lib/media";

/**
 * A monogram avatar (initials on a color hashed from the handle) — the deterministic
 * stand-in, since the DYI archive contains no profile pictures for other people.
 * When `src` is supplied (a cached image path from the opt-in IG avatar fetch) the
 * real photo is shown instead, falling back to the monogram if it fails to load.
 */
const COLORS = [
  "#e1306c",
  "#c13584",
  "#833ab4",
  "#5851db",
  "#405de6",
  "#1d9bf0",
  "#0f9d58",
  "#fb8c00",
  "#f59e0b",
  "#ef4444",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The avatar's background color for a name — exported so sender labels in
 *  group chats can match their avatar. Deterministic. */
export function avatarColor(name: string): string {
  return COLORS[hash(name) % COLORS.length]!;
}

function initials(name: string): string {
  const cleaned = name.replace(/^@/, "").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/[._\s-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

export function Avatar(props: { name: string; src?: string; class?: string }): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  const color = (): string => avatarColor(props.name);
  return (
    <Show
      when={props.src && !failed()}
      fallback={
        <div
          class={`flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ${props.class ?? "size-9 text-xs"}`}
          style={{ "background-color": color() }}
          aria-hidden="true"
        >
          {initials(props.name)}
        </div>
      }
    >
      <img
        src={dmediaUrl(props.src!)}
        alt=""
        aria-hidden="true"
        class={`shrink-0 rounded-full bg-surface-2 object-cover ${props.class ?? "size-9"}`}
        onError={() => setFailed(true)}
      />
    </Show>
  );
}
