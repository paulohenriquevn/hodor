import { JSONPath } from "jsonpath-plus";

/**
 * Normalização de NOISE no corpo (M5, ADR D2 — field-normalization do keploy).
 * Substitui cada path de `noisePaths` (jsonpath) no body JSON por uma sentinela
 * VISÍVEL `"<noise>"` (mascarar, não deletar — auditável, espelha a redação de
 * headers do `normalizeRun`). Body não-JSON ou path sem match → inalterado.
 * Path malformado → no-op silencioso (consistente com `evalJsonPath`). Nunca lança.
 *
 * Usa `jsonpath-plus` (já dep) com `resultType:"all"` p/ localizar nó+pai e mascarar
 * o pai — sem dep nova. O `JSON.parse` cria uma cópia própria, então o input (string)
 * nunca é mutado.
 */
export const NOISE_SENTINEL = "<noise>";

export function maskNoise(body: string, noisePaths: string[]): string {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return body; // body não-JSON: nada a mascarar
  }
  for (const path of noisePaths) {
    try {
      const nodes = JSONPath({ path, json, resultType: "all", wrap: true }) as Array<{
        parent: Record<string, unknown> | unknown[] | null;
        parentProperty: string | number | null;
      }>;
      for (const node of nodes) {
        if (node.parent != null && node.parentProperty != null) {
          (node.parent as Record<string | number, unknown>)[node.parentProperty] = NOISE_SENTINEL;
        }
      }
    } catch {
      // jsonpath malformado → no-op (não mascara, não derruba o diff)
    }
  }
  return JSON.stringify(json);
}
