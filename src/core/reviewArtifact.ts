import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CapturedRequestSchema, AssertResultSchema, type RunEnvelope } from "./runSchema.js";
import { VerdictSchema, type Verdict } from "./verdict.js";
import { normalizeRun } from "./normalizeRun.js";
import { stableStringify } from "./stableStringify.js";

/**
 * Artefato de review versionável (ADR D1/D4 do M3): cenário + run normalizado +
 * verdict, em arquivo texto determinístico commitável (`reviews/{runId}.json`).
 * `artifactVersion` versiona o formato desde o início (risco #2). Validação na
 * fronteira (zod). NÃO muta o run bruto (runs/ permanece efêmero).
 */

// Step normalizado: resposta SEM timings (volátil), headers já filtrados.
const NormalizedStepSchema = z.object({
  request: CapturedRequestSchema,
  response: z.object({
    status: z.number(),
    statusText: z.string(),
    headers: z.record(z.string()),
    body: z.string(),
  }),
  asserts: z.array(AssertResultSchema).optional(),
  captures: z.record(z.unknown()).optional(),
});

export const ReviewArtifactSchema = z.object({
  artifactVersion: z.literal(1),
  scenarioName: z.string().optional(),
  runId: z.string().min(1),
  createdAt: z.string(),
  verdict: VerdictSchema,
  steps: z.array(NormalizedStepSchema).min(1),
});

export type ReviewArtifact = z.infer<typeof ReviewArtifactSchema>;

/** Diretório de artefatos de review (default `reviews/`, override por env). COMMITÁVEL. */
export function defaultReviewsDir(): string {
  return process.env.HODOR_REVIEWS_DIR ?? "reviews";
}

/** Monta o artefato versionável: normaliza o run e embute o verdict. */
export function buildReviewArtifact(env: RunEnvelope, verdict: Verdict): ReviewArtifact {
  const normalized = normalizeRun(env);
  return {
    artifactVersion: 1,
    ...(normalized.scenarioName !== undefined ? { scenarioName: normalized.scenarioName } : {}),
    runId: env.runId,
    createdAt: env.createdAt,
    verdict,
    steps: normalized.steps,
  };
}

/**
 * `runId` usado como nome de arquivo NÃO pode conter separadores de path nem `..`
 * (defense-in-depth — F-sec-2: o runId vem do conteúdo do run, não só da URL já
 * validada). Aceita o formato dos IDs do projeto (hex + hífen) e nada mais.
 */
const SAFE_RUN_ID_RE = /^[A-Za-z0-9._-]+$/;

function assertSafeRunId(runId: string): void {
  if (!SAFE_RUN_ID_RE.test(runId) || runId === "." || runId === "..") {
    throw new Error(`unsafe runId for artifact path: ${JSON.stringify(runId)}`);
  }
}

/** Valida (fronteira) e grava o artefato determinístico em `${dir}/${runId}.json`. */
export async function saveReviewArtifact(
  artifact: ReviewArtifact,
  dir: string = defaultReviewsDir(),
): Promise<string> {
  const valid = ReviewArtifactSchema.parse(artifact);
  assertSafeRunId(valid.runId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${valid.runId}.json`);
  await writeFile(path, stableStringify(valid), "utf8");
  return path;
}

/** Lê e VALIDA um artefato de review; ausente → `null`. Inválido → lança (fail-loud). */
export async function loadReviewArtifact(
  runId: string,
  dir: string = defaultReviewsDir(),
): Promise<ReviewArtifact | null> {
  let raw: string;
  try {
    raw = await readFile(join(dir, `${runId}.json`), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return ReviewArtifactSchema.parse(JSON.parse(raw));
}
