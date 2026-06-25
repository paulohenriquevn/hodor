import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffView } from "./DiffView";
import type { DiffResponse, RunEnvelope } from "../types";

const run: RunEnvelope = {
  schemaVersion: 1,
  runId: "00000000-0000-0000-0000-000000000001",
  createdAt: "t",
  steps: [],
};

describe("DiffView (M8 — paridade do diff)", () => {
  it("diff_view_no_baseline_message", () => {
    const data: DiffResponse = { mode: "golden", curr: run, baseline: null, diff: null };
    render(<DiffView data={data} />);
    expect(screen.getByText(/Sem baseline/)).toBeInTheDocument();
  });

  it("diff_view_previous_mode_and_step_count_changed", () => {
    const data: DiffResponse = {
      mode: "previous",
      curr: run,
      baseline: run,
      diff: {
        stepCountChanged: true,
        noiseChanged: false,
        hasRegression: true,
        steps: [],
      },
    };
    render(<DiffView data={data} />);
    expect(screen.getByText(/vs anterior/)).toBeInTheDocument();
    expect(screen.getByText("número de steps mudou")).toBeInTheDocument(); // paridade SSR
  });

  it("diff_view_shows_regression_and_changed_fields", () => {
    const data: DiffResponse = {
      mode: "golden",
      curr: run,
      baseline: run,
      diff: {
        stepCountChanged: false,
        noiseChanged: false,
        hasRegression: true,
        steps: [{ stepIndex: 0, statusChanged: true, bodyChanged: false, headerDiffs: [{ key: "x", prev: "1", curr: "2" }] }],
      },
    };
    render(<DiffView data={data} />);
    expect(screen.getByText("⚠ regressão")).toBeInTheDocument();
    expect(screen.getByText("status mudou")).toBeInTheDocument();
    expect(screen.getByText("x")).toBeInTheDocument(); // header diff key
  });
});
