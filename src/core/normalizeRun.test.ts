import { describe, it, expect } from "vitest";
import { normalizeRun } from "./normalizeRun.js";
import type { RunEnvelope, RunStep } from "./runSchema.js";

function step(over: Partial<RunStep["response"]> = {}, extra: Partial<RunStep> = {}): RunStep {
  return {
    request: { method: "GET", url: "http://api.test/x", headers: { "x-trace": "t" } },
    response: {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json", date: "Mon, 01 Jan", etag: "abc" },
      body: '{"ok":true}',
      timings: { startedAt: "2026-06-19T00:00:00.000Z", durationMs: 5 },
      ...over,
    },
    ...extra,
  };
}

function env(s: RunStep[], name?: string, createdAt = "2026-06-19T00:00:00.000Z"): RunEnvelope {
  return { schemaVersion: 1, runId: "r1", createdAt, ...(name ? { name } : {}), steps: s };
}

describe("normalizeRun", () => {
  it("normalize_run_strips_timings", () => {
    const n = normalizeRun(env([step()]));
    expect("timings" in n.steps[0]!.response).toBe(false);
  });

  it("normalize_run_strips_volatile_headers", () => {
    const n = normalizeRun(env([step()]));
    const h = n.steps[0]!.response.headers;
    expect(h["date"]).toBeUndefined();
    expect(h["etag"]).toBeUndefined();
    expect(h["content-type"]).toBe("application/json");
  });

  it("normalize_run_is_stable_across_volatile_diffs", () => {
    // dois runs iguais exceto Date/timing/runId/createdAt → normalizeRun deep-equal
    const a = normalizeRun(env([step({ headers: { "content-type": "application/json", date: "Mon, 01 Jan", etag: "v1" }, timings: { startedAt: "2026-06-19T00:00:00.000Z", durationMs: 5 } })], "c", "2026-06-19T00:00:00.000Z"));
    const b = normalizeRun(env([step({ headers: { "content-type": "application/json", date: "Tue, 02 Feb", etag: "v2" }, timings: { startedAt: "2026-06-19T11:11:11.111Z", durationMs: 999 } })], "c", "2026-06-19T22:22:22.222Z"));
    expect(a).toEqual(b);
  });

  it("normalize_run_does_not_mutate_input", () => {
    const e = env([step()]);
    normalizeRun(e);
    expect(e.steps[0]!.response.timings).toBeDefined();
    expect(e.steps[0]!.response.headers["date"]).toBe("Mon, 01 Jan");
  });

  it("normalize_run_preserves_asserts_and_captures", () => {
    const e = env([
      step({}, {
        asserts: [{ source: "status", op: "equals", value: 200, pass: true, expected: 200, actual: 200 }],
        captures: { id: 7 },
      }),
    ]);
    const n = normalizeRun(e);
    expect(n.steps[0]!.asserts).toHaveLength(1);
    expect(n.steps[0]!.captures).toEqual({ id: 7 });
  });
});
