/**
 * Tipos compartilhados com o core (ADR-4). `import type` é apagado no build — o
 * browser NUNCA recebe código Node do core. Fonte única: o contrato da API REST e
 * da SPA não pode divergir do core.
 */
export type {
  RunEnvelope,
  RunStep,
  CapturedRequest,
  CapturedResponse,
  AssertResult,
  Verdict,
  RunDiff,
  StepDiff,
  HeaderDiff,
  ListingItem,
  Draft,
  ReviewArtifact,
} from "../../src/core/index.js";

/** Resposta de `GET /api/runs/:id`. */
export interface RunResponse {
  run: import("../../src/core/index.js").RunEnvelope;
  verdict: import("../../src/core/index.js").Verdict | null;
}

/** Resposta de `GET /api/runs/:id/diff`. */
export interface DiffResponse {
  mode: "golden" | "previous";
  curr: import("../../src/core/index.js").RunEnvelope;
  baseline: import("../../src/core/index.js").RunEnvelope | null;
  diff: import("../../src/core/index.js").RunDiff | null;
}
