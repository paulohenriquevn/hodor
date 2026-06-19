import { executeRequest } from "./executeRequest.js";
import { buildRunEnvelope, type EnvelopeDeps } from "./runStore.js";
import { interpolateRequest } from "./interpolate.js";
import { evalCapture } from "./evalCapture.js";
import { evalAssert } from "./evalAssert.js";
import type { Scenario } from "./scenarioSchema.js";
import type { RunEnvelope, RunStep } from "./runSchema.js";

export interface RunScenarioDeps extends EnvelopeDeps {
  /** Timeout por step (repassado ao executeRequest do M0). */
  timeoutMs?: number;
}

/**
 * Engine de cenário multi-step (ADR D5). Executa os steps EM ORDEM, propagando
 * as variáveis capturadas de um step para os seguintes (interpolação), reusando
 * `executeRequest` do M0. Avalia asserts (sem abortar em fail) e captura variáveis.
 * Falha de REDE num step aborta o cenário (propaga `RequestExecutionError` — Q1).
 * Produz o envelope N-step do M0 com cada step estendido por `asserts`/`captures`.
 */
export async function runScenario(
  scenario: Scenario,
  deps: RunScenarioDeps = {},
): Promise<RunEnvelope> {
  let variables: Record<string, unknown> = {};
  const steps: RunStep[] = [];

  for (const step of scenario.steps) {
    const request = interpolateRequest(step.request, variables);
    // Falha de rede lança RequestExecutionError → aborta o cenário (não engole).
    const runStep = await executeRequest(request, { timeoutMs: deps.timeoutMs });

    const asserts = (step.asserts ?? []).map((a) => evalAssert(a, runStep.response));

    const captures: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(step.captures ?? {})) {
      captures[name] = evalCapture(spec, runStep.response);
    }
    variables = { ...variables, ...captures };

    steps.push({ ...runStep, asserts, captures });
  }

  return buildRunEnvelope(steps, deps, scenario.name);
}
