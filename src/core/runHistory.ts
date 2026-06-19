import { readdir, readFile, rm, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { RunEnvelopeSchema, type RunEnvelope } from "./runSchema.js";
import { stableStringify } from "./stableStringify.js";
import { defaultRunsDir } from "./runStore.js";
import { defaultVerdictsDir } from "./verdict.js";

/**
 * Histórico + retenção de runs (M5, ADR D4/D5). Identidade de cenário p/ agrupar
 * execuções comparáveis; "anterior" por ordem total; retenção last-N por cenário
 * que NUNCA descarta um run aprovado (verdict presente — audit-trail-rotation).
 */

/** Limite default de runs por cenário (env `HODOR_RUN_HISTORY_LIMIT`). */
export function defaultHistoryLimit(): number {
  const raw = Number(process.env.HODOR_RUN_HISTORY_LIMIT);
  return Number.isInteger(raw) && raw > 0 ? raw : 10;
}

/**
 * Identidade estável de um cenário (ADR D4): `name` quando presente, senão um
 * sha256 dos `{method,url}` dos steps (mesmo cenário → mesma key). Espelha keploy
 * (identidade = conteúdo do cenário, não o id da execução).
 */
export function scenarioKey(env: RunEnvelope): string {
  if (env.name !== undefined && env.name !== "") return env.name;
  const shape = env.steps.map((s) => ({ method: s.request.method, url: s.request.url }));
  return createHash("sha256").update(stableStringify(shape)).digest("hex");
}

/** Ordem total determinística (EC-3): por `createdAt`, desempata por `runId`. */
function compareRuns(a: RunEnvelope, b: RunEnvelope): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0;
}

/** Carrega todos os runs válidos de `dir` (tolera arquivos corrompidos — não derruba). */
async function loadAllRuns(dir: string): Promise<RunEnvelope[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const runs: RunEnvelope[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      runs.push(RunEnvelopeSchema.parse(JSON.parse(await readFile(join(dir, entry), "utf8"))));
    } catch {
      // run corrompido — pula (não derruba histórico/poda)
    }
  }
  return runs;
}

/**
 * Run imediatamente anterior ao `curr` do MESMO cenário (ADR D4) por ordem total;
 * `null` se `curr` for o primeiro do cenário.
 */
export async function findPreviousRun(curr: RunEnvelope, dir: string = defaultRunsDir()): Promise<RunEnvelope | null> {
  const key = scenarioKey(curr);
  const earlier = (await loadAllRuns(dir))
    .filter((r) => r.runId !== curr.runId && scenarioKey(r) === key && compareRuns(r, curr) < 0)
    .sort(compareRuns);
  return earlier.length > 0 ? earlier[earlier.length - 1]! : null;
}

/**
 * Retenção (ADR D5, risco #2): mantém os `limit` runs mais recentes do `key`,
 * removendo os mais antigos — EXCETO runs aprovados (com `verdicts/{id}.json`),
 * que são PINNED (audit-trail-rotation "approved never rotates"). Clampa limit ≥ 1.
 */
export async function pruneRunHistory(
  key: string,
  dir: string = defaultRunsDir(),
  limit: number = defaultHistoryLimit(),
  verdictsDir: string = defaultVerdictsDir(),
): Promise<void> {
  const clamped = Number.isInteger(limit) && limit > 0 ? limit : Math.max(1, defaultHistoryLimit());
  const ofScenario = (await loadAllRuns(dir)).filter((r) => scenarioKey(r) === key).sort(compareRuns);
  const toConsiderForDeletion = ofScenario.slice(0, Math.max(0, ofScenario.length - clamped));
  for (const run of toConsiderForDeletion) {
    if (await hasVerdict(run.runId, verdictsDir)) continue; // EC-1: aprovado é pinado
    await rm(join(dir, `${run.runId}.json`), { force: true });
  }
}

async function hasVerdict(runId: string, verdictsDir: string): Promise<boolean> {
  try {
    await access(join(verdictsDir, `${runId}.json`));
    return true;
  } catch {
    return false;
  }
}
