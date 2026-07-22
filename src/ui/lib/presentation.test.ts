import { describe, expect, it } from "vitest";
import { buttonClasses } from "./presentation";

describe("buttonClasses", () => {
  it("keeps a visible focus treatment on every variant", () => {
    for (const variant of ["primary", "secondary", "ghost", "danger"] as const) {
      expect(buttonClasses(variant, "md")).toContain("focus-visible:outline");
    }
  });

  it("gives medium controls a 40px minimum target", () => {
    expect(buttonClasses("secondary", "md")).toContain("min-h-10");
  });
});
