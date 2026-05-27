import type { JSX } from "solid-js";
import { ImportPanel } from "./ImportPanel";
import { Logo } from "./Logo";

export function Onboarding(): JSX.Element {
  return (
    <div class="flex h-screen items-center justify-center bg-bg px-6">
      <div class="w-full max-w-md text-center">
        <div class="flex items-center justify-center gap-3">
          <Logo size={40} />
          <span class="text-2xl font-semibold tracking-tight">Demetafy</span>
        </div>
        <h1 class="mt-8 text-3xl font-semibold tracking-tight">No archive imported yet</h1>
        <p class="mx-auto mt-3 text-sm text-muted">
          Import your Instagram “Download Your Information” export to browse your profile, saved
          collections, messages, and stories — fully offline.
        </p>
        <div class="mt-8 text-left">
          <ImportPanel />
        </div>
        <p class="mt-4 text-xs text-muted">
          Everything stays on this device. Nothing is uploaded.
        </p>
      </div>
    </div>
  );
}
