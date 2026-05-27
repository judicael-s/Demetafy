export type Theme = "dark" | "light";

const KEY = "demetafy-theme";

/**
 * Effective theme: an explicit user choice wins; otherwise follow the OS
 * (`prefers-color-scheme`). Reading does NOT persist — opening Settings must
 * not silently pin a value, or the OS default could never apply again.
 */
export function resolveTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Apply to the DOM only (no persistence). Safe to call pre-paint. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Apply + remember as the explicit override. Call from the toggle, not on load. */
export function persistTheme(theme: Theme): void {
  applyTheme(theme);
  localStorage.setItem(KEY, theme);
}
