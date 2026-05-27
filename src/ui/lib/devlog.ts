import { invoke } from "@tauri-apps/api/core";

function send(level: "log" | "warn" | "error", args: unknown[]): void {
  const message = args
    .map((a) =>
      a instanceof Error
        ? `${a.name}: ${a.message}\n${a.stack ?? ""}`
        : typeof a === "string"
          ? a
          : JSON.stringify(a),
    )
    .join(" ");
  void invoke("dev_log", { level, message }).catch(() => {});
}

/**
 * DEV-only: mirror WebView console + uncaught errors to the Rust terminal log.
 * Without this, a thrown error just blanks the window with no terminal trace.
 * Call once from main.tsx under `import.meta.env.DEV`.
 */
export function installDevLogging(): void {
  for (const level of ["log", "warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...a: unknown[]) => {
      send(level, a);
      orig(...a);
    };
  }
  window.addEventListener("error", (e) => send("error", [e.message, e.error]));
  window.addEventListener("unhandledrejection", (e) => send("error", ["unhandledrejection", e.reason]));
}
