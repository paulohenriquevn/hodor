import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RunList } from "./RunList";
import type { ListingItem } from "../types";

function wrap(items: ListingItem[]) {
  return render(
    <MemoryRouter>
      <RunList items={items} />
    </MemoryRouter>,
  );
}

describe("RunList (M8 — paridade da listagem)", () => {
  it("run_list_empty_message", () => {
    wrap([]);
    expect(screen.getByText("no runs yet")).toBeInTheDocument();
  });

  it("run_list_renders_rows_with_badges", () => {
    wrap([
      {
        runId: "00000000-0000-0000-0000-000000000001",
        name: "cenário-a",
        createdAt: "2026-06-20",
        stepCount: 2,
        allAssertsPass: true,
        verdict: "approved",
        isGolden: true,
        origin: "agent-generated",
      },
      {
        runId: "00000000-0000-0000-0000-000000000002",
        name: "cenário-b",
        createdAt: "2026-06-20",
        stepCount: 1,
        allAssertsPass: false,
        verdict: null,
        regression: true,
      },
    ]);
    expect(screen.getByText("cenário-a")).toBeInTheDocument();
    expect(screen.getByText(/golden/)).toBeInTheDocument(); // selo golden 🏆
    expect(screen.getByText(/agente/)).toBeInTheDocument(); // origin 🤖
    expect(screen.getByText(/regressão/)).toBeInTheDocument(); // badge ⚠
    expect(screen.getByText("✓ pass")).toBeInTheDocument();
    expect(screen.getByText("✗ fail")).toBeInTheDocument();
  });

  it("run_list_links_to_detail", () => {
    wrap([
      { runId: "00000000-0000-0000-0000-000000000001", name: "x", createdAt: "t", stepCount: 1, allAssertsPass: null, verdict: null },
    ]);
    const link = screen.getByRole("link", { name: /00000000/ });
    expect(link).toHaveAttribute("href", "/runs/00000000-0000-0000-0000-000000000001");
  });
});
