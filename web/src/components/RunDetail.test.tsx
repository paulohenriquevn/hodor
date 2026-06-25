import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunDetail } from "./RunDetail";
import type { RunEnvelope } from "../types";

function makeRun(overrides?: Partial<RunEnvelope["steps"][number]["response"]>): RunEnvelope {
  return {
    schemaVersion: 1,
    runId: "00000000-0000-0000-0000-000000000001",
    createdAt: "2026-06-20T00:00:00.000Z",
    name: "cenário-x",
    steps: [
      {
        request: { method: "GET", url: "http://api/x", headers: { accept: "application/json" } },
        response: {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
          body: '{"ok":true}',
          timings: { startedAt: "2026-06-20T00:00:00.000Z", durationMs: 1 },
          ...overrides,
        },
        asserts: [{ source: "status", op: "equals", expected: 200, actual: 200, pass: true }],
      },
    ],
  };
}

describe("RunDetail (M8 — paridade do detalhe)", () => {
  it("run_detail_renders_request_and_response", () => {
    render(<RunDetail run={makeRun()} verdict={null} />);
    expect(screen.getByText("cenário-x")).toBeInTheDocument();
    expect(screen.getByText("GET")).toBeInTheDocument();
    expect(screen.getByText("http://api/x")).toBeInTheDocument();
    expect(screen.getByText("pendente")).toBeInTheDocument(); // sem verdict
  });

  it("run_detail_status_badge_has_label", () => {
    render(<RunDetail run={makeRun()} verdict={null} />);
    expect(screen.getByLabelText("status 200")).toHaveTextContent("200 OK");
  });

  it("run_detail_shows_failing_assert", () => {
    const run = makeRun();
    run.steps[0]!.asserts = [{ source: "status", op: "equals", expected: 200, actual: 500, pass: false }];
    render(<RunDetail run={run} verdict={null} />);
    expect(screen.getByText(/atual: 500/)).toBeInTheDocument();
  });

  it("run_detail_status_color_by_class", () => {
    const ok = makeRun();
    const { rerender } = render(<RunDetail run={ok} verdict={null} />);
    expect(screen.getByLabelText("status 200").className).toMatch(/green/); // 2xx → verde
    const err = makeRun({ status: 500, statusText: "Internal Server Error" });
    rerender(<RunDetail run={err} verdict={null} />);
    expect(screen.getByLabelText("status 500").className).toMatch(/red/); // 5xx → vermelho
  });

  it("run_detail_renders_timing_captures_provenance", () => {
    const run = makeRun();
    run.steps[0]!.captures = { userId: 42 };
    run.provenance = { origin: "agent-generated", sourceKind: "endpoint", generatedAt: "2026-06-20T00:00:00.000Z" };
    render(<RunDetail run={run} verdict={null} />);
    expect(screen.getByText(/ms/)).toBeInTheDocument(); // timing (paridade SSR)
    expect(screen.getByText("Captures")).toBeInTheDocument(); // captures (M1)
    expect(screen.getByText("userId")).toBeInTheDocument();
    expect(screen.getByText(/gerado pelo agente/)).toBeInTheDocument(); // provenance badge
  });
});
