import { ScenarioError } from "./errors.js";

/**
 * Interpolação de variáveis capturadas (ADR D2). Substitui `${{ var }}` num
 * template pelo valor em `variables`. Variável ausente → `ScenarioError`
 * (fail-fast, Q2). Variáveis são flat (sem prefixo `captures.` — EC-4).
 */

const PLACEHOLDER_RE = /\$\{\{\s*([\w.]+)\s*\}\}/g;

export function interpolate(template: string, variables: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER_RE, (_match, name: string) => {
    if (!(name in variables)) {
      throw new ScenarioError(`undefined variable in template: ${name}`);
    }
    return String(variables[name]);
  });
}

interface InterpolatableRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Interpola um request inteiro. Na URL, o valor interpolado é `encodeURIComponent`
 * (EC-3) para não quebrar a rota / abrir query string com caracteres especiais.
 */
export function interpolateRequest(
  request: InterpolatableRequest,
  variables: Record<string, unknown>,
): InterpolatableRequest {
  const urlEncodedVars: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(variables)) {
    urlEncodedVars[k] = encodeURIComponent(String(v));
  }
  const result: InterpolatableRequest = {
    method: request.method,
    url: interpolate(request.url, urlEncodedVars),
  };
  if (request.headers) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(request.headers)) {
      headers[k] = interpolate(v, variables);
    }
    result.headers = headers;
  }
  if (request.body !== undefined) {
    result.body = interpolate(request.body, variables);
  }
  return result;
}
