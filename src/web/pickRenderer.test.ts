import { describe, it, expect } from "vitest";
import { pickRenderer, truncate } from "./render.js";

describe("pickRenderer", () => {
  it("pick_renderer_json_for_json_content_type", () => {
    expect(pickRenderer("application/json")).toBe("json");
    expect(pickRenderer("application/vnd.api+json")).toBe("json");
  });

  it("pick_renderer_text_for_textual", () => {
    expect(pickRenderer("text/html")).toBe("text");
    expect(pickRenderer("application/xml")).toBe("text");
  });

  it("pick_renderer_binary_for_non_text_or_missing", () => {
    expect(pickRenderer("image/png")).toBe("binary");
    expect(pickRenderer(undefined)).toBe("binary");
    expect(pickRenderer("application/octet-stream")).toBe("binary");
  });

  it("pick_renderer_case_insensitive", () => {
    expect(pickRenderer("APPLICATION/JSON")).toBe("json");
    expect(pickRenderer("TEXT/PLAIN")).toBe("text");
  });
});

describe("truncate", () => {
  it("truncate_marks_large_text", () => {
    const big = "x".repeat(100_000);
    const r = truncate(big, 64 * 1024);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(64 * 1024);
    expect(r.originalLength).toBe(100_000);
  });

  it("truncate_leaves_small_text", () => {
    const r = truncate("hi");
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("hi");
  });
});
