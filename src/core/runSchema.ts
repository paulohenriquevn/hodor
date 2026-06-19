import { z } from "zod";
import { ProvenanceSchema } from "./provenance.js";

/**
 * Schema do artefato de run do Hodor.
 *
 * Envelope N-step desde o M0 (ADR D3): um run de uma única request é um run de
 * N=1 step. M1 (multi-step) apenas dá `push` em `steps` — sem refactor.
 * O campo `schemaVersion` é a semente de forward-compat (padrão `v` do hoppscotch);
 * a lib de migração (verzod) é YAGNI até existir uma v2.
 */

export const CapturedRequestSchema = z.object({
  method: z.string(),
  url: z.string().url(),
  headers: z.record(z.string()),
  body: z.string().optional(),
});

export const CapturedResponseSchema = z.object({
  status: z.number(),
  statusText: z.string(),
  headers: z.record(z.string()),
  body: z.string(),
  timings: z.object({
    startedAt: z.string(),
    durationMs: z.number().nonnegative(),
  }),
});

/**
 * Resultado de um assert sobre a resposta (M1). `pass` + esperado/obtido tornam
 * a falha inspecionável (render M2/M3). Aditivo e OPCIONAL no RunStep (ADR D4).
 */
export const AssertResultSchema = z.object({
  source: z.string(),
  op: z.string(),
  value: z.unknown().optional(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});

export const RunStepSchema = z.object({
  request: CapturedRequestSchema,
  response: CapturedResponseSchema,
  // M1 (ADR D4): campos OPCIONAIS e aditivos — runs do M0 (sem eles) seguem válidos.
  asserts: z.array(AssertResultSchema).optional(),
  captures: z.record(z.unknown()).optional(),
});

export const RunEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  createdAt: z.string(),
  // M2 (ADR D4): nome do cenário, OPCIONAL e aditivo — runs do M0/run_request
  // (sem cenário) seguem válidos; usado para rotular a listagem de review.
  name: z.string().optional(),
  // M4 (ADR D2): proveniência OPCIONAL e aditiva — propagada do cenário gerado;
  // runs M0-M3 (sem ela) seguem válidos. A UI marca "gerado pelo agente · pendente".
  provenance: ProvenanceSchema.optional(),
  steps: z.array(RunStepSchema).min(1),
});

export type CapturedRequest = z.infer<typeof CapturedRequestSchema>;
export type CapturedResponse = z.infer<typeof CapturedResponseSchema>;
export type AssertResult = z.infer<typeof AssertResultSchema>;
export type RunStep = z.infer<typeof RunStepSchema>;
export type RunEnvelope = z.infer<typeof RunEnvelopeSchema>;
