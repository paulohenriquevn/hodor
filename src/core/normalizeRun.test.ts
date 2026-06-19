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

  it("normalize_run_redacts_sensitive_request_headers", () => {
    // F-sec-1: o artefato é COMMITÁVEL — credenciais na request NÃO podem ir verbatim pro git.
    const e = env([
      step({}, {
        request: {
          method: "GET",
          url: "http://api.test/x",
          headers: { Authorization: "Bearer secret-jwt", Cookie: "sid=abc", "X-Api-Key": "k", "x-trace": "t" },
        },
      }),
    ]);
    const h = normalizeRun(e).steps[0]!.request.headers;
    expect(h["Authorization"]).toBe("<redacted>");
    expect(h["Cookie"]).toBe("<redacted>");
    expect(h["X-Api-Key"]).toBe("<redacted>"); // case-insensitive match
    expect(h["x-trace"]).toBe("t"); // não-sensível preservado
    // input não mutado
    expect(e.steps[0]!.request.headers["Authorization"]).toBe("Bearer secret-jwt");
  });

  it("normalize_run_strips_volatile_header_prefixes", () => {
    // F-dom-2: voláteis de cloud/CDN/tracing por prefixo (x-amz-*, cf-*) + tracing exatos.
    const n = normalizeRun(env([
      step({ headers: { "content-type": "application/json", "x-amz-request-id": "r", "cf-foo": "1", "x-amzn-trace-id": "tr", traceparent: "p" } }),
    ]));
    const h = n.steps[0]!.response.headers;
    expect(h["x-amz-request-id"]).toBeUndefined();
    expect(h["cf-foo"]).toBeUndefined();
    expect(h["x-amzn-trace-id"]).toBeUndefined();
    expect(h["traceparent"]).toBeUndefined();
    expect(h["content-type"]).toBe("application/json");
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
