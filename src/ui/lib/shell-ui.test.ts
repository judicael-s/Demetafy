import { describe, expect, it } from "vitest";
import { searchShortcutLabel } from "./shell-ui";

describe("searchShortcutLabel", () => {
  it("uses Ctrl on Windows", () => expect(searchShortcutLabel("Win32")).toBe("Ctrl K"));
  it("uses Command on macOS", () => expect(searchShortcutLabel("MacIntel")).toBe("⌘ K"));
});
