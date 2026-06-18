import { evalJsonPath } from "./evalCapture.js";
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
    // DRY (F-arch-1): reusa o único avaliador jsonpath do domínio.
    return evalJsonPath(source.slice("jsonpath:".length), response.body);
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
      // F-dom-4: actual ausente NÃO contém nada (evita falso-positivo "null").
      if (actual === null || actual === undefined) return false;
      return String(actual).includes(String(expected));
    case "matches":
      if (actual === null || actual === undefined) return false;
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
