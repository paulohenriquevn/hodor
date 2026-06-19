import { describe, it, expect } from "vitest";
import { maskNoise } from "./maskNoise.js";

describe("maskNoise", () => {
  it("mask_noise_replaces_matched_path", () => {
    const out = maskNoise('{"ts":1,"ok":true}', ["$.ts"]);
    expect(JSON.parse(out)).toEqual({ ts: "<noise>", ok: true });
  });

  it("mask_noise_leaves_non_matching_paths", () => {
    const body = '{"a":1,"b":2}';
    expect(JSON.parse(maskNoise(body, ["$.zzz"]))).toEqual({ a: 1, b: 2 });
  });

  it("mask_noise_non_json_body_unchanged", () => {
    expect(maskNoise("plain text not json", ["$.ts"])).toBe("plain text not json");
  });

  it("mask_noise_nested_and_array_paths", () => {
    const body = '{"data":[{"id":1,"v":"a"},{"id":2,"v":"b"}],"meta":{"req":"x"}}';
    const out = JSON.parse(maskNoise(body, ["$.data[*].id", "$.meta.req"]));
    expect(out).toEqual({ data: [{ id: "<noise>", v: "a" }, { id: "<noise>", v: "b" }], meta: { req: "<noise>" } });
  });

  it("mask_noise_top_level_array_body", () => {
    const out = JSON.parse(maskNoise('[{"id":1},{"id":2}]', ["$[*].id"]));
    expect(out).toEqual([{ id: "<noise>" }, { id: "<noise>" }]);
  });

  it("mask_noise_empty_rules_returns_equivalent_body", () => {
    expect(JSON.parse(maskNoise('{"a":1}', []))).toEqual({ a: 1 });
  });

  it("mask_noise_malformed_jsonpath_is_noop", () => {
    // EC-11: jsonpath inválido → silenciosamente não-mascara (consistente com evalJsonPath)
    expect(JSON.parse(maskNoise('{"a":1}', ["((("]))).toEqual({ a: 1 });
  });

  it("mask_noise_does_not_mutate_input", () => {
    const body = '{"ts":1}';
    maskNoise(body, ["$.ts"]);
    expect(body).toBe('{"ts":1}');
  });
});
