import { describe, it, expect } from "vitest";
import { diffRuns } from "./diffRuns.js";
import type { RunEnvelope, RunStep } from "./runSchema.js";

function step(over: Partial<RunStep["response"]> = {}, reqOver: Partial<RunStep["request"]> = {}): RunStep {
  return {
    request: { method: "GET", url: "http://api.test/x", headers: {}, ...reqOver },
    response: {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: '{"v":1}',
      timings: { startedAt: "2026-06-19T00:00:00.000Z", durationMs: 5 },
      ...over,
    },
  };
}
function env(steps: RunStep[], over: Partial<RunEnvelope> = {}): RunEnvelope {
  return { schemaVersion: 1, runId: "r", createdAt: "2026-06-19T00:00:00.000Z", name: "c", steps, ...over };
}

describe("diffRuns", () => {
  it("diff_runs_identical_runs_no_regression", () => {
    const d = diffRuns(env([step()]), env([step()]));
    expect(d.hasRegression).toBe(false);
    expect(d.steps[0]!.statusChanged).toBe(false);
    expect(d.steps[0]!.bodyChanged).toBe(false);
  });

  it("diff_runs_flags_status_change", () => {
    const d = diffRuns(env([step()]), env([step({ status: 500, statusText: "Error" })]));
    expect(d.steps[0]!.statusChanged).toBe(true);
    expect(d.hasRegression).toBe(true);
  });

  it("diff_runs_flags_body_change", () => {
    const d = diffRuns(env([step()]), env([step({ body: '{"v":2}' })]));
    expect(d.steps[0]!.bodyChanged).toBe(true);
  });

  it("diff_runs_ignores_noise_body_field", () => {
    // body difere SÓ num path de noise → bodyChanged false (anti-flaky, DoD #3/risco #1)
    const a = env([step({ body: '{"v":1,"ts":111}' })], { noise: ["$.ts"] });
    const b = env([step({ body: '{"v":1,"ts":999}' })], { noise: ["$.ts"] });
    const d = diffRuns(a, b);
    expect(d.steps[0]!.bodyChanged).toBe(false);
    expect(d.hasRegression).toBe(false);
  });

  it("diff_runs_detects_real_change_even_with_noise", () => {
    // noise no $.ts, mas $.v (real) mudou → bodyChanged true
    const a = env([step({ body: '{"v":1,"ts":111}' })], { noise: ["$.ts"] });
    const b = env([step({ body: '{"v":2,"ts":999}' })], { noise: ["$.ts"] });
    expect(diffRuns(a, b).steps[0]!.bodyChanged).toBe(true);
  });

  it("diff_runs_ignores_volatile_headers", () => {
    // diferença só em header volátil (date) → sem diff de header (reusa normalizeRun)
    const a = env([step({ headers: { "content-type": "application/json", date: "Mon" } })]);
    const b = env([step({ headers: { "content-type": "application/json", date: "Tue" } })]);
    expect(diffRuns(a, b).steps[0]!.headerDiffs).toHaveLength(0);
  });

  it("diff_runs_detects_real_header_change", () => {
    const a = env([step({ headers: { "content-type": "application/json" } })]);
    const b = env([step({ headers: { "content-type": "text/plain" } })]);
    expect(diffRuns(a, b).steps[0]!.headerDiffs.length).toBeGreaterThan(0);
  });

  it("diff_runs_flags_step_count_mismatch", () => {
    // EC-7: cenário mudou de N→M steps
    const d = diffRuns(env([step()]), env([step(), step()]));
    expect(d.stepCountChanged).toBe(true);
    expect(d.hasRegression).toBe(true);
  });

  it("diff_runs_surfaces_change_when_noise_asymmetric", () => {
    // F-dom-1: noise adicionado SÓ no run atual NÃO esconde a regressão no baseline.
    // prev sem noise (total=100), curr com noise $.total (total=500) → cada lado mascarado
    // com seu próprio noise → diferem → bodyChanged true (regressão SURFACE, não escondida).
    const prev = env([step({ body: '{"total":100}' })]); // sem noise
    const curr = env([step({ body: '{"total":500}' })], { noise: ["$.total"] });
    const d = diffRuns(prev, curr);
    expect(d.steps[0]!.bodyChanged).toBe(true);
    expect(d.noiseChanged).toBe(true); // regras de noise diferem → revisar com atenção
  });
});
