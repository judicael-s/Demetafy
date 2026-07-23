const INTERACTIVE_TAGS = new Set([
  "A",
  "AUDIO",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "VIDEO",
]);

interface ShortcutTarget {
  tagName?: string;
  isContentEditable?: boolean;
  parentElement?: ShortcutTarget | null;
}

/** True when a viewer shortcut belongs to the media stage instead of focused UI. */
export function shouldHandleMediaShortcut(target: EventTarget | null): boolean {
  let node = target as ShortcutTarget | null;
  while (node) {
    if (node.isContentEditable) return false;
    if (node.tagName && INTERACTIVE_TAGS.has(node.tagName.toUpperCase())) return false;
    node = node.parentElement ?? null;
  }
  return true;
}