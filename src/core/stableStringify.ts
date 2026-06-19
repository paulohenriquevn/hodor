/**
 * Serialização JSON determinística (ADR D3 do M3): chaves de objeto ordenadas
 * recursivamente, arrays preservados (ordem é significativa — steps são ordenados).
 * Produz bytes idênticos independente da ordem de inserção das chaves → diff-amigável
 * no git. Nativo (`JSON.stringify`), sem dependência (Rule 9 / parsimony rung 2).
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}
