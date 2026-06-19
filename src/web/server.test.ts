import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWebServer } from "./server.js";
import { buildRunEnvelope, persistRun, loadVerdict, loadReviewArtifact, type RunStep } from "../core/index.js";

const sampleStep: RunStep = {
  request: { method: "GET", url: "http://127.0.0.1:8080/ok", headers: {} },
  response: {
    status: 200,
    statusText: "OK",
    headers: {},
    body: "ok",
    timings: { startedAt: "2026-06-18T00:00:00.000Z", durationMs: 1 },
  },
};

const UUID1 = "00000000-0000-0000-0000-000000000001";
const UUID2 = "00000000-0000-0000-0000-000000000002";

let server: Server | undefined;
let dir: string | undefined;
let vdir: string | undefined;
let rdir: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hodor-web-"));
  vdir = await mkdtemp(join(tmpdir(), "hodor-web-v-"));
  rdir = await mkdtemp(join(tmpdir(), "hodor-web-r-"));
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  }
  for (const d of [dir, vdir, rdir]) if (d) await rm(d, { recursive: true, force: true });
  dir = undefined;
  vdir = undefined;
  rdir = undefined;
});

function start(): Promise<string> {
  server = buildWebServer(dir!, vdir!, rdir!);
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe("web server — runs + render", () => {
  it("web_server_returns_404_for_missing_run", async () => {
    const base = await start();
    const res = await fetch(`${base}/runs/${UUID1}`);
    expect(res.status).toBe(404);
  });

  it("web_server_rejects_path_traversal_id", async () => {
    const base = await start();
    const res = await fetch(`${base}/runs/..%2f..%2fpackage.json`);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('"name": "hodor"');
  });

  it("web_server_root_shows_no_runs_when_empty", async () => {
    const base = await start();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("no runs yet");
  });

  it("web_server_returns_405_with_allow_header", async () => {
    // POST a um recurso de run (GET-only) com id VÁLIDO → 405 allow GET (F-dom-3)
    const base = await start();
    const res = await fetch(`${base}/runs/${UUID1}`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });

  it("web_server_unknown_path_is_404_not_405", async () => {
    // F-dom-2: rota inexistente → 404 (não 405), mesmo com método não-GET
    const base = await start();
    expect((await fetch(`${base}/foo`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${base}/foo`)).status).toBe(404);
  });
});

describe("web server — M2 listing", () => {
  it("web_server_root_lists_runs", async () => {
    await persistRun(buildRunEnvelope([sampleStep], { now: () => 0, newId: () => UUID1 }, "cenário-a"), dir!);
    await persistRun(buildRunEnvelope([sampleStep], { now: () => 1, newId: () => UUID2 }, "cenário-b"), dir!);
    const base = await start();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(UUID1);
    expect(html).toContain(UUID2);
    expect(html).toContain("cenário-a");
    expect(html).toContain("pendente");
  });

  it("listing_skips_corrupt_run_file", async () => {
    await persistRun(buildRunEnvelope([sampleStep], { now: () => 0, newId: () => UUID1 }, "valido"), dir!);
    // arquivo corrompido com stem UUID (válido por nome, inválido por conteúdo)
    await writeFile(join(dir!, `${UUID2}.json`), "{ not valid json", "utf8");
    const base = await start();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200); // EC-2: não 500
    const html = await res.text();
    expect(html).toContain(UUID1); // o válido é listado
  });
});

describe("web server — M2 verdict (POST)", () => {
  async function persistSample(id: string): Promise<void> {
    await persistRun(buildRunEnvelope([sampleStep], { now: () => 0, newId: () => id }, "c"), dir!);
  }

  it("post_verdict_persists_and_redirects", async () => {
    await persistSample(UUID1);
    const base = await start();
    const res = await fetch(`${base}/runs/${UUID1}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "verdict=approved&note=looks+good",
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/runs/${UUID1}`);
    const v = await loadVerdict(UUID1, vdir!);
    expect(v?.verdict).toBe("approved");
    expect(v?.note).toBe("looks good");
  });

  it("post_verdict_invalid_value_is_400", async () => {
    await persistSample(UUID1);
    const base = await start();
    const res = await fetch(`${base}/runs/${UUID1}/verdict`, {
      method: "POST",
      body: "verdict=maybe",
    });
    expect(res.status).toBe(400);
    // EC-1 (F-tests-3): build+valida em memória ANTES de gravar → sem órfão de verdict NEM de artefato.
    expect(await loadVerdict(UUID1, vdir!)).toBeNull();
    expect(await loadReviewArtifact(UUID1, rdir!)).toBeNull();
  });

  it("post_verdict_missing_field_is_400", async () => {
    await persistSample(UUID1);
    const base = await start();
    const res = await fetch(`${base}/runs/${UUID1}/verdict`, { method: "POST", body: "note=x" });
    expect(res.status).toBe(400);
  });

  it("post_verdict_missing_run_is_404", async () => {
    const base = await start();
    const res = await fetch(`${base}/runs/${UUID2}/verdict`, { method: "POST", body: "verdict=approved" });
    expect(res.status).toBe(404);
  });

  it("post_verdict_traversal_id_is_400", async () => {
    const base = await start();
    const res = await fetch(`${base}/runs/..%2fx/verdict`, { method: "POST", body: "verdict=approved" });
    expect(res.status).toBe(400);
  });

  it("post_verdict_body_too_large_is_413", async () => {
    // F-dom-1: body > 1MB → 413 (erro do cliente), não 500
    await persistSample(UUID1);
    const base = await start();
    const big = "verdict=approved&note=" + "x".repeat(1024 * 1024 + 10);
    const res = await fetch(`${base}/runs/${UUID1}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: big,
    });
    expect(res.status).toBe(413);
  });

  it("get_run_shows_verdict_form", async () => {
    await persistSample(UUID1);
    const base = await start();
    const html = await (await fetch(`${base}/runs/${UUID1}`)).text();
    expect(html).toContain("verdict-form");
    expect(html).toContain("name='verdict'");
    expect(html).toContain("pendente");
  });
});

describe("web server — M3 review artifact (POST escreve versionável)", () => {
  const stepWithVolatile: RunStep = {
    request: { method: "GET", url: "http://api.test/x", headers: {} },
    response: {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json", date: "Mon, 01 Jan 2026" },
      body: '{"ok":true}',
      timings: { startedAt: "2026-06-19T00:00:00.000Z", durationMs: 5 },
    },
  };

  it("post_verdict_writes_review_artifact", async () => {
    await persistRun(buildRunEnvelope([stepWithVolatile], { now: () => 0, newId: () => UUID1 }, "cen"), dir!);
    const base = await start();
    const res = await fetch(`${base}/runs/${UUID1}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "verdict=approved&note=ok",
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    const artifact = await loadReviewArtifact(UUID1, rdir!);
    expect(artifact?.verdict.verdict).toBe("approved");
    expect(artifact?.artifactVersion).toBe(1);
    expect("timings" in artifact!.steps[0]!.response).toBe(false);
  });

  it("post_verdict_review_artifact_is_normalized", async () => {
    await persistRun(buildRunEnvelope([stepWithVolatile], { now: () => 0, newId: () => UUID1 }, "cen"), dir!);
    const base = await start();
    await fetch(`${base}/runs/${UUID1}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "verdict=rejected",
    });
    const artifact = await loadReviewArtifact(UUID1, rdir!);
    // header volátil "date" foi removido na normalização
    expect(artifact!.steps[0]!.response.headers["date"]).toBeUndefined();
    expect(artifact!.steps[0]!.response.headers["content-type"]).toBe("application/json");
  });
});
