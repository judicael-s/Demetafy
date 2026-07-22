export function searchShortcutLabel(platform: string): string {
  return platform.startsWith("Mac") ? "⌘ K" : "Ctrl K";
}

interface MainContentTarget {
  focus(options?: FocusOptions): void;
  scrollIntoView(options?: ScrollIntoViewOptions): void;
}

export function focusMainContent(target: MainContentTarget | null): boolean {
  if (target === null) return false;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "start" });
  return true;
}
