/**
 * API pública do core do Hodor (ADR D2 — fronteira DIP).
 *
 * Esta é a ÚNICA superfície que os adaptadores (`src/mcp/`, `src/web/`) importam.
 * O core não conhece MCP nem HTTP server — domínio puro de execução/captura/persistência.
 */
export { executeRequest, type RunRequestInput, type ExecuteOptions } from "./executeRequest.js";
export { buildRunEnvelope, persistRun, loadRun, defaultRunsDir, type EnvelopeDeps } from "./runStore.js";
export { RequestExecutionError } from "./errors.js";
export {
  RunEnvelopeSchema,
  RunStepSchema,
  CapturedRequestSchema,
  CapturedResponseSchema,
  type RunEnvelope,
  type RunStep,
  type CapturedRequest,
  type CapturedResponse,
} from "./runSchema.js";
