import { z } from "zod";
import { readFile } from "node:fs/promises";

/**
 * Schema do cenário multi-step do M1 (ADR D1).
 *
 * Cenário é a ENTRADA declarativa (JSON validado por zod); o run é a saída
 * (envelope do M0, ver runSchema.ts). Cada step = request + captures + asserts.
 * Variáveis capturadas (flat, sem prefixo `captures.` — EC-4) propagam por
 * interpolação `${{ var }}` aos steps seguintes.
 */

export const CaptureSpecSchema = z
  .object({
    jsonpath: z.string().optional(),
    regex: z.string().optional(),
  })
  .refine((s) => s.jsonpath !== undefined || s.regex !== undefined, {
    message: "capture spec requer jsonpath e/ou regex",
  });

export const AssertSpecSchema = z.object({
  // source: "status" | "header:<name>" | "jsonpath:<expr>"
  source: z.string(),
  op: z.enum([
    "equals",
    "notEquals",
    "contains",
    "matches",
    "exists",
    "gt",
    "gte",
    "lt",
    "lte",
  ]),
  value: z.unknown().optional(),
});

export const ScenarioStepSchema = z.object({
  name: z.string(),
  request: z.object({
    method: z.string(),
    url: z.string(),
    headers: z.record(z.string()).optional(),
    body: z.string().optional(),
  }),
  captures: z.record(CaptureSpecSchema).optional(),
  asserts: z.array(AssertSpecSchema).optional(),
});

export const ScenarioSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string(),
  steps: z.array(ScenarioStepSchema).min(1),
});

export type CaptureSpec = z.infer<typeof CaptureSpecSchema>;
export type AssertSpec = z.infer<typeof AssertSpecSchema>;
export type ScenarioStep = z.infer<typeof ScenarioStepSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;

/** Lê e VALIDA um cenário do disco (validação na fronteira, architecture.md §2). */
export async function loadScenario(path: string): Promise<Scenario> {
  const raw = await readFile(path, "utf8");
  return ScenarioSchema.parse(JSON.parse(raw));
}
