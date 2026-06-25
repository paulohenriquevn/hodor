import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DraftList } from "./DraftList";
import type { Draft } from "../types";

const draft: Draft = {
  schemaVersion: 1,
  name: "gen-cenário",
  steps: [{ name: "g", request: { method: "GET", url: "http://x/y", headers: {} } }],
  provenance: { origin: "agent-generated", sourceKind: "endpoint", generatedAt: "2026-06-20T00:00:00.000Z" },
};

describe("DraftList (M8 — DoD #1 caller de produção dos drafts)", () => {
  it("draft_list_empty_message", () => {
    render(<DraftList drafts={[]} />);
    expect(screen.getByText("no drafts yet")).toBeInTheDocument();
  });

  it("draft_list_renders_pending_drafts", () => {
    render(<DraftList drafts={[{ id: "00000000-0000-0000-0000-000000000001", draft }]} />);
    expect(screen.getByText("gen-cenário")).toBeInTheDocument();
    expect(screen.getByText(/endpoint/)).toBeInTheDocument(); // sourceKind
    expect(screen.getByText("pendente de revisão")).toBeInTheDocument();
  });
});
