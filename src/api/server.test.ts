import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApiServer } from "./server.js";
import { buildRunEnvelope, persistRun, saveVerdict, saveDraft, type RunStep } from "../core/index.js";

const step: RunStep = {
  request: { method: "GET", url: "http://127.0.0.1/ok", headers: {} },
  response: {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json" },
    body: '{"ok":true}',
    timings: { startedAt: "2026-06-20T00:00:00.000Z", durationMs: 1 },
  },
  asserts: [{ source: "status", op: "equals", expected: 200, actual: 200, pass: true }],
};
const UUID1 = "00000000-0000-0000-0000-000000000001";

let server: Server | undefined;
let runsDir: string, vDir: string, rDir: string, dDir: string, distDir: string;

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "hodor-api-"));
  vDir = await mkdtemp(join(tmpdir(), "hodor-api-v-"));
  rDir = await mkdtemp(join(tmpdir(), "hodor-api-r-"));
  dDir = await mkdtemp(join(tmpdir(), "hodor-api-d-"));
  distDir = await mkdtemp(join(tmpdir(), "hodor-api-dist-"));
});
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
  for (const d of [runsDir, vDir, rDir, dDir, distDir]) await rm(d, { recursive: true, force: true });
});

function start(withDist = false): Promise<string> {
  server = buildApiServer(runsDir, vDir, rDir, dDir, withDist ? distDir : undefined);
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`);
    });
  });
}

describe("API REST (M8) — runs/diff/verdict", () => {
  it("api_lists_runs_as_json", async () => {
    await persistRun(buildRunEnvelope([step], { now: () => 0, newId: () => UUID1 }, "a"), runsDir);
    const base = await start();
    const res = await fetch(`${base}/api/runs`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const items = (await res.json()) as Array<{ runId: string; name?: string }>;
    expect(items[0]!.runId).toBe(UUID1);
    expect(items[0]!.name).toBe("a");
  });

  it("api_get_run_returns_run_and_verdict", async () => {
    await persistRun(buildRunEnvelope([step], { now: () => 0, newId: () => UUID1 }, "a"), runsDir);
    const base = await start();
    const res = await fetch(`${base}/api/runs/${UUID1}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: { runId: string }; verdict: unknown };
    expect(body.run.runId).toBe(UUID1);
    expect(body.verdict).toBeNull();
  });

  it("api_get_run_404_when_missing", async () => {
    const base = await start();
    expect((await fetch(`${base}/api/runs/${UUID1}`)).status).toBe(404);
  });

  it("api_bad_id_400", async () => {
    const base = await start();
    expect((await fetch(`${base}/api/runs/..%2f..%2fpackage.json`)).status).toBe(400);
  });

  it("api_method_not_allowed_405_with_allow", async () => {
    const base = await start();
    const res = await fetch(`${base}/api/runs/${UUID1}`, { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });

  it("api_post_verdict_creates_artifact_201", async () => {
    await persistRun(buildRunEnvelope([step], { now: () => 0, newId: () => UUID1 }, "a"), runsDir);
    const base = await start();
    const res = await fetch(`${base}/api/runs/${UUID1}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict: "approved", note: "lgtm" }),
    });
    expect(res.status).toBe(201);
    const artifact = (await res.json()) as { runId: string; verdict: { verdict: string } };
    expect(artifact.runId).toBe(UUID1);
    expect(artifact.verdict.verdict).toBe("approved");
    // verdict persistiu → run agora aparece como golden na listagem
    const items = (await (await fetch(`${base}/api/runs`)).json()) as Array<{ isGolden?: boolean }>;
    expect(items[0]!.isGolden).toBe(true);
  });

  it("api_post_verdict_invalid_400", async () => {
    await persistRun(buildRunEnvelope([step], { now: () => 0, newId: () => UUID1 }, "a"), runsDir);
    const base = await start();
    const res = await fetch(`${base}/api/runs/${UUID1}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict: "maybe" }),
    });
    expect(res.status).toBe(400);
  });

  it("api_diff_no_baseline_returns_null", async () => {
    await persistRun(buildRunEnvelope([step], { now: () => 0, newId: () => UUID1 }, "a"), runsDir);
    const base = await start();
    const res = await fetch(`${base}/api/runs/${UUID1}/diff?vs=golden`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; diff: unknown };
    expect(body.mode).toBe("golden");
    expect(body.diff).toBeNull();
  });
});

describe("API REST (M8) — drafts/reviews", () => {
  it("api_lists_and_gets_drafts", async () => {
    await saveDraft(
      {
        schemaVersion: 1,
        name: "gen",
        steps: [{ name: "g", request: { method: "GET", url: "http://x/y", headers: {} } }],
        provenance: { origin: "agent-generated", sourceKind: "endpoint", generatedAt: "2026-06-20T00:00:00.000Z" },
      },
      { id: "draft-1", dir: dDir },
    );
    const base = await start();
    const ids = (await (await fetch(`${base}/api/drafts`)).json()) as string[];
    expect(ids).toContain("draft-1");
    const d = (await (await fetch(`${base}/api/drafts/draft-1`)).json()) as { name: string };
    expect(d.name).toBe("gen");
  });

  it("api_get_review_artifact_after_verdict", async () => {
    await persistRun(buildRunEnvelope([step], { now: () => 0, newId: () => UUID1 }, "a"), runsDir);
    const base = await start();
    await fetch(`${base}/api/runs/${UUID1}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict: "approved" }),
    });
    const res = await fetch(`${base}/api/reviews/${UUID1}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { runId: string }).runId).toBe(UUID1);
  });
});

describe("API REST (M8) — static SPA serving (T2.2)", () => {
  it("serves_index_html_fallback_for_non_api_route", async () => {
    await writeFile(join(distDir, "index.html"), "<!doctype html><title>Hodor</title>", "utf8");
    const base = await start(true);
    const res = await fetch(`${base}/runs/${UUID1}`); // rota SPA (sem extensão)
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Hodor");
  });

  it("serves_static_asset_with_content_type", async () => {
    await mkdir(join(distDir, "assets"), { recursive: true });
    await writeFile(join(distDir, "assets", "app.js"), "console.log(1)", "utf8");
    const base = await start(true);
    const res = await fetch(`${base}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
  });

  it("path_traversal_blocked_returns_404", async () => {
    await writeFile(join(distDir, "index.html"), "<title>Hodor</title>", "utf8");
    const base = await start(true);
    const res = await fetch(`${base}/..%2f..%2fpackage.json`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('"name": "hodor"');
  });

  it("api_route_still_json_when_dist_present", async () => {
    await writeFile(join(distDir, "index.html"), "<title>Hodor</title>", "utf8");
    const base = await start(true);
    const res = await fetch(`${base}/api/runs`);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
