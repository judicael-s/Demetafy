import { Show, type JSX } from "solid-js";
import { Navigate } from "@solidjs/router";
import { useApp } from "../state/app";

/**
 * Gate a service-specific route. IG-only surfaces (Saved/Stories/Reposts) and the
 * FB-only Albums surface are hidden from the other service's nav, but stay reachable by
 * direct URL or by flipping the service switcher while parked on the route — at which
 * point their unscoped queries would render the wrong service's data inside the other
 * service's chrome. Redirect home instead of leaking.
 */
export function RequireService(props: { service: string; children: JSX.Element }): JSX.Element {
  const app = useApp();
  return (
    <Show when={app.activeService() === props.service} fallback={<Navigate href="/" />}>
      {props.children}
    </Show>
  );
}
