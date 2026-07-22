import { describe, expect, it } from "vitest";
import { focusMainContent, searchShortcutLabel } from "./shell-ui";

describe("searchShortcutLabel", () => {
  it("uses Ctrl on Windows", () => expect(searchShortcutLabel("Win32")).toBe("Ctrl K"));
  it("uses Command on macOS", () => expect(searchShortcutLabel("MacIntel")).toBe("⌘ K"));
});

describe("focusMainContent", () => {
  it("focuses the target before scrolling it to the start", () => {
    const calls: Array<[string, unknown]> = [];
    const target = {
      focus: (options?: FocusOptions) => calls.push(["focus", options]),
      scrollIntoView: (options?: ScrollIntoViewOptions) => calls.push(["scroll", options]),
    };

    expect(focusMainContent(target)).toBe(true);
    expect(calls).toEqual([
      ["focus", { preventScroll: true }],
      ["scroll", { block: "start" }],
    ]);
  });

  it("does nothing when the target is missing", () => {
    expect(focusMainContent(null)).toBe(false);
  });
});
