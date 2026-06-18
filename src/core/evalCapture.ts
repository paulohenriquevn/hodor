import { JSONPath } from "jsonpath-plus";
import type { CaptureSpec } from "./scenarioSchema.js";
import type { CapturedResponse } from "./runSchema.js";

/**
 * Captura de variável (ADR D2): jsonpath (primeiro match) e/ou regex sobre o
 * body. Encapsula `jsonpath-plus` (usado SÓ para path queries — sem eval/script).
 * Miss / body não-JSON / regex sem match → `null` (nunca lança — EC do plano).
 */
export function evalCapture(spec: CaptureSpec, response: CapturedResponse): unknown {
  let value: unknown = response.body;

  if (spec.jsonpath !== undefined) {
    try {
      const json = JSON.parse(response.body) as string | number | boolean | object | null;
      const matches = JSONPath({ path: spec.jsonpath, json, wrap: true }) as unknown[];
      value = matches.length > 0 ? matches[0] : null;
    } catch {
      return null;
    }
  }

  if (spec.regex !== undefined && value !== null && value !== undefined) {
    const m = new RegExp(spec.regex).exec(String(value));
    value = m ? (m[1] ?? m[0]) : null;
  }

  return value;
}
