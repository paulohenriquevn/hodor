import type { RunEnvelope, RunStep, AssertResult } from "./runSchema.js";

/**
 * Normalização de campos voláteis (ADR D2 do M3 — espelha o conceito de "noise"
 * do keploy). Remove o que muda entre execuções idênticas (timings, headers
 * voláteis) para que dois runs do mesmo cenário gerem um artefato diff-estável.
 * Lista de voláteis EXPLÍCITA e inspecionável (risco #1). NUNCA muta o input.
 */
export const VOLATILE_HEADERS: ReadonlySet<string> = new Set([
  "date",
  "age",
  "expires",
  "last-modified",
  "etag",
  "x-request-id",
  "set-cookie",
  "cf-ray",
  "cf-cache-status",
  "server-timing",
  "report-to",
]);

export interface NormalizedStep {
  request: RunStep["request"];
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
  };
  asserts?: AssertResult[];
  captures?: Record<string, unknown>;
}

export interface NormalizedRun {
  scenarioName?: string;
  steps: NormalizedStep[];
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!VOLATILE_HEADERS.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

function normalizeStep(step: RunStep): NormalizedStep {
  // response sem `timings` (volátil) e com headers voláteis removidos.
  const normalized: NormalizedStep = {
    request: { ...step.request, headers: { ...step.request.headers } },
    response: {
      status: step.response.status,
      statusText: step.response.statusText,
      headers: normalizeHeaders(step.response.headers),
      body: step.response.body,
    },
  };
  if (step.asserts) normalized.asserts = step.asserts;
  if (step.captures) normalized.captures = step.captures;
  return normalized;
}

export function normalizeRun(env: RunEnvelope): NormalizedRun {
  return {
    ...(env.name !== undefined ? { scenarioName: env.name } : {}),
    steps: env.steps.map(normalizeStep),
  };
}
