import type { JSX } from "solid-js";
import { ImportPanel } from "./ImportPanel";
import { Logo } from "./Logo";
import PageHeader from "./PageHeader";
import Surface from "./Surface";

export function Onboarding(): JSX.Element {
  return (
    <div class="h-screen overflow-y-auto bg-bg px-6 py-8 md:py-12">
      <div class="mx-auto w-full max-w-3xl">
        <div class="flex items-center justify-center gap-3">
          <Logo size={40} />
          <span class="text-2xl font-semibold tracking-tight">Demetafy</span>
        </div>
        <div class="mt-8">
          <PageHeader
            title="Your archive, on your terms"
            description="Bring your Instagram or Facebook Download Your Information export into a private library you can browse without uploading it."
          />
        </div>

        <div class="mt-6 grid gap-3">
          <Surface title="Processed on this device" class="!p-4">
            <p class="text-sm leading-6 text-muted">
              Demetafy reads and indexes your archive locally. Nothing is uploaded.
            </p>
          </Surface>
          <Surface title="JSON export + every ZIP part" class="!p-4">
            <p class="text-sm leading-6 text-muted">
              Choose the JSON version of your Instagram or Facebook export and select every ZIP
              part together.
            </p>
          </Surface>
          <Surface title="Network only when you choose it" class="!p-4">
            <p class="text-sm leading-6 text-muted">
              Demetafy only goes online when you ask it to download missing saved media or
              optionally fetch Instagram profile pictures.
            </p>
          </Surface>
        </div>

        <div class="mx-auto mt-8 max-w-sm text-center">
          <ImportPanel />
        </div>
      </div>
    </div>
  );
}
