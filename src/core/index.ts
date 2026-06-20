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

// M4 — proveniência + draft store (geração de cenários)
export { ProvenanceSchema, type Provenance } from "./provenance.js";
export {
  DraftSchema,
  saveDraft,
  loadDraft,
  listDrafts,
  defaultDraftsDir,
  type Draft,
  type SaveDraftOptions,
} from "./draftStore.js";

// M5 — regressão: diff entre runs + anti-flaky
export { maskNoise, NOISE_SENTINEL } from "./maskNoise.js";
export { diffRuns, type RunDiff, type StepDiff, type HeaderDiff } from "./diffRuns.js";
export {
  scenarioKey,
  findPreviousRun,
  findGoldenRun,
  findGoldenRunIn,
  loadAllRunsIn,
  goldenScenarioKeys,
  pruneRunHistory,
  defaultHistoryLimit,
  type ScenarioIdentity,
} from "./runHistory.js";
export { checkScenario, type CheckResult, type CheckStatus, type CheckScenarioOptions } from "./checkScenario.js";
export { replaySuite, type SuiteReport, type SuiteItemResult, type SuiteStatus } from "./replaySuite.js";

// M7 — injeção de env/secrets
export { redactSecretValues, scrubSecretsFromText } from "./redactSecrets.js";

// M3 — persistência versionável
export { stableStringify } from "./stableStringify.js";
export {
  normalizeRun,
  redactRequestHeaders,
  VOLATILE_HEADERS,
  VOLATILE_HEADER_PREFIXES,
  SENSITIVE_REQUEST_HEADERS,
  type NormalizedRun,
  type NormalizedStep,
} from "./normalizeRun.js";
export {
  ReviewArtifactSchema,
  buildReviewArtifact,
  saveReviewArtifact,
  loadReviewArtifact,
  defaultReviewsDir,
  type ReviewArtifact,
} from "./reviewArtifact.js";
export { interpolateRequest } from "./interpolate.js";
export { evalCapture, evalJsonPath } from "./evalCapture.js";
export { evalAssert } from "./evalAssert.js";
