import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchRuns, fetchRun, postVerdict, ApiError, setApiBase } from "./api";

afterEach(() => {
  vi.restoreAllMocks();
  setApiBase("");
});

describe("api client (M8)", () => {
  it("api_client_parses_runs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => [{ runId: "x", createdAt: "t", stepCount: 1, allAssertsPass: true, verdict: null }] }),
    );
    const runs = await fetchRuns();
    expect(runs[0]!.runId).toBe("x");
  });

  it("api_client_throws_apierror_on_404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchRun("nope")).rejects.toBeInstanceOf(ApiError);
  });

  it("api_client_post_verdict_sends_json", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ runId: "x" }) });
    vi.stubGlobal("fetch", f);
    await postVerdict("x", { verdict: "approved", note: "ok" });
    expect(f).toHaveBeenCalledWith(
      expect.stringContaining("/api/runs/x/verdict"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json" }),
        body: JSON.stringify({ verdict: "approved", note: "ok" }),
      }),
    );
  });
});
