import { For, Show, type JSX } from "solid-js";
import { A } from "@solidjs/router";
import { useApp } from "../state/app";
import { ArchiveCompletion } from "../components/ArchiveCompletion";
import { ArchiveImage } from "../components/ArchiveMedia";
import { ImportPanel } from "../components/ImportPanel";

/** Services Demetafy can parse today. Threads/Meta is out (no parser pack yet). */
const IMPORTABLE = ["instagram", "facebook"] as const;
const SERVICE_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook" };
const serviceLabel = (s: string): string => SERVICE_LABEL[s] ?? s;

interface StatCard {
  label: string;
  value: number;
  sub: string;
  /** Optional: a tile with no route renders as static (currently every tile links). */
  href?: string;
}

function CardInner(props: { card: StatCard }): JSX.Element {
  return (
    <>
      <div class="text-3xl font-semibold tabular-nums">{props.card.value.toLocaleString()}</div>
      <div class="mt-1 text-sm font-medium text-ink">{props.card.label}</div>
      <div class="text-xs text-muted">{props.card.sub}</div>
    </>
  );
}

function StatTile(props: { card: StatCard }): JSX.Element {
  const base = "rounded-xl border border-border bg-surface p-5";
  return (
    <Show
      when={props.card.href}
      fallback={
        <div class={base}>
          <CardInner card={props.card} />
        </div>
      }
    >
      {(href) => (
        <A href={href()} class={`${base} transition-colors hover:border-accent`}>
          <CardInner card={props.card} />
        </A>
      )}
    </Show>
  );
}

export default function Home(): JSX.Element {
  const app = useApp();

  const cards = (): StatCard[] => {
    const o = app.overview();
    if (!o) return [];
    if (app.activeService() === "facebook") {
      return [
        { label: "Posts", value: o.posts, sub: "timeline", href: "/posts" },
        { label: "Albums", value: o.albums, sub: "photos", href: "/albums" },
        { label: "Messages", value: o.messages, sub: `${o.threads} threads`, href: "/dms" },
      ];
    }
    return [
      { label: "Saved", value: o.savedItems, sub: `${o.collections} collections`, href: "/saved" },
      { label: "Messages", value: o.messages, sub: `${o.threads} threads`, href: "/dms" },
      { label: "Stories", value: o.stories, sub: "archived", href: "/stories" },
      { label: "Reposts", value: o.reposts, sub: "shared", href: "/reposts" },
      { label: "Posts", value: o.ownPosts, sub: "your media", href: "/posts" },
    ];
  };

  const ingestedAt = () => {
    const a = app.activeArchive();
    return a ? new Date(a.ingestedAt).toLocaleString() : "";
  };

  // The first parseable service not yet imported, so Home can offer to add it
  // (symmetric: IG-first offers Facebook, FB-first offers Instagram). null = all in.
  const missingService = (): string | null => {
    const have = new Set(app.services());
    return IMPORTABLE.find((s) => !have.has(s)) ?? null;
  };

  return (
    <div class="mx-auto max-w-5xl px-8 py-10">
      <div class="flex items-center gap-4">
        <Show when={app.profile()}>
          {(prof) => (
            <div class="size-14 shrink-0 overflow-hidden rounded-full bg-surface-2">
              <Show
                when={prof().profile_photo_uri}
                fallback={
                  <div class="flex h-full w-full items-center justify-center text-xl text-muted">
                    {prof().display_name.charAt(0).toUpperCase() || "?"}
                  </div>
                }
              >
                <ArchiveImage uri={prof().profile_photo_uri!} class="h-full w-full object-cover" />
              </Show>
            </div>
          )}
        </Show>
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">
            Welcome back{app.profile()?.display_name ? `, ${app.profile()!.display_name}` : ""}
          </h1>
          <p class="mt-1 text-sm text-muted">Your archive, browsable offline.</p>
        </div>
      </div>

      <div class="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <For each={cards()}>{(c) => <StatTile card={c} />}</For>
      </div>

      <Show when={missingService()}>
        {(svc) => (
          <div class="mt-8 rounded-xl border border-border bg-surface p-5">
            <h2 class="text-sm font-medium text-ink">Add your {serviceLabel(svc())} archive</h2>
            <p class="mb-4 mt-1 text-sm text-muted">
              Import your {serviceLabel(svc())} export to browse it alongside
              {app.activeService() ? ` ${serviceLabel(app.activeService()!)}` : " your other data"} —
              a service switcher appears in the sidebar once you have both.
              <Show when={svc() === "facebook"}>
                {" "}
                Select every <span class="font-mono">facebook-…</span> .zip part together (Meta
                splits the export across files).
              </Show>
            </p>
            <ImportPanel compact />
          </div>
        )}
      </Show>

      <Show when={app.activeArchive()}>
        {/* "Complete my archive" fetches the link-only content yt-dlp must download:
            Instagram saved + DM shares, Facebook DM-shared reels/videos. FB post and
            album media is already offline in-zip, so the card scopes to conversations. */}
        <div class="mt-8">
          <ArchiveCompletion
            archiveId={app.activeArchiveId() ?? undefined}
            service={app.activeService() ?? undefined}
          />
        </div>
        <div class="mt-6 rounded-xl border border-border bg-surface p-5">
          <h2 class="text-sm font-medium text-ink">Imported archive</h2>
          <dl class="mt-3 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt class="text-muted">Service</dt>
            <dd class="capitalize">{app.activeArchive()!.service}</dd>
            <dt class="text-muted">Imported</dt>
            <dd>{ingestedAt()}</dd>
            <dt class="text-muted">Source</dt>
            <dd class="truncate font-mono text-xs text-muted">{app.activeArchive()!.sourcePath}</dd>
          </dl>
        </div>
      </Show>
    </div>
  );
}
