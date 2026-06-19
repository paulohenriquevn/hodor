import { describe, it, expect } from "vitest";
import { stableStringify } from "./stableStringify.js";

describe("stableStringify", () => {
  it("stable_stringify_orders_object_keys", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("stable_stringify_preserves_array_order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[\n  3,\n  1,\n  2\n]\n");
  });

  it("stable_stringify_sorts_nested_keys", () => {
    const a = stableStringify({ x: { d: 1, c: 2 }, a: [{ z: 1, y: 2 }] });
    const b = stableStringify({ a: [{ y: 2, z: 1 }], x: { c: 2, d: 1 } });
    expect(a).toBe(b);
  });

  it("stable_stringify_ends_with_newline", () => {
    expect(stableStringify({ a: 1 }).endsWith("\n")).toBe(true);
  });
});
