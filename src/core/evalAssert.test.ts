import { describe, it, expect } from "vitest";
import { evalAssert } from "./evalAssert.js";
import type { CapturedResponse } from "./runSchema.js";

function resp(over: Partial<CapturedResponse> = {}): CapturedResponse {
  return {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: '{"ok":true,"n":5}',
    timings: { startedAt: "2026-06-18T00:00:00.000Z", durationMs: 1 },
    ...over,
  };
}

describe("evalAssert", () => {
  it("eval_assert_status_equals", () => {
    expect(evalAssert({ source: "status", op: "equals", value: 200 }, resp()).pass).toBe(true);
  });

  it("eval_assert_header_contains", () => {
    expect(
      evalAssert({ source: "header:content-type", op: "contains", value: "json" }, resp()).pass,
    ).toBe(true);
  });

  it("eval_assert_jsonpath_body", () => {
    expect(evalAssert({ source: "jsonpath:$.ok", op: "equals", value: true }, resp()).pass).toBe(true);
  });

  it("eval_assert_records_expected_and_actual_on_fail", () => {
    const r = evalAssert({ source: "status", op: "equals", value: 404 }, resp());
    expect(r.pass).toBe(false);
    expect(r.expected).toBe(404);
    expect(r.actual).toBe(200);
  });

  it("eval_assert_matches_regex", () => {
    expect(
      evalAssert({ source: "jsonpath:$.n", op: "matches", value: "^\\d+$" }, resp()).pass,
    ).toBe(true);
  });

  it("eval_assert_never_throws_on_bad_source", () => {
    const r = evalAssert({ source: "jsonpath:$.x", op: "equals", value: 1 }, resp({ body: "not json" }));
    expect(r.pass).toBe(false);
    expect(r.actual).toBeNull();
  });

  it("eval_assert_header_case_insensitive", () => {
    // EC-1: source com capitalização ≠ lowercase casa com header lowercased
    expect(
      evalAssert({ source: "header:Content-Type", op: "contains", value: "json" }, resp()).pass,
    ).toBe(true);
  });

  it("eval_assert_contains_coerces_to_string", () => {
    // EC-2: contains sobre actual numérico não lança
    expect(() =>
      evalAssert({ source: "status", op: "contains", value: "20" }, resp()),
    ).not.toThrow();
    expect(evalAssert({ source: "status", op: "contains", value: "20" }, resp()).pass).toBe(true);
  });

  it("eval_assert_numeric_comparisons", () => {
    expect(evalAssert({ source: "status", op: "gt", value: 100 }, resp()).pass).toBe(true);
    expect(evalAssert({ source: "status", op: "gte", value: 200 }, resp()).pass).toBe(true);
    expect(evalAssert({ source: "status", op: "lt", value: 300 }, resp()).pass).toBe(true);
    expect(evalAssert({ source: "status", op: "lte", value: 200 }, resp()).pass).toBe(true);
    expect(evalAssert({ source: "status", op: "gt", value: 999 }, resp()).pass).toBe(false);
  });

  it("eval_assert_not_equals_and_exists", () => {
    expect(evalAssert({ source: "status", op: "notEquals", value: 404 }, resp()).pass).toBe(true);
    expect(evalAssert({ source: "jsonpath:$.ok", op: "exists" }, resp()).pass).toBe(true);
    expect(evalAssert({ source: "jsonpath:$.missing", op: "exists" }, resp()).pass).toBe(false);
  });

  it("eval_assert_unknown_op_is_false", () => {
    // op fora do enum (defensivo) → pass:false, não lança
    expect(evalAssert({ source: "status", op: "weird" as never }, resp()).pass).toBe(false);
  });
});
