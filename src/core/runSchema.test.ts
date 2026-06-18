import { describe, it, expect } from "vitest";
import { RunEnvelopeSchema } from "./runSchema.js";

const validStep = {
  request: {
    method: "GET",
    url: "http://127.0.0.1:8080/ok",
    headers: { accept: "application/json" },
  },
  response: {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "text/plain" },
    body: "hi",
    timings: { startedAt: "2026-06-18T00:00:00.000Z", durationMs: 4 },
  },
};

const validEnvelope = {
  schemaVersion: 1,
  runId: "11111111-1111-1111-1111-111111111111",
  createdAt: "2026-06-18T00:00:00.000Z",
  steps: [validStep],
};

describe("RunEnvelopeSchema", () => {
  it("run_envelope_schema_accepts_valid_single_step", () => {
    const parsed = RunEnvelopeSchema.safeParse(validEnvelope);
    expect(parsed.success).toBe(true);
  });

  it("run_envelope_schema_rejects_wrong_version", () => {
    const parsed = RunEnvelopeSchema.safeParse({ ...validEnvelope, schemaVersion: 2 });
    expect(parsed.success).toBe(false);
  });

  it("run_envelope_schema_rejects_empty_steps", () => {
    const parsed = RunEnvelopeSchema.safeParse({ ...validEnvelope, steps: [] });
    expect(parsed.success).toBe(false);
  });
});
