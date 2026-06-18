import { describe, it, expect } from "vitest";
import { ScenarioSchema } from "./scenarioSchema.js";
import { RunStepSchema } from "./runSchema.js";

const validScenario = {
  schemaVersion: 1,
  name: "two-step",
  steps: [
    {
      name: "create",
      request: { method: "POST", url: "https://api.test/posts", body: "{}" },
      captures: { id: { jsonpath: "$.id" } },
      asserts: [{ source: "status", op: "equals", value: 201 }],
    },
    {
      name: "fetch",
      request: { method: "GET", url: "https://api.test/posts/${{ id }}" },
      asserts: [{ source: "jsonpath:$.ok", op: "equals", value: true }],
    },
  ],
};

const m0Step = {
  request: { method: "GET", url: "http://127.0.0.1/x", headers: {} },
  response: {
    status: 200,
    statusText: "OK",
    headers: {},
    body: "hi",
    timings: { startedAt: "2026-06-18T00:00:00.000Z", durationMs: 1 },
  },
};

describe("ScenarioSchema", () => {
  it("scenario_schema_accepts_valid_multistep", () => {
    expect(ScenarioSchema.safeParse(validScenario).success).toBe(true);
  });

  it("scenario_schema_rejects_empty_steps", () => {
    expect(ScenarioSchema.safeParse({ ...validScenario, steps: [] }).success).toBe(false);
  });
});

describe("RunStepSchema (M1 extension, backward-compat)", () => {
  it("run_step_still_accepts_m0_shape", () => {
    // forma M0 (sem asserts/captures) continua válida
    expect(RunStepSchema.safeParse(m0Step).success).toBe(true);
  });

  it("run_step_accepts_asserts_and_captures", () => {
    const m1Step = {
      ...m0Step,
      asserts: [{ source: "status", op: "equals", value: 200, pass: true, expected: 200, actual: 200 }],
      captures: { id: 7 },
    };
    expect(RunStepSchema.safeParse(m1Step).success).toBe(true);
  });
});
