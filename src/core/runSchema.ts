import { z } from "zod";

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

export const RunStepSchema = z.object({
  request: CapturedRequestSchema,
  response: CapturedResponseSchema,
});

export const RunEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  createdAt: z.string(),
  steps: z.array(RunStepSchema).min(1),
});

export type CapturedRequest = z.infer<typeof CapturedRequestSchema>;
export type CapturedResponse = z.infer<typeof CapturedResponseSchema>;
export type RunStep = z.infer<typeof RunStepSchema>;
export type RunEnvelope = z.infer<typeof RunEnvelopeSchema>;
