import type { RunScenarioDeps } from "./runScenario.js";
import { listDrafts, loadDraft, defaultDraftsDir } from "./draftStore.js";
import { checkScenario, type CheckStatus } from "./checkScenario.js";
import { scenarioKey } from "./runHistory.js";
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
}

export interface SuiteReport {
  allOk: boolean;
  total: number;
  ok: number;
  regression: number;
  noBaseline: number;
  error: number;
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

  const report: SuiteReport = { allOk: true, total: 0, ok: 0, regression: 0, noBaseline: 0, error: 0, results: [] };
  for (const id of await listDrafts(draftsDir)) {
    const draft = await loadDraft(id, draftsDir);
    if (draft === null) continue; // draft sumiu entre list e load — pula
    report.total += 1;
    let status: SuiteStatus;
    try {
      status = (await checkScenario(draft, { deps: options.deps, runsDir, verdictsDir })).status;
    } catch {
      // EC-1: serviço-alvo caído / erro de execução → isola este cenário, não aborta a suíte.
      status = "error";
    }
    if (status === "ok") report.ok += 1;
    else if (status === "regression") report.regression += 1;
    else if (status === "no_baseline") report.noBaseline += 1;
    else report.error += 1;
    report.results.push({ scenarioKey: scenarioKey(draft), status });
  }
  report.allOk = report.regression === 0 && report.error === 0;
  return report;
}
