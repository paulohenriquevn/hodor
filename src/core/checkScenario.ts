import type { Scenario } from "./scenarioSchema.js";
import type { RunEnvelope } from "./runSchema.js";
import type { RunDiff } from "./diffRuns.js";
import { runScenario, type RunScenarioDeps } from "./runScenario.js";
import { scenarioKey, findGoldenRun } from "./runHistory.js";
import { diffRuns } from "./diffRuns.js";
import { redactSecretValues } from "./redactSecrets.js";
import { defaultRunsDir } from "./runStore.js";
import { defaultVerdictsDir } from "./verdict.js";

/**
 * Gate de regressão (M6, ADR D2/D5). RE-RODA o cenário via `runScenario` (recaptura
 * tokens frescos — o golden tem captures resolvidos/velhos), acha o golden aprovado
 * do cenário e compara o run novo vs golden via `diffRuns` (M5). Retorna um veredito
 * 3-way consumível por máquina. NÃO persiste e NÃO grava verdict (humano é o único
 * aprovador — o adaptador persiste o run novo). Teto sem-auth: endpoint autenticado
 * pode dar falso `regression` (401) até o M7 (env/secrets).
 */
export type CheckStatus = "ok" | "regression" | "no_baseline";

export interface CheckResult {
  status: CheckStatus;
  diff: RunDiff | null;
  run: RunEnvelope;
  /** runId do golden comparado (F-dom-4: o agente busca o diff completo via web). */
  goldenRunId: string | null;
  /** as regras de noise diferem entre o golden e o cenário atual (F-dom-1): mesmo
   * com status `ok`, uma regressão pode ter sido mascarada — sinal p/ o agente revisar. */
  noiseChanged: boolean;
}

export interface CheckScenarioOptions {
  deps?: RunScenarioDeps;
  runsDir?: string;
  verdictsDir?: string;
}

export async function checkScenario(scenario: Scenario, options: CheckScenarioOptions = {}): Promise<CheckResult> {
  const runsDir = options.runsDir ?? defaultRunsDir();
  const verdictsDir = options.verdictsDir ?? defaultVerdictsDir();
  // Re-executa o cenário contra o serviço atual (specs frescos na fronteira — D2).
  const executed = await runScenario(scenario, options.deps);
  // M7 (T1.3): redige os valores de segredo ANTES do diff e do retorno — senão o
  // golden (já redigido) vs run com token real daria falso diff em header não-sensível,
  // e o run retornado/persistido vazaria o segredo.
  const run = redactSecretValues(executed, Object.values(options.deps?.secrets ?? {}));
  // Golden é buscado entre os runs JÁ existentes — o run novo (sem verdict) nunca
  // é seu próprio baseline (EC-3); o core não persiste.
  const golden = await findGoldenRun(scenarioKey(run), runsDir, verdictsDir);
  if (golden === null) return { status: "no_baseline", diff: null, run, goldenRunId: null, noiseChanged: false };
  const diff = diffRuns(golden, run);
  return {
    status: diff.hasRegression ? "regression" : "ok",
    diff,
    run,
    goldenRunId: golden.runId,
    noiseChanged: diff.noiseChanged,
  };
}
