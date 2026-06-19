import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWebServer } from "./web/server.js";
import { buildRunEnvelope, persistRun, loadVerdict, type RunStep } from "./core/index.js";

let server: Server | undefined;
let runsDir: string | undefined;
let verdictsDir: string | undefined;

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "hodor-review-e2e-"));
  verdictsDir = await mkdtemp(join(tmpdir(), "hodor-review-e2e-v-"));
});
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
  for (const d of [runsDir, verdictsDir]) if (d) await rm(d, { recursive: true, force: true });
  runsDir = undefined;
  verdictsDir = undefined;
});

function start(): Promise<string> {
  server = buildWebServer(runsDir!, verdictsDir!);
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

const RUN_ID = "00000000-0000-0000-0000-0000000000aa";

const step: RunStep = {
  request: { method: "GET", url: "http://api.test/x", headers: { "x-trace": "t1" } },
  response: {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json" },
    body: '{"ok":true}',
    timings: { startedAt: "2026-06-18T00:00:00.000Z", durationMs: 5 },
  },
  asserts: [{ source: "status", op: "equals", value: 200, pass: true, expected: 200, actual: 200 }],
};

describe("E2E review", () => {
  it("e2e_review_lists_renders_and_records_verdict", async () => {
    // 1. Persiste um run (de cenário, com name + assert pass)
    const env = buildRunEnvelope([step], { now: () => 0, newId: () => RUN_ID }, "meu-cenário");
    await persistRun(env, runsDir!);
    const base = await start();

    // 2. GET / lista o run como pendente
    const list = await (await fetch(`${base}/`)).text();
    expect(list).toContain(RUN_ID);
    expect(list).toContain("meu-cenário");
    expect(list).toContain("pendente");

    // 3. GET /runs/:id mostra os asserts + form
    const runPage = await (await fetch(`${base}/runs/${RUN_ID}`)).text();
    expect(runPage).toContain("Asserts");
    expect(runPage).toContain("verdict-form");

    // 4. POST verdict approved → 303
    const post = await fetch(`${base}/runs/${RUN_ID}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "verdict=approved&note=revisado+ok",
      redirect: "manual",
    });
    expect(post.status).toBe(303);

    // 5. Verdict persistido (prova observável)
    const v = await loadVerdict(RUN_ID, verdictsDir!);
    expect(v?.verdict).toBe("approved");
    expect(v?.note).toBe("revisado ok");

    // 6. Reload mostra o verdict (não mais pendente)
    const reload = await (await fetch(`${base}/runs/${RUN_ID}`)).text();
    expect(reload).toContain("approved");
    const relist = await (await fetch(`${base}/`)).text();
    expect(relist).toContain("approved");
  });
});
