import { For, Show, type JSX } from "solid-js";
import { A } from "@solidjs/router";
import { Icon, type IconName } from "./Icon";
import { Logo } from "./Logo";
import { useApp } from "../state/app";
import type { ArchiveAccount } from "../lib/queries";

interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  end?: boolean;
  /** Services this surface applies to; omitted = shown for every service. */
  services?: string[];
}

const NAV: NavItem[] = [
  { label: "Home", href: "/", icon: "home", end: true },
  { label: "Feed", href: "/feed", icon: "feed" },
  { label: "Profile", href: "/profile", icon: "profile" },
  { label: "Saved", href: "/saved", icon: "saved", services: ["instagram"] },
  { label: "Messages", href: "/dms", icon: "dms" },
  { label: "Stories", href: "/stories", icon: "stories", services: ["instagram"] },
  { label: "Reposts", href: "/reposts", icon: "reposts", services: ["instagram"] },
  { label: "Posts", href: "/posts", icon: "posts", services: ["instagram", "facebook"] },
  { label: "Albums", href: "/albums", icon: "albums", services: ["facebook"] },
  { label: "Connections", href: "/connections", icon: "connections" },
];

const SERVICE_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
};
const serviceLabel = (s: string): string =>
  SERVICE_LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

/** Switcher label for one imported account: its handle, falling back to the
 *  display name, then the service. */
const accountLabel = (a: ArchiveAccount): string =>
  a.username ? `@${a.username}` : (a.displayName ?? serviceLabel(a.service));

const LINK_CLASS =
  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink";

export function Sidebar(): JSX.Element {
  const app = useApp();
  // Service-aware nav: only the active service's surfaces. Before anything is
  // imported (activeService null) we show everything, matching the empty-state UI.
  const nav = () => {
    const svc = app.activeService();
    return NAV.filter((item) => !item.services || svc === null || item.services.includes(svc));
  };

  return (
    <nav
      aria-label="Primary"
      class="flex w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5"
    >
      <div class="flex items-center gap-2.5 px-3 pb-6">
        <Logo size={32} />
        <span class="text-xl font-semibold tracking-tight">Demetafy</span>
      </div>

      <Show when={app.archives().length >= 2}>
        <div
          class="mb-4 flex flex-col gap-1 rounded-lg bg-surface-2 p-1"
          role="tablist"
          aria-label="Account"
        >
          <For each={app.archives()}>
            {(acc) => (
              <button
                type="button"
                role="tab"
                aria-selected={app.activeArchiveId() === acc.id}
                onClick={() => void app.setActiveArchive(acc.id)}
                class="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors"
                classList={{
                  "bg-accent text-accent-ink": app.activeArchiveId() === acc.id,
                  "text-muted hover:text-ink": app.activeArchiveId() !== acc.id,
                }}
              >
                <span class="truncate text-xs font-medium">{accountLabel(acc)}</span>
                <span class="shrink-0 text-[10px] font-medium uppercase tracking-wide opacity-70">
                  {serviceLabel(acc.service)}
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <ul class="flex flex-1 flex-col gap-1">
        <For each={nav()}>
          {(item) => (
            <li>
              <A href={item.href} end={item.end} class={LINK_CLASS} activeClass="!bg-surface-2 !text-ink">
                <Icon name={item.icon} />
                {item.label}
              </A>
            </li>
          )}
        </For>
      </ul>

      <A href="/settings" end class={LINK_CLASS} activeClass="!bg-surface-2 !text-ink">
        <Icon name="settings" />
        Settings
      </A>
    </nav>
  );
}
