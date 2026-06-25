import { describe, it, expect } from "vitest";
import { pickRenderer, truncate, renderBody, MAX_BODY } from "./contentType.js";

describe("pickRenderer (M8 — compartilhado SSR+SPA)", () => {
  it("pick_renderer_json_for_json_content_type", () => {
    expect(pickRenderer("application/json")).toBe("json");
    expect(pickRenderer("application/vnd.api+json")).toBe("json");
  });
  it("pick_renderer_text_for_textual", () => {
    expect(pickRenderer("text/html")).toBe("text");
    expect(pickRenderer("application/xml")).toBe("text");
  });
  it("pick_renderer_binary_when_absent_or_unknown", () => {
    expect(pickRenderer(undefined)).toBe("binary");
    expect(pickRenderer("image/png")).toBe("binary");
  });
});

describe("truncate", () => {
  it("truncate_passes_through_when_small", () => {
    expect(truncate("abc")).toEqual({ text: "abc", truncated: false, originalLength: 3 });
  });
  it("truncate_cuts_when_over_max", () => {
    const big = "x".repeat(MAX_BODY + 10);
    const r = truncate(big);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(MAX_BODY);
    expect(r.originalLength).toBe(MAX_BODY + 10);
  });
});

describe("renderBody", () => {
  it("render_body_pretty_prints_json", () => {
    const r = renderBody('{"a":1}', "application/json");
    expect(r.kind).toBe("json");
    expect(r.text).toBe('{\n  "a": 1\n}');
  });
  it("render_body_falls_back_to_text_when_json_invalid", () => {
    const r = renderBody("{not json", "application/json");
    expect(r.kind).toBe("text");
    expect(r.text).toBe("{not json");
  });
  it("render_body_binary_returns_empty_text", () => {
    const r = renderBody("\x00\x01", "image/png");
    expect(r.kind).toBe("binary");
    expect(r.text).toBe("");
  });
});
