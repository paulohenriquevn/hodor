import { describe, it, expect } from "vitest";
import { ProvenanceSchema } from "./provenance.js";

describe("ProvenanceSchema", () => {
  it("provenance_schema_accepts_agent_generated", () => {
    const p = { origin: "agent-generated", sourceKind: "curl", sourceRef: "curl http://x", generatedAt: "2026-06-19T00:00:00.000Z" };
    expect(ProvenanceSchema.parse(p)).toEqual(p);
  });

  it("provenance_schema_rejects_unknown_origin", () => {
    expect(ProvenanceSchema.safeParse({ origin: "random", sourceKind: "curl", generatedAt: "x" }).success).toBe(false);
  });

  it("provenance_schema_rejects_unknown_source_kind", () => {
    expect(ProvenanceSchema.safeParse({ origin: "agent-generated", sourceKind: "telepathy", generatedAt: "x" }).success).toBe(false);
  });

  it("provenance_schema_allows_optional_source_ref", () => {
    const p = { origin: "human-authored", sourceKind: "endpoint", generatedAt: "2026-06-19T00:00:00.000Z" };
    expect(ProvenanceSchema.parse(p)).toEqual(p);
  });
});
