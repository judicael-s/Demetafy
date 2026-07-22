export function searchShortcutLabel(platform: string): string {
  return platform.startsWith("Mac") ? "⌘ K" : "Ctrl K";
}
