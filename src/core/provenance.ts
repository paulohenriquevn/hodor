import { z } from "zod";

/**
 * Proveniência de um cenário/run (M4, ADR D2). Fonte única do conceito (DRY) —
 * referenciada por ScenarioSchema E RunEnvelopeSchema de forma OPCIONAL/aditiva.
 *
 * `origin` distingue cenário gerado pelo agente de autorado por humano (a lacuna
 * que o keploy NÃO tem). `sourceKind` registra de ONDE veio (risco #2: exemplos
 * reais, não só OpenAPI). É só metadado — NÃO carrega estado de aprovação (ADR D3:
 * aprovação é o Verdict M2 + reviews/ M3).
 */
export const ProvenanceSchema = z.object({
  origin: z.enum(["agent-generated", "human-authored"]),
  sourceKind: z.enum(["curl", "openapi", "endpoint", "traffic"]),
  // Bound de tamanho na fronteira (F-arch-9): sourceRef guarda curl/exemplo, não um dump.
  sourceRef: z.string().max(4096).optional(),
  generatedAt: z.string(),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;
