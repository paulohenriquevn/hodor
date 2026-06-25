import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { loadRun, defaultRunsDir } from "./runStore.js";
import { loadVerdict, defaultVerdictsDir, type Verdict } from "./verdict.js";
import { scenarioKey, findGoldenRunIn } from "./runHistory.js";
import { diffRuns } from "./diffRuns.js";
import type { RunEnvelope } from "./runSchema.js";

/**
 * Item da listagem de runs. Extraído de `src/web/server.ts::listRuns` no M8 para
 * ser fonte ÚNICA consumida pelo SSR (`src/web`) E pela API REST (`src/api`) — DRY:
 * a lógica de golden/regressão por item é não-trivial e não pode divergir.
 */
export interface ListingItem {
  runId: string;
  name?: string;
  createdAt: string;
  stepCount: number;
  allAssertsPass: boolean | null;
  verdict: Verdict["verdict"] | null;
  /** M4: origem do cenário (badge "gerado pelo agente"). Ausente em runs M0-M3. */
  origin?: "agent-generated" | "human-authored";
  /** M6: este run regride vs o golden aprovado do cenário. Best-effort. */
  regression?: boolean;
  /** M6.1: este run É o golden (baseline aprovado atual) do cenário. Best-effort. */
  isGolden?: boolean;
}

/** UUID v-agnóstico de arquivo de run — allowlist anti path-traversal (EC-1 M0). */
export const RUN_ID_RE = /^[0-9a-f-]{36}$/i;

/** ✓ se todos os asserts de todos os steps passaram; null se não há asserts (run M0). */
function passFail(env: RunEnvelope): boolean | null {
  const asserts = env.steps.flatMap((s) => s.asserts ?? []);
  if (asserts.length === 0) return null;
  return asserts.every((a) => a.pass);
}

/**
 * Monta a listagem de runs (mais recente primeiro). Um run corrompido é PULADO
 * (EC-2: não derruba a listagem inteira). Carrega todos os runs UMA vez (evita
 * O(N²) — F-arch-1 do M6) e reusa o parse para o cálculo de golden/regressão por
 * linha. Delegação pura ao core: sem regra de negócio nova.
 */
export async function buildListing(
  dir: string = defaultRunsDir(),
  verdictsDir: string = defaultVerdictsDir(),
): Promise<ListingItem[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const files = entries.filter(
    (e) => e.endsWith(".json") && RUN_ID_RE.test(e.slice(0, -".json".length)),
  );
  const loaded: Array<{ id: string; env: RunEnvelope; mtimeMs: number }> = [];
  for (const file of files) {
    const id = file.slice(0, -".json".length);
    try {
      loaded.push({
        id,
        env: await loadRun(join(dir, file)),
        mtimeMs: (await stat(join(dir, file))).mtimeMs,
      });
    } catch {
      continue; // EC-2: pula arquivo corrompido
    }
  }
  const allEnvs = loaded.map((l) => l.env);
  const items: Array<ListingItem & { mtimeMs: number }> = [];
  for (const { id, env, mtimeMs } of loaded) {
    const verdict = await loadVerdict(id, verdictsDir);
    let regression = false;
    let isGolden = false;
    try {
      const golden = await findGoldenRunIn(allEnvs, scenarioKey(env), verdictsDir);
      isGolden = golden !== null && golden.runId === id;
      regression = golden !== null && golden.runId !== id && diffRuns(golden, env).hasRegression;
    } catch {
      regression = false; // falha no cálculo do golden não derruba a listagem
    }
    items.push({
      runId: id,
      name: env.name,
      createdAt: env.createdAt,
      stepCount: env.steps.length,
      allAssertsPass: passFail(env),
      verdict: verdict?.verdict ?? null,
      origin: env.provenance?.origin,
      regression,
      isGolden,
      mtimeMs,
    });
  }
  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items.map(({ mtimeMs: _omit, ...item }) => item);
}
