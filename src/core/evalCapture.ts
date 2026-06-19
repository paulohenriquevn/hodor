import { JSONPath } from "jsonpath-plus";
import type { CaptureSpec } from "./scenarioSchema.js";
import type { CapturedResponse } from "./runSchema.js";

/**
 * Avalia um jsonpath sobre um body de texto (READ — primeiro match). Ponto de
 * leitura de `jsonpath-plus` no domínio (`evalAssert` consome este helper). O M5
 * `maskNoise` usa o mesmo lib em modo `resultType:"all"` p/ mascarar — mesmo
 * vocabulário jsonpath. Usa SÓ path queries (sem eval/script). Body não-JSON / miss → `null`.
 */
export function evalJsonPath(path: string, body: string): unknown {
  try {
    const json = JSON.parse(body) as string | number | boolean | object | null;
    const matches = JSONPath({ path, json, wrap: true }) as unknown[];
    return matches.length > 0 ? matches[0] : null;
  } catch {
    return null;
  }
}

/**
 * Captura de variável (ADR D2): jsonpath (primeiro match) e/ou regex sobre o
 * body. Miss / body não-JSON / regex sem match → `null` (nunca lança — EC do plano).
 */
export function evalCapture(spec: CaptureSpec, response: CapturedResponse): unknown {
  let value: unknown = response.body;

  if (spec.jsonpath !== undefined) {
    value = evalJsonPath(spec.jsonpath, response.body);
  }

  if (spec.regex !== undefined && value !== null && value !== undefined) {
    const m = new RegExp(spec.regex).exec(String(value));
    value = m ? (m[1] ?? m[0]) : null;
  }

  return value;
}
