import { describe, expect, it } from "vitest";
import { orientationOf } from "./media-orientation";

describe("orientationOf", () => {
  it("is landscape when wider than tall", () => {
    expect(orientationOf(1920, 1080)).toBe("landscape");
    expect(orientationOf(16, 9)).toBe("landscape");
  });

  it("is portrait when taller than wide", () => {
    expect(orientationOf(1080, 1920)).toBe("portrait");
    expect(orientationOf(9, 16)).toBe("portrait");
  });

  it("treats a square as portrait", () => {
    expect(orientationOf(500, 500)).toBe("portrait");
  });

  it("defaults to portrait when dimensions are unknown (zeros)", () => {
    expect(orientationOf(0, 0)).toBe("portrait");
    expect(orientationOf(0, 500)).toBe("portrait");
    expect(orientationOf(500, 0)).toBe("portrait");
  });
});
