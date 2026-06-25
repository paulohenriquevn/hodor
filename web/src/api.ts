import type { ListingItem, RunResponse, DiffResponse, Draft, ReviewArtifact } from "./types";

/**
 * Cliente HTTP tipado da API REST (ADR-4). Centraliza o `fetch` (DRY). Erro HTTP
 * vira exceção explícita (CLAUDE.md §8 — nunca engole). Base configurável para os
 * testes E2E apontarem a uma API real em porta efêmera.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let base = "";
/** Aponta o cliente a uma base (usado pelo E2E p/ a API real em porta efêmera). */
export function setApiBase(b: string): void {
  base = b.replace(/\/$/, "");
}

/** Extrai a mensagem `{error}` do servidor (envelope uniforme) p/ surfaçar contexto. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res, `GET ${path} → ${res.status}`));
  return (await res.json()) as T;
}

export function fetchRuns(): Promise<ListingItem[]> {
  return get<ListingItem[]>("/api/runs");
}
export function fetchRun(id: string): Promise<RunResponse> {
  return get<RunResponse>(`/api/runs/${encodeURIComponent(id)}`);
}
export function fetchDiff(id: string, vs: "golden" | "previous"): Promise<DiffResponse> {
  return get<DiffResponse>(`/api/runs/${encodeURIComponent(id)}/diff?vs=${vs}`);
}
export function fetchDrafts(): Promise<string[]> {
  return get<string[]>("/api/drafts");
}
export function fetchDraft(id: string): Promise<Draft> {
  return get<Draft>(`/api/drafts/${encodeURIComponent(id)}`);
}
export function fetchReview(id: string): Promise<ReviewArtifact> {
  return get<ReviewArtifact>(`/api/reviews/${encodeURIComponent(id)}`);
}

/** Registra o verdict humano (nunca auto-aprova — contrato M2). Retorna o artefato. */
export async function postVerdict(
  id: string,
  body: { verdict: "approved" | "rejected"; note?: string },
): Promise<ReviewArtifact> {
  const res = await fetch(`${base}/api/runs/${encodeURIComponent(id)}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res, `POST verdict → ${res.status}`));
  return (await res.json()) as ReviewArtifact;
}
