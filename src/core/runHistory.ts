import { readdir, readFile, rm, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { RunEnvelopeSchema, type RunEnvelope } from "./runSchema.js";
import { stableStringify } from "./stableStringify.js";
import { defaultRunsDir } from "./runStore.js";
import { defaultVerdictsDir, loadVerdict } from "./verdict.js";

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
/** Shape estrutural mínimo p/ a identidade — satisfeito por RunEnvelope E Scenario (M6). */
export interface ScenarioIdentity {
  name?: string;
  steps: ReadonlyArray<{ request: { method: string; url: string } }>;
}

export function scenarioKey(env: ScenarioIdentity): string {
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
 * Golden run (M6, ADR D1): o run mais recente (ordem total) do cenário `key` cujo
 * `runId` tem verdict `approved`. É o baseline de regressão. `null` se nenhum aprovado
 * (cenário nunca aprovado OU editado desde a aprovação → key órfã = risco #1 resolvido).
 * Filtra por `approved` — NÃO por presença de verdict (que incluiria `rejected`).
 */
export async function findGoldenRun(
  key: string,
  dir: string = defaultRunsDir(),
  verdictsDir: string = defaultVerdictsDir(),
): Promise<RunEnvelope | null> {
  const ofScenario = (await loadAllRuns(dir)).filter((r) => scenarioKey(r) === key).sort(compareRuns);
  // do mais recente p/ o mais antigo: o primeiro aprovado é o golden.
  for (let i = ofScenario.length - 1; i >= 0; i--) {
    const run = ofScenario[i]!;
    const verdict = await loadVerdict(run.runId, verdictsDir);
    if (verdict?.verdict === "approved") return run;
  }
  return null;
}

/**
 * Retenção (ADR D5, risco #2): mantém os `limit` runs mais recentes do `key`,
 * removendo os mais antigos — EXCETO runs aprovados (com `verdicts/{id}.json`),
 * que são PINNED (audit-trail-rotation "approved never rotates"). Clampa limit ≥ 1.
 */
export interface PruneResult {
  removed: number;
  pinned: number;
  kept: number;
}

export async function pruneRunHistory(
  key: string,
  dir: string = defaultRunsDir(),
  limit: number = defaultHistoryLimit(),
  verdictsDir: string = defaultVerdictsDir(),
): Promise<PruneResult> {
  const clamped = Number.isInteger(limit) && limit > 0 ? limit : Math.max(1, defaultHistoryLimit());
  const ofScenario = (await loadAllRuns(dir)).filter((r) => scenarioKey(r) === key).sort(compareRuns);
  const toConsiderForDeletion = ofScenario.slice(0, Math.max(0, ofScenario.length - clamped));
  let removed = 0;
  let pinned = 0;
  for (const run of toConsiderForDeletion) {
    if (await hasVerdict(run.runId, verdictsDir)) {
      pinned += 1; // EC-1: run aprovado é pinado (audit-trail-rotation "approved never rotates")
      continue;
    }
    // F-dom-sec-1 defense-in-depth: o caminho do rm DEVE ficar dentro de `dir`.
    const target = join(dir, `${run.runId}.json`);
    if (resolve(target).startsWith(resolve(dir) + sep)) {
      await rm(target, { force: true });
      removed += 1;
    }
  }
  return { removed, pinned, kept: ofScenario.length - removed };
}

async function hasVerdict(runId: string, verdictsDir: string): Promise<boolean> {
  try {
    await access(join(verdictsDir, `${runId}.json`));
    return true;
  } catch {
    return false;
  }
}
