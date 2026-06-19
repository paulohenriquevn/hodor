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
  "request-id",
  "x-correlation-id",
  "x-amzn-trace-id",
  "x-amz-request-id",
  "x-amz-id-2",
  "set-cookie",
  "cf-ray",
  "cf-cache-status",
  "cf-request-id",
  "x-cache",
  "via",
  "traceparent",
  "tracestate",
  "server-timing",
  "report-to",
]);

/**
 * Prefixos de headers voláteis (cloud/CDN/tracing) — espelha o `noiseIndex.match`
 * por substring do keploy. Qualquer header cujo nome (lowercase) comece com um
 * destes é removido na normalização.
 */
export const VOLATILE_HEADER_PREFIXES: readonly string[] = ["x-amz-", "x-amzn-", "cf-"];

/**
 * Headers de REQUEST sensíveis (credenciais): o artefato de review é COMMITÁVEL
 * (vai para o git / PR), então o VALOR é redigido (`<redacted>`) — a chave é
 * preservada para que o revisor veja que o header existia, sem vazar o segredo
 * (F-sec-1). NUNCA grava credencial em arquivo versionável.
 */
export const SENSITIVE_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-amz-security-token",
  "x-csrf-token",
]);

const REDACTED = "<redacted>";

function isVolatileHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return VOLATILE_HEADERS.has(lower) || VOLATILE_HEADER_PREFIXES.some((p) => lower.startsWith(p));
}

/** Redige credenciais nos headers de request; preserva chaves não-sensíveis.
 * Exportado como SoT (DRY) — reusado pelo draftStore (M4) p/ não vazar segredo
 * no artefato commitável de draft (mesma defesa do artefato de review). */
export function redactRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_REQUEST_HEADERS.has(k.toLowerCase()) ? REDACTED : v;
  }
  return out;
}

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
    if (!isVolatileHeader(k)) out[k] = v;
  }
  return out;
}

function normalizeStep(step: RunStep): NormalizedStep {
  // response sem `timings` (volátil) e com headers voláteis removidos;
  // request com credenciais redigidas (artefato commitável — F-sec-1).
  const normalized: NormalizedStep = {
    request: { ...step.request, headers: redactRequestHeaders(step.request.headers) },
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
