import { JSONPath } from "jsonpath-plus";
import type { AssertSpec } from "./scenarioSchema.js";
import type { AssertResult, CapturedResponse } from "./runSchema.js";

/**
 * Avaliação de assert (ADR D3): `{source, op, value}` → `{pass, expected, actual}`.
 * source: "status" | "header:<name>" | "jsonpath:<expr>". Nunca lança — erro de
 * extração vira `actual:null, pass:false`.
 */
export function evalAssert(assert: AssertSpec, response: CapturedResponse): AssertResult {
  const actual = extractActual(assert.source, response);
  const pass = applyOp(assert.op, actual, assert.value);
  return {
    source: assert.source,
    op: assert.op,
    value: assert.value,
    pass,
    expected: assert.value,
    actual,
  };
}

function extractActual(source: string, response: CapturedResponse): unknown {
  if (source === "status") return response.status;

  if (source.startsWith("header:")) {
    // EC-1: headers capturados pelo M0 são lowercased → lookup case-insensitive.
    const name = source.slice("header:".length).toLowerCase();
    return response.headers[name];
  }

  if (source.startsWith("jsonpath:")) {
    const path = source.slice("jsonpath:".length);
    try {
      const json = JSON.parse(response.body) as string | number | boolean | object | null;
      const matches = JSONPath({ path, json, wrap: true }) as unknown[];
      return matches.length > 0 ? matches[0] : null;
    } catch {
      return null;
    }
  }

  return null;
}

function applyOp(op: string, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case "equals":
      return actual === expected;
    case "notEquals":
      return actual !== expected;
    case "contains":
      // EC-2: coerção a string antes de includes (actual pode ser numérico).
      return String(actual).includes(String(expected));
    case "matches":
      return new RegExp(String(expected)).test(String(actual));
    case "exists":
      return actual !== null && actual !== undefined;
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    default:
      return false;
  }
}
