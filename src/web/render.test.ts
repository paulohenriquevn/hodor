import { describe, it, expect } from "vitest";
import { renderRun } from "./render.js";
import type { RunEnvelope, RunStep } from "../core/index.js";

function step(overrides: Partial<RunStep> = {}): RunStep {
  return {
    request: { method: "POST", url: "http://api.test/v1/x", headers: { "x-trace": "abc" } },
    response: {
      status: 201,
      statusText: "Created",
      headers: { "content-type": "application/json", "x-server": "test" },
      body: '{"ok":true}',
      timings: { startedAt: "2026-06-18T00:00:00.000Z", durationMs: 7 },
    },
    ...overrides,
  };
}

function envelope(steps: RunStep[]): RunEnvelope {
  return { schemaVersion: 1, runId: "run-1", createdAt: "2026-06-18T00:00:00.000Z", steps };
}

describe("renderRun", () => {
  it("render_run_includes_method_url_and_status", () => {
    const html = renderRun(envelope([step()]));
    expect(html).toContain("POST");
    expect(html).toContain("http://api.test/v1/x");
    expect(html).toContain("201");
  });

  it("render_run_lists_request_and_response_headers", () => {
    const html = renderRun(envelope([step()]));
    expect(html).toContain("x-trace");
    expect(html).toContain("abc");
    expect(html).toContain("x-server");
  });

  it("render_run_escapes_html_in_body", () => {
    const html = renderRun(
      envelope([
        step({
          response: {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "text/html" },
            body: "<script>alert(1)</script>",
            timings: { startedAt: "2026-06-18T00:00:00.000Z", durationMs: 1 },
          },
        }),
      ]),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("render_run_iterates_multiple_steps", () => {
    const html = renderRun(envelope([step(), step()]));
    // Two step sections rendered (prova suporte N-step).
    const occurrences = html.split("Step ").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

describe("renderRun (M1 — asserts/captures)", () => {
  it("render_run_shows_assert_pass_and_fail", () => {
    const html = renderRun(
      envelope([
        step({
          asserts: [
            { source: "status", op: "equals", value: 201, pass: true, expected: 201, actual: 201 },
            { source: "jsonpath:$.ok", op: "equals", value: false, pass: false, expected: false, actual: true },
          ],
        }),
      ]),
    );
    expect(html).toContain("PASS");
    expect(html).toContain("FAIL");
    expect(html).toContain("class='fail'");
  });

  it("render_run_shows_captured_variables", () => {
    const html = renderRun(envelope([step({ captures: { id: 7 } })]));
    expect(html).toContain("Captures");
    expect(html).toContain("id");
    expect(html).toContain("7");
  });

  it("render_run_escapes_assert_values", () => {
    const html = renderRun(
      envelope([
        step({
          asserts: [
            { source: "jsonpath:$.x", op: "equals", value: "<script>", pass: false, expected: "<script>", actual: "y" },
          ],
        }),
      ]),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("render_run_m0_step_without_asserts_still_renders", () => {
    // backward-compat: step M0 (sem asserts/captures) renderiza sem seções extras nem erro
    const html = renderRun(envelope([step()]));
    expect(html).toContain("Step 1");
    expect(html).not.toContain("<h3>Asserts</h3>");
  });
});
