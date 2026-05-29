import { createResource, For, Show, type JSX } from "solid-js";
import { useApp } from "../state/app";
import { fetchProfileChanges } from "../lib/queries";
import { ArchiveImage } from "../components/ArchiveMedia";
import { ArchiveCompletion } from "../components/ArchiveCompletion";
import { EmptyState } from "../components/EmptyState";
import { vmediaUrl } from "../lib/media";
import { viewer } from "../state/viewer";

export default function Profile(): JSX.Element {
  const app = useApp();
  const [changes] = createResource(
    () => app.activeArchiveId(),
    (id) => fetchProfileChanges(id ?? undefined),
  );
  const p = () => app.profile();

  const rows = (): Array<[string, string]> => {
    const x = p();
    if (!x) return [];
    const out: Array<[string, string]> = [];
    const push = (k: string, v: string | null | undefined) => {
      if (v) out.push([k, v]);
    };
    if (x.username) push("Username", `@${x.username}`); // Facebook has no handle
    push("Email", x.email);
    push("Phone", x.phone);
    push("Gender", x.gender);
    push("Date of birth", x.date_of_birth);
    push("Country", x.country_code);
    push("Account", x.is_private ? "Private" : "Public");
    push("Facebook ID", x.fbid);
    push("Last login", x.last_login_at ? new Date(x.last_login_at).toLocaleString() : null);
    return out;
  };

  return (
    <div class="flex h-full flex-col">
      <div class="shrink-0 border-b border-border px-8 py-5">
        <h1 class="text-2xl font-semibold tracking-tight">Profile</h1>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <Show
          when={p()}
          fallback={
            <EmptyState
              icon="profile"
              title="No profile in this archive"
              hint="This export didn't include profile information."
            />
          }
        >
          {(prof) => (
            <div class="mx-auto max-w-2xl">
              <div class="flex items-center gap-4">
                <div class="size-20 shrink-0 overflow-hidden rounded-full bg-surface-2">
                  <Show
                    when={prof().profile_photo_uri}
                    fallback={
                      <div class="flex h-full w-full items-center justify-center text-2xl text-muted">
                        {prof().display_name.charAt(0).toUpperCase() || "?"}
                      </div>
                    }
                  >
                    <button
                      type="button"
                      class="block h-full w-full transition-opacity hover:opacity-90"
                      onClick={() =>
                        viewer.open(
                          [{ kind: "image", src: vmediaUrl(prof().profile_photo_uri!) }],
                          0,
                        )
                      }
                    >
                      <ArchiveImage
                        uri={prof().profile_photo_uri!}
                        class="h-full w-full object-cover"
                      />
                    </button>
                  </Show>
                </div>
                <div class="min-w-0">
                  <h2 class="truncate text-xl font-semibold">{prof().display_name}</h2>
                  <Show when={prof().username}>
                    <p class="text-sm text-muted">@{prof().username}</p>
                  </Show>
                </div>
              </div>

              <dl class="mt-6 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
                <For each={rows()}>
                  {([k, v]) => (
                    <>
                      <dt class="text-muted">{k}</dt>
                      <dd class="break-words text-ink">{v}</dd>
                    </>
                  )}
                </For>
              </dl>

              {/* Link-only downloads: IG saved + DM shares, FB DM-shared videos.
                  FB post/album media is offline in-zip, so the card is conversation-scoped. */}
              <div class="mt-8">
                <ArchiveCompletion
                  archiveId={app.activeArchiveId() ?? undefined}
                  service={app.activeService() ?? undefined}
                />
              </div>

              <Show when={(changes()?.length ?? 0) > 0}>
                <h3 class="mt-8 text-sm font-medium text-ink">Change history</h3>
                <ul class="mt-3 space-y-2">
                  <For each={changes()}>
                    {(c) => (
                      <li
                        class="rounded-lg border border-border bg-surface p-3 text-sm"
                        classList={{ "!border-accent": c.field === "Profile Name" }}
                      >
                        <div class="flex items-baseline justify-between gap-3">
                          <span class="font-medium text-ink">{c.field}</span>
                          <span class="text-xs text-muted">
                            {new Date(c.changedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <p class="mt-1 text-muted">
                          <span class="line-through">{c.previousValue || "—"}</span>
                          <span class="mx-1.5">→</span>
                          <span class="text-ink">{c.newValue || "—"}</span>
                        </p>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
