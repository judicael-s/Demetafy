import { describe, expect, it } from "vitest";
import { shouldHandleMediaShortcut } from "./media-controls";
import { getAutoplayEnabled, setAutoplayEnabled } from "./settings";

function target(
  tagName: string,
  options: { contentEditable?: boolean; parent?: EventTarget | null } = {},
): EventTarget {
  return {
    tagName,
    isContentEditable: options.contentEditable ?? false,
    parentElement: options.parent ?? null,
  } as unknown as EventTarget;
}

describe("autoplay preference", () => {
  it("defaults missing and malformed storage values to false", () => {
    for (const value of [null, "", "yes", "true", "2"]) {
      const storage = { getItem: () => value };
      expect(getAutoplayEnabled(storage)).toBe(false);
    }
  });

  it("round-trips explicit enabled and disabled values", () => {
    let value: string | null = null;
    const storage = {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    };
    setAutoplayEnabled(true, storage);
    expect(getAutoplayEnabled(storage)).toBe(true);
    setAutoplayEnabled(false, storage);
    expect(getAutoplayEnabled(storage)).toBe(false);
  });
});

describe("shouldHandleMediaShortcut", () => {
  it("handles shortcuts on the media stage", () => {
    expect(shouldHandleMediaShortcut(target("DIV"))).toBe(true);
    expect(shouldHandleMediaShortcut(null)).toBe(true);
  });

  it.each(["INPUT", "BUTTON", "SELECT", "TEXTAREA"])(
    "ignores shortcuts from %s",
    (tagName) => {
      expect(shouldHandleMediaShortcut(target(tagName))).toBe(false);
    },
  );

  it("ignores contenteditable targets and their descendants", () => {
    const editor = target("DIV", { contentEditable: true });
    expect(shouldHandleMediaShortcut(editor)).toBe(false);
    expect(shouldHandleMediaShortcut(target("SPAN", { parent: editor }))).toBe(false);
  });

  it.each(["AUDIO", "VIDEO"])("ignores native %s controls", (tagName) => {
    expect(shouldHandleMediaShortcut(target(tagName))).toBe(false);
  });
});