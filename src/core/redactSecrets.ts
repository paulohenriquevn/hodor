import type { RunEnvelope } from "./runSchema.js";

/**
 * Redação por VALOR de segredos (M7, ADR D3). Substitui cada valor-segredo (e a
 * sua forma `encodeURIComponent` — EC-1: o `interpolateRequest` encoda o valor na
 * URL, então o segredo é persistido encodado) por `<redacted>` em url/headers/body
 * de cada request e na response (body/headers) + captures. COMPLEMENTA a redação
 * por NOME de header do M3 (pega segredo em header não-sensível / body / url).
 * Longest-first (algoritmo do keploy) evita redação parcial quando um segredo é
 * substring de outro. Usa split/join (não regex) — imune a metacaracteres no valor.
 * NUNCA muta o input.
 */
const REDACTED = "<redacted>";

export function redactSecretValues(env: RunEnvelope, values: string[]): RunEnvelope {
  // variantes: valor cru + encodeURIComponent; sem vazios; dedupe; longest-first.
  const variants = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    variants.add(v);
    variants.add(encodeURIComponent(v));
  }
  const ordered = [...variants].sort((a, b) => b.length - a.length);
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
        headers: scrubHeaders(step.response.headers),
        body: scrub(step.response.body),
      },
      ...(step.captures !== undefined ? { captures: scrubCaptures(step.captures) } : {}),
    })),
  };
}
