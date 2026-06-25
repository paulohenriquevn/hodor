import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VerdictForm } from "./VerdictForm";
import { setApiBase } from "../api";

afterEach(() => {
  vi.restoreAllMocks();
  setApiBase("");
});

describe("VerdictForm (M8 — registra verdict, nunca auto-aprova)", () => {
  it("verdict_form_posts_and_calls_onDecided", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ runId: "x" }) }));
    const onDecided = vi.fn();
    render(<VerdictForm runId="00000000-0000-0000-0000-000000000001" onDecided={onDecided} />);
    fireEvent.click(screen.getByText("Aprovar"));
    await waitFor(() => expect(onDecided).toHaveBeenCalled());
  });

  it("verdict_form_shows_error_on_400", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    render(<VerdictForm runId="00000000-0000-0000-0000-000000000001" />);
    fireEvent.click(screen.getByText("Rejeitar"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/400/); // erro exibido, não engolido
  });
});
