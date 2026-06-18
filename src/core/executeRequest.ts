import { RequestExecutionError } from "./errors.js";
import type { RunStep } from "./runSchema.js";

/** Input mínimo para executar uma request (espelha o inputSchema da tool MCP). */
export interface RunRequestInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ExecuteOptions {
  /** Timeout em ms antes de abortar a request (default 30000). */
  timeoutMs?: number;
  /** Clock injetável para `startedAt` determinístico em testes (default Date.now). */
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const BODILESS_METHODS = new Set(["GET", "HEAD"]);

/**
 * Executa um HTTP request via `fetch` nativo (ADR D4) e captura `{request, response}`
 * como um RunStep. Status 4xx/5xx são respostas VÁLIDAS (capturadas, não lançam).
 * Apenas falha de rede / abort por timeout lança `RequestExecutionError` (Rule 8).
 */
export async function executeRequest(
  input: RunRequestInput,
  opts: ExecuteOptions = {},
): Promise<RunStep> {
  const { method, url, headers } = input;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // EC-2: fetch lança se GET/HEAD carregam body. Só enviamos body quando o método
  // permite — e a captura reflete o que foi REALMENTE enviado.
  const sendsBody = input.body !== undefined && !BODILESS_METHODS.has(method.toUpperCase());
  const sentBody = sendsBody ? input.body : undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = new Date(now()).toISOString();
  const t0 = performance.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: sentBody,
      signal: controller.signal,
    });
  } catch (cause) {
    const reason = controller.signal.aborted ? `timeout: ${url}` : `request failed: ${url}`;
    throw new RequestExecutionError(reason, { cause });
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Math.max(0, performance.now() - t0);
  const responseBody = await response.text();

  return {
    request: {
      method,
      url,
      headers: headers ?? {},
      ...(sentBody !== undefined ? { body: sentBody } : {}),
    },
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: captureHeaders(response.headers),
      body: responseBody,
      timings: { startedAt, durationMs },
    },
  };
}

/**
 * Captura headers como Record. EC-3: Set-Cookie pode repetir; `getSetCookie()`
 * preserva todos os valores (a iteração padrão os juntaria com `, `).
 */
function captureHeaders(headers: Headers): Record<string, string> {
  const record = Object.fromEntries(headers) as Record<string, string>;
  const setCookies = headers.getSetCookie?.();
  if (setCookies && setCookies.length > 0) {
    record["set-cookie"] = setCookies.join(", ");
  }
  return record;
}
