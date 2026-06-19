import { mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ScenarioSchema, type Scenario } from "./scenarioSchema.js";
import { ProvenanceSchema } from "./provenance.js";
import { redactRequestHeaders } from "./normalizeRun.js";
import { stableStringify } from "./stableStringify.js";

/**
 * Persistência de DRAFTS de cenário (M4, ADR D4). Um draft é a ENTRADA candidata
 * gerada pelo agente — NÃO executada, NÃO aprovada. Vive em `drafts/{id}.json`
 * COMMITÁVEL para o humano editar/refinar no git antes de aprovar (DoD #3).
 * A aprovação NUNCA acontece aqui — é o Verdict (M2) + reviews/ (M3). Determinístico
 * (stableStringify) e validado na fronteira (zod). Espelha reviewArtifact (path-safety).
 */

/** Aceita uma URL absoluta OU um template de interpolação (`${{ var }}` do M1). */
function isUrlOrTemplate(url: string): boolean {
  if (url.includes("${{")) return true; // resolvido em run-time (interpolação M1)
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Um draft SEMPRE tem proveniência (é gerado ou autorado — a origem importa).
// EC-2: a url de cada step deve ser URL válida OU template — rejeita lixo ("not a url")
// na fronteira (fail-fast), sem quebrar a interpolação `${{ }}` do M1.
export const DraftSchema = ScenarioSchema.extend({ provenance: ProvenanceSchema }).superRefine((draft, ctx) => {
  draft.steps.forEach((step, i) => {
    if (!isUrlOrTemplate(step.request.url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps", i, "request", "url"],
        message: `invalid url: ${JSON.stringify(step.request.url)} (deve ser URL absoluta ou template \${{ var }})`,
      });
    }
  });
});
export type Draft = z.infer<typeof DraftSchema>;

/** Diretório de drafts (default `drafts/`, override por env). COMMITÁVEL. */
export function defaultDraftsDir(): string {
  return process.env.HODOR_DRAFTS_DIR ?? "drafts";
}

const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/;

function assertSafeId(id: string): void {
  if (!SAFE_ID_RE.test(id) || id === "." || id === "..") {
    throw new Error(`unsafe draft id for path: ${JSON.stringify(id)}`);
  }
}

export interface SaveDraftOptions {
  /** Id explícito; quando omitido, gera um randomUUID (path-safe por construção). */
  id?: string;
  /** Diretório de destino (default `drafts/`). */
  dir?: string;
}

/**
 * Valida (DraftSchema) e grava o draft determinístico em `${dir}/${id}.json`.
 * `id` omitido → randomUUID. Id já existente → erro (EC-1: sem overwrite silencioso;
 * sobrescrever exige id novo, para não perder um candidato a revisar).
 */
export async function saveDraft(
  scenario: Scenario,
  options: SaveDraftOptions = {},
): Promise<{ draftId: string; path: string }> {
  const valid = DraftSchema.parse(scenario);
  // F-sec-1: o draft é COMMITÁVEL — redige credenciais ANTES de gravar (mesma defesa
  // do artefato de review M3; reusa o SoT redactRequestHeaders). Sem isso, um
  // Authorization/Cookie no request do cenário gerado vazaria no git.
  const redacted = redactDraftSecrets(valid);
  const dir = options.dir ?? defaultDraftsDir();
  const draftId = options.id ?? randomUUID();
  assertSafeId(draftId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${draftId}.json`);
  if (await fileExists(path)) {
    throw new Error(`draft already exists: ${draftId} (use a new id to avoid overwriting a candidate)`);
  }
  await writeFile(path, stableStringify(redacted), "utf8");
  return { draftId, path };
}

const SECRET_IN_TEXT_RE =
  /\b(authorization|cookie|x-api-key|api-key|x-auth-token|proxy-authorization)\b(\s*[:=]\s*)(\S[^"'\\]*)/gi;
const BEARER_RE = /\b(Bearer)\s+\S+/gi;

/**
 * Redige credenciais do cenário antes de persistir o draft commitável (F-sec-1):
 * - headers de request sensíveis → `<redacted>` (reusa o SoT do M3);
 * - melhor-esforço no `provenance.sourceRef` (ex.: curl com `-H "Authorization: ..."`).
 * NÃO muta o input. Resíduo conhecido: segredos embutidos em URL/body do cenário
 * não são redigidos (o agente não deve embuti-los; documentado no CHANGELOG § Security).
 */
function redactDraftSecrets(draft: Draft): Draft {
  const steps = draft.steps.map((step) =>
    step.request.headers
      ? { ...step, request: { ...step.request, headers: redactRequestHeaders(step.request.headers) } }
      : step,
  );
  const sourceRef = draft.provenance.sourceRef
    ? draft.provenance.sourceRef.replace(SECRET_IN_TEXT_RE, "$1$2<redacted>").replace(BEARER_RE, "$1 <redacted>")
    : draft.provenance.sourceRef;
  return {
    ...draft,
    provenance: { ...draft.provenance, ...(sourceRef !== undefined ? { sourceRef } : {}) },
    steps,
  };
}

/** Lê e VALIDA um draft; ausente → `null`. Inválido → lança (fail-loud). */
export async function loadDraft(id: string, dir: string = defaultDraftsDir()): Promise<Draft | null> {
  let raw: string;
  try {
    raw = await readFile(join(dir, `${id}.json`), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return DraftSchema.parse(JSON.parse(raw));
}

/**
 * Lista os ids de drafts VÁLIDOS em `dir`. Diretório inexistente → `[]` (EC-3).
 * Arquivos corrompidos são pulados (não derrubam a listagem — espelha M2).
 */
export async function listDrafts(dir: string = defaultDraftsDir()): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -".json".length);
    try {
      if (await loadDraft(id, dir)) ids.push(id);
    } catch {
      // arquivo corrompido — pula (não 500)
    }
  }
  return ids;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
