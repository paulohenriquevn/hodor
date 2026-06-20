import type { RunEnvelope } from "./runSchema.js";

/**
 * Redação por VALOR de segredos (M7, ADR D3). Substitui cada valor-segredo (e suas
 * formas codificadas — o segredo é persistido em variantes diferentes conforme o
 * sink) por `<redacted>` em TODO campo string do run. COMPLEMENTA a redação por
 * NOME de header do M3 (pega segredo em header não-sensível / body / url / statusText).
 *
 * Variantes cobertas por valor (review M7): cru; `encodeURIComponent` (url via
 * `interpolateRequest`); `encodeURI` (defensivo); JSON-escaped (`JSON.stringify`
 * inner — segredo com aspas/barras no body JSON). Longest-first (algoritmo do
 * keploy) evita redação parcial. Usa split/join (imune a metacaracteres). NUNCA muta.
 */
const REDACTED = "<redacted>";

/** Constrói as variantes ordenadas (longest-first, sem vazios) de uma lista de valores. */
function secretVariants(values: string[]): string[] {
  const variants = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    variants.add(v);
    variants.add(encodeURIComponent(v));
    variants.add(encodeURI(v));
    variants.add(JSON.stringify(v).slice(1, -1)); // forma JSON-escaped (sem as aspas externas)
  }
  return [...variants].filter(Boolean).sort((a, b) => b.length - a.length);
}

/** Redige cada variante de segredo de uma string plana (ex.: mensagem de erro — WIRE-1). */
export function scrubSecretsFromText(text: string, values: string[]): string {
  let out = text;
  for (const variant of secretVariants(values)) out = out.split(variant).join(REDACTED);
  return out;
}

export function redactSecretValues(env: RunEnvelope, values: string[]): RunEnvelope {
  const ordered = secretVariants(values);
  if (ordered.length === 0) return env;

  const scrub = (s: string): string => {
    let out = s;
    for (const val of ordered) out = out.split(val).join(REDACTED);
    return out;
  };
  const scrubHeaders = (h: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) out[k] = scrub(v);
    return out;
  };
  const scrubCaptures = (c: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c)) out[k] = typeof v === "string" ? scrub(v) : v;
    return out;
  };

  return {
    ...env,
    // F-xval-2: o nome do cenário (autorado) também é redigido por completude.
    ...(env.name !== undefined ? { name: scrub(env.name) } : {}),
    steps: env.steps.map((step) => ({
      ...step,
      request: {
        ...step.request,
        url: scrub(step.request.url),
        headers: scrubHeaders(step.request.headers),
        ...(step.request.body !== undefined ? { body: scrub(step.request.body) } : {}),
      },
      response: {
        ...step.response,
        // F-xval-1: statusText (reason phrase) é persistido E vai p/ o review — redige.
        statusText: scrub(step.response.statusText),
        headers: scrubHeaders(step.response.headers),
        body: scrub(step.response.body),
      },
      ...(step.captures !== undefined ? { captures: scrubCaptures(step.captures) } : {}),
    })),
  };
}
