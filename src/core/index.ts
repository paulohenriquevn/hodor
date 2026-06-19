/**
 * API pública do core do Hodor (ADR D2 — fronteira DIP).
 *
 * Esta é a ÚNICA superfície que os adaptadores (`src/mcp/`, `src/web/`) importam.
 * O core não conhece MCP nem HTTP server — domínio puro de execução/captura/persistência.
 */
export { executeRequest, type RunRequestInput, type ExecuteOptions } from "./executeRequest.js";
export { buildRunEnvelope, persistRun, loadRun, defaultRunsDir, type EnvelopeDeps } from "./runStore.js";
export { RequestExecutionError, ScenarioError } from "./errors.js";
export {
  RunEnvelopeSchema,
  RunStepSchema,
  AssertResultSchema,
  CapturedRequestSchema,
  CapturedResponseSchema,
  type RunEnvelope,
  type RunStep,
  type AssertResult,
  type CapturedRequest,
  type CapturedResponse,
} from "./runSchema.js";

// M1 — modelo de cenário multi-step
export {
  ScenarioSchema,
  ScenarioStepSchema,
  AssertSpecSchema,
  CaptureSpecSchema,
  type Scenario,
  type ScenarioStep,
  type AssertSpec,
  type CaptureSpec,
} from "./scenarioSchema.js";
export { runScenario, type RunScenarioDeps } from "./runScenario.js";
// M2 — verdict store
export {
  VerdictSchema,
  saveVerdict,
  loadVerdict,
  defaultVerdictsDir,
  type Verdict,
} from "./verdict.js";
export { interpolateRequest } from "./interpolate.js";
export { evalCapture, evalJsonPath } from "./evalCapture.js";
export { evalAssert } from "./evalAssert.js";
