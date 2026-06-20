import { describe, it, expect } from "vitest";
import { redactSecretValues } from "./redactSecrets.js";
import type { RunEnvelope, RunStep } from "./runSchema.js";

function step(over: Partial<RunStep> = {}): RunStep {
  return {
    request: { method: "GET", url: "http://api.test/x", headers: {} },
    response: { status: 200, statusText: "OK", headers: {}, body: "", timings: { startedAt: "x", durationMs: 1 } },
    ...over,
  };
}
function env(steps: RunStep[]): RunEnvelope {
  return { schemaVersion: 1, runId: "r1", createdAt: "x", name: "c", steps };
}

describe("redactSecretValues (M7)", () => {
  it("redact_secret_values_scrubs_request_header", () => {
    const e = env([step({ request: { method: "GET", url: "http://x", headers: { Authorization: "Bearer s3cr3t" } } })]);
    const out = redactSecretValues(e, ["s3cr3t"]);
    expect(out.steps[0]!.request.headers["Authorization"]).toBe("Bearer <redacted>");
  });

  it("redact_secret_values_scrubs_non_sensitive_header_and_body_and_url", () => {
    const e = env([step({ request: { method: "POST", url: "http://x?k=s3cr3t", headers: { "x-custom": "s3cr3t" }, body: '{"t":"s3cr3t"}' } })]);
    const out = redactSecretValues(e, ["s3cr3t"]);
    expect(out.steps[0]!.request.headers["x-custom"]).toBe("<redacted>");
    expect(out.steps[0]!.request.body).toBe('{"t":"<redacted>"}');
    expect(out.steps[0]!.request.url).toBe("http://x?k=<redacted>");
  });

  it("redact_secret_values_scrubs_url_encoded_form", () => {
    // EC-1: segredo com chars especiais é persistido ENCODADO na url → redige a forma encodada também
    const secret = "a/b+c=d";
    const enc = encodeURIComponent(secret); // a%2Fb%2Bc%3Dd
    const e = env([step({ request: { method: "GET", url: `http://x?q=${enc}`, headers: { "x-h": secret } } })]);
    const out = redactSecretValues(e, [secret]);
    expect(out.steps[0]!.request.url).toBe("http://x?q=<redacted>"); // forma encodada redigida
    expect(out.steps[0]!.request.headers["x-h"]).toBe("<redacted>"); // forma crua redigida
  });

  it("redact_secret_values_scrubs_response_body_and_headers", () => {
    const e = env([step({ response: { status: 200, statusText: "OK", headers: { "x-echo": "s3cr3t" }, body: '{"echo":"s3cr3t"}', timings: { startedAt: "x", durationMs: 1 } } })]);
    const out = redactSecretValues(e, ["s3cr3t"]);
    expect(out.steps[0]!.response.headers["x-echo"]).toBe("<redacted>");
    expect(out.steps[0]!.response.body).toBe('{"echo":"<redacted>"}');
  });

  it("redact_secret_values_longest_first", () => {
    // "abc" é substring de "abcdef"; o maior deve ser redigido inteiro
    const e = env([step({ request: { method: "GET", url: "http://x", headers: { h: "abcdef" } } })]);
    const out = redactSecretValues(e, ["abc", "abcdef"]);
    expect(out.steps[0]!.request.headers["h"]).toBe("<redacted>"); // não "<redacted>def"
  });

  it("redact_secret_values_empty_values_noop", () => {
    const e = env([step({ request: { method: "GET", url: "http://x/abc", headers: {} } })]);
    expect(redactSecretValues(e, []).steps[0]!.request.url).toBe("http://x/abc");
    expect(redactSecretValues(e, [""]).steps[0]!.request.url).toBe("http://x/abc");
  });

  it("redact_secret_values_does_not_mutate_input", () => {
    const e = env([step({ request: { method: "GET", url: "http://x", headers: { Authorization: "Bearer s3cr3t" } } })]);
    redactSecretValues(e, ["s3cr3t"]);
    expect(e.steps[0]!.request.headers["Authorization"]).toBe("Bearer s3cr3t"); // intacto
  });
});
