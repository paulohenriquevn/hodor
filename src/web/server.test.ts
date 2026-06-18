import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWebServer } from "./server.js";
import { buildRunEnvelope, persistRun, type RunStep } from "../core/index.js";

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

let server: Server | undefined;
let dir: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hodor-web-"));
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  }
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

function start(): Promise<string> {
  server = buildWebServer(dir!);
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe("web server", () => {
  it("web_server_returns_404_for_missing_run", async () => {
    const base = await start();
    // valid UUID-shaped id that does not exist on disk
    const res = await fetch(`${base}/runs/11111111-1111-1111-1111-111111111111`);
    expect(res.status).toBe(404);
  });

  it("web_server_rejects_path_traversal_id", async () => {
    const base = await start();
    // EC-1: non-UUID id (path traversal attempt) must be rejected with 400, no file leak.
    const res = await fetch(`${base}/runs/..%2f..%2fpackage.json`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain("\"name\": \"hodor\"");
  });

  it("web_server_root_shows_no_runs_when_empty", async () => {
    const base = await start();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("no runs yet");
  });

  it("web_server_root_redirects_to_latest_run", async () => {
    // F-tests-1: persiste 2 runs; `/` deve redirecionar (302) para o mais recente.
    const older = buildRunEnvelope([sampleStep], { now: () => 0, newId: () => "00000000-0000-0000-0000-000000000001" });
    await persistRun(older, dir!);
    await new Promise((r) => setTimeout(r, 10)); // garante mtime distinto
    const newer = buildRunEnvelope([sampleStep], { now: () => 1, newId: () => "00000000-0000-0000-0000-000000000002" });
    await persistRun(newer, dir!);

    const base = await start();
    const res = await fetch(`${base}/`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/runs/${newer.runId}`);
  });

  it("web_server_returns_405_with_allow_header", async () => {
    const base = await start();
    const res = await fetch(`${base}/runs/x`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });
});
