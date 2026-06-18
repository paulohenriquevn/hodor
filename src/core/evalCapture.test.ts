import { describe, it, expect } from "vitest";
import { evalCapture } from "./evalCapture.js";
import type { CapturedResponse } from "./runSchema.js";

function resp(body: string): CapturedResponse {
  return {
    status: 200,
    statusText: "OK",
    headers: {},
    body,
    timings: { startedAt: "2026-06-18T00:00:00.000Z", durationMs: 1 },
  };
}

describe("evalCapture", () => {
  it("eval_capture_extracts_jsonpath", () => {
    expect(evalCapture({ jsonpath: "$.id" }, resp('{"id":7}'))).toBe(7);
  });

  it("eval_capture_returns_null_on_miss", () => {
    expect(evalCapture({ jsonpath: "$.x" }, resp('{"id":7}'))).toBeNull();
  });

  it("eval_capture_returns_null_on_non_json_body", () => {
    expect(evalCapture({ jsonpath: "$.id" }, resp("<html>not json</html>"))).toBeNull();
  });

  it("eval_capture_applies_regex", () => {
    expect(evalCapture({ regex: "v(\\d+)" }, resp("version v42 released"))).toBe("42");
  });
});
