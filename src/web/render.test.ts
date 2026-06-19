import { describe, it, expect } from "vitest";
import { renderRun, renderListing } from "./render.js";
import type { RunEnvelope, RunStep, Provenance } from "../core/index.js";

const agentProv: Provenance = {
  origin: "agent-generated",
  sourceKind: "curl",
  sourceRef: "curl http://api.test/x",
  generatedAt: "2026-06-19T00:00:00.000Z",
};

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

describe("renderRun (M2 — verdict)", () => {
  it("render_run_shows_verdict_form_and_pending_when_no_verdict", () => {
    const html = renderRun(envelope([step()]));
    expect(html).toContain("verdict-form");
    expect(html).toContain("pendente");
  });

  it("render_run_omits_binary_body", () => {
    // F-tests-2: content-type binário → conteúdo NÃO embutido (só metadados)
    const html = renderRun(
      envelope([
        step({
          response: {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "image/png" },
            body: "\x89PNG\r\n\x1a\nBINARYDATA",
            timings: { startedAt: "2026-06-18T00:00:00.000Z", durationMs: 1 },
          },
        }),
      ]),
    );
    expect(html).toContain("binary omitted");
    expect(html).toContain("image/png");
    expect(html).not.toContain("BINARYDATA");
  });

  it("render_run_truncates_large_text_body", () => {
    const big = "y".repeat(100_000);
    const html = renderRun(
      envelope([
        step({
          response: {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "text/plain" },
            body: big,
            timings: { startedAt: "2026-06-18T00:00:00.000Z", durationMs: 1 },
          },
        }),
      ]),
    );
    expect(html).toContain("truncado");
    expect(html).toContain("100000"); // tamanho original no aviso
  });

  it("render_verdict_escapes_note", () => {
    // EC-1: note é input do humano → deve ser escapada (anti-XSS armazenado)
    const html = renderRun(envelope([step()]), {
      runId: "run-1",
      verdict: "rejected",
      note: "<script>alert(1)</script>",
      decidedAt: "2026-06-18T00:00:00.000Z",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("rejected");
  });
});

describe("M4 — badge de proveniência (gerado pelo agente)", () => {
  it("render_shows_agent_generated_badge", () => {
    const env = { ...envelope([step()]), provenance: agentProv } as RunEnvelope;
    const html = renderRun(env);
    expect(html).toContain("gerado pelo agente");
  });

  it("render_shows_pending_when_no_verdict", () => {
    const env = { ...envelope([step()]), provenance: agentProv } as RunEnvelope;
    expect(renderRun(env, null)).toContain("pendente de revisão");
  });

  it("render_omits_pending_when_verdict_present", () => {
    const env = { ...envelope([step()]), provenance: agentProv } as RunEnvelope;
    const html = renderRun(env, { runId: "run-1", verdict: "approved", decidedAt: "2026-06-19T00:00:00.000Z" });
    expect(html).toContain("gerado pelo agente");
    expect(html).not.toContain("pendente de revisão");
  });

  it("render_omits_badge_for_human_authored", () => {
    // run M0-M3 (sem provenance) → sem badge (backward-compat visual)
    expect(renderRun(envelope([step()]))).not.toContain("gerado pelo agente");
  });

  it("render_escapes_provenance_source_ref", () => {
    const env = { ...envelope([step()]), provenance: { ...agentProv, sourceRef: "<script>alert(1)</script>" } } as RunEnvelope;
    const html = renderRun(env);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("render_listing_shows_agent_tag", () => {
    const html = renderListing([
      { runId: "r1", name: "gerado", createdAt: "x", stepCount: 1, allAssertsPass: true, verdict: null, origin: "agent-generated" },
      { runId: "r2", name: "manual", createdAt: "y", stepCount: 1, allAssertsPass: true, verdict: null },
    ]);
    expect(html).toContain("🤖 gerado");
  });
});

import { renderDiff } from "./render.js";
import type { RunDiff } from "../core/index.js";

describe("M5 — renderDiff (regressão)", () => {
  const currEnv = { ...envelope([step()]), runId: "cur" } as RunEnvelope;
  const prevEnv = { ...envelope([step()]), runId: "prev" } as RunEnvelope;

  it("render_diff_highlights_status_change", () => {
    const diff: RunDiff = { steps: [{ stepIndex: 0, statusChanged: true, headerDiffs: [], bodyChanged: false }], stepCountChanged: false, noiseChanged: false, hasRegression: true };
    const html = renderDiff(currEnv, prevEnv, diff);
    expect(html).toContain("Mudança de comportamento detectada");
    expect(html).toContain("status mudou");
  });

  it("render_diff_shows_no_regression_when_identical", () => {
    const diff: RunDiff = { steps: [{ stepIndex: 0, statusChanged: false, headerDiffs: [], bodyChanged: false }], stepCountChanged: false, noiseChanged: false, hasRegression: false };
    expect(renderDiff(currEnv, prevEnv, diff)).toContain("Sem mudança de comportamento");
  });

  it("render_diff_first_run_message_when_no_previous", () => {
    expect(renderDiff(currEnv, null, null)).toContain("Primeiro run deste cenário");
  });

  it("render_diff_escapes_header_diff_content", () => {
    const diff: RunDiff = { steps: [{ stepIndex: 0, statusChanged: false, headerDiffs: [{ key: "x", prev: "<script>alert(1)</script>", curr: "y" }], bodyChanged: false }], stepCountChanged: false, noiseChanged: false, hasRegression: true };
    const html = renderDiff(currEnv, prevEnv, diff);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
