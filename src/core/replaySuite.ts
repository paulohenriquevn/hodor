import type { RunScenarioDeps } from "./runScenario.js";
import { listDrafts, loadDraft, defaultDraftsDir } from "./draftStore.js";
import { checkScenario, type CheckStatus } from "./checkScenario.js";
import { scenarioKey, goldenScenarioKeys } from "./runHistory.js";
import { defaultRunsDir } from "./runStore.js";
import { defaultVerdictsDir } from "./verdict.js";

/**
 * Replay de suíte (M6, ADR D3/D5). Itera o catálogo (`drafts/` — única fonte dos
 * specs de cenário) e roda `checkScenario` por item, ISOLADO em try/catch (EC-1):
 * um serviço-alvo caído vira `status:"error"` para AQUELE cenário e NÃO derruba a
 * suíte. Agrega pass/fail. `no_baseline` e cenário novo não contam como falha;
 * `allOk = regression===0 && error===0`.
 */
export type SuiteStatus = CheckStatus | "error";

export interface SuiteItemResult {
  scenarioKey: string;
  status: SuiteStatus;
  /** Razão do erro quando status==="error" (F-dom-5: não engole a causa). */
  error?: string;
}

export interface SuiteReport {
  allOk: boolean;
  total: number;
  ok: number;
  regression: number;
  noBaseline: number;
  error: number;
  /** Cenários que TÊM golden aprovado mas NÃO estão catalogados em drafts/ (F-dom-2):
   * a suíte NÃO os cobre — o agente precisa saber p/ não ter falso senso de cobertura. */
  uncataloguedGoldens: number;
  results: SuiteItemResult[];
}

export interface ReplaySuiteOptions {
  deps?: RunScenarioDeps;
  draftsDir?: string;
  runsDir?: string;
  verdictsDir?: string;
}

export async function replaySuite(options: ReplaySuiteOptions = {}): Promise<SuiteReport> {
  const draftsDir = options.draftsDir ?? defaultDraftsDir();
  const runsDir = options.runsDir ?? defaultRunsDir();
  const verdictsDir = options.verdictsDir ?? defaultVerdictsDir();

  const report: SuiteReport = { allOk: true, total: 0, ok: 0, regression: 0, noBaseline: 0, error: 0, uncataloguedGoldens: 0, results: [] };
  const cataloguedKeys = new Set<string>();
  for (const id of await listDrafts(draftsDir)) {
    const draft = await loadDraft(id, draftsDir);
    if (draft === null) continue; // draft sumiu entre list e load — pula
    const key = scenarioKey(draft);
    cataloguedKeys.add(key);
    report.total += 1;
    let status: SuiteStatus;
    let error: string | undefined;
    try {
      status = (await checkScenario(draft, { deps: options.deps, runsDir, verdictsDir })).status;
    } catch (err) {
      // EC-1: serviço-alvo caído / erro de execução → isola este cenário, não aborta a suíte.
      // F-dom-5: registra a causa em vez de engolir (não confunde target-down com bug interno).
      status = "error";
      error = err instanceof Error ? err.message : String(err);
    }
    if (status === "ok") report.ok += 1;
    else if (status === "regression") report.regression += 1;
    else if (status === "no_baseline") report.noBaseline += 1;
    else report.error += 1;
    report.results.push({ scenarioKey: key, status, ...(error !== undefined ? { error } : {}) });
  }
  // F-dom-2: goldens existentes que não estão no catálogo → fora da suíte (cobertura honesta).
  const goldenKeys = await goldenScenarioKeys(runsDir, verdictsDir);
  for (const k of goldenKeys) if (!cataloguedKeys.has(k)) report.uncataloguedGoldens += 1;
  report.allOk = report.regression === 0 && report.error === 0;
  return report;
}
