import { describe, expect, it } from "vitest";
import { createViewer, type ViewerItem } from "./viewer";

const items = (n: number): ViewerItem[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `test:${i}`,
    kind: "image" as const,
    src: `s${i}`,
    sourceRoute: { label: "Test source", href: "/test" },
  }));

describe("createViewer", () => {
  it("starts closed and empty", () => {
    const v = createViewer();
    expect(v.state.open).toBe(false);
    expect(v.state.items).toEqual([]);
    expect(v.state.index).toBe(0);
  });

  it("open() sets items, index, and the open flag", () => {
    const v = createViewer();
    v.open(items(3), 1);
    expect(v.state.open).toBe(true);
    expect(v.state.items.length).toBe(3);
    expect(v.state.index).toBe(1);
  });

  it("open() clamps an out-of-range index", () => {
    const v = createViewer();
    v.open(items(3), 99);
    expect(v.state.index).toBe(2);
  });

  it("open() ignores an empty set (stays closed)", () => {
    const v = createViewer();
    v.open([], 0);
    expect(v.state.open).toBe(false);
  });

  it("next()/prev() clamp at the ends (no wrap)", () => {
    const v = createViewer();
    v.open(items(2), 0);
    v.prev();
    expect(v.state.index).toBe(0);
    v.next();
    expect(v.state.index).toBe(1);
    v.next();
    expect(v.state.index).toBe(1);
  });

  it("preserves stable keys and source routes through open, next, and prev", () => {
    const v = createViewer();
    const original = items(3);
    v.open(original, 1);
    expect(v.state.items[v.state.index]).toMatchObject({
      key: "test:1",
      sourceRoute: { label: "Test source", href: "/test" },
    });
    v.next();
    expect(v.state.items[v.state.index]?.key).toBe("test:2");
    v.prev();
    expect(v.state.items[v.state.index]).toBe(original[1]);
  });

  it("goTo() clamps", () => {
    const v = createViewer();
    v.open(items(3), 0);
    v.goTo(5);
    expect(v.state.index).toBe(2);
    v.goTo(-3);
    expect(v.state.index).toBe(0);
  });

  it("close() clears the open flag", () => {
    const v = createViewer();
    v.open(items(1), 0);
    v.close();
    expect(v.state.open).toBe(false);
  });
});
