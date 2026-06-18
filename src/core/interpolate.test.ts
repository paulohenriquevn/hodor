import { describe, it, expect } from "vitest";
import { interpolate, interpolateRequest } from "./interpolate.js";
import { ScenarioError } from "./errors.js";

describe("interpolate", () => {
  it("interpolate_substitutes_variable", () => {
    expect(interpolate("/p/${{ id }}", { id: 42 })).toBe("/p/42");
  });

  it("interpolate_throws_on_undefined_variable", () => {
    expect(() => interpolate("/x/${{ missing }}", {})).toThrow(ScenarioError);
  });

  it("interpolate_leaves_plain_template_unchanged", () => {
    expect(interpolate("/static/path", { id: 1 })).toBe("/static/path");
  });

  it("interpolate_request_encodes_url_value", () => {
    const out = interpolateRequest(
      { method: "GET", url: "https://api.test/q/${{ q }}" },
      { q: "a b/c?d" },
    );
    // espaço, / e ? devem ser percent-encoded na URL
    expect(out.url).toBe("https://api.test/q/a%20b%2Fc%3Fd");
  });
});
