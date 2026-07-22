import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buttonClasses } from "./presentation";

const appCss = readFileSync(new URL("../app.css", import.meta.url), "utf8");

describe("buttonClasses", () => {
  it("keeps a visible focus treatment on every variant", () => {
    for (const variant of ["primary", "secondary", "ghost", "danger"] as const) {
      expect(buttonClasses(variant, "md")).toContain("focus-visible:outline");
    }
  });

  it("gives medium controls a 40px minimum target", () => {
    expect(buttonClasses("secondary", "md")).toContain("min-h-10");
  });

  it("keeps the primary label on a solid accessible accent surface", () => {
    expect(appCss).toContain(
      "linear-gradient(var(--color-accent), var(--color-accent)) padding-box",
    );
    expect(appCss).toContain("var(--ig-gradient) border-box");
    expect(appCss).toContain("border: 1px solid transparent");
  });

  it("ships every semantic token instead of pruning unused utilities", () => {
    expect(appCss).toContain("@theme static");
  });
});
