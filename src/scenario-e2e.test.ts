import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, getScenarioRunCount } from "./mcp/server.js";
import { buildWebServer } from "./web/server.js";
import { loadRun } from "./core/index.js";

let target: Server | undefined;
let web: Server | undefined;
let runsDir: string | undefined;

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "hodor-scn-e2e-"));
  process.env.HODOR_RUNS_DIR = runsDir;
});
afterEach(async () => {
  for (const s of [target, web]) if (s) await new Promise<void>((r) => s.close(() => r()));
  target = undefined;
  web = undefined;
  if (runsDir) await rm(runsDir, { recursive: true, force: true });
  runsDir = undefined;
  delete process.env.HODOR_RUNS_DIR;
});

function listen(s: Server): Promise<string> {
  return new Promise((resolve) => {
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe("E2E scenario multi-step", () => {
  it("e2e_scenario_multistep_captures_and_asserts", async () => {
    // 1. Alvo real com roteamento: POST /posts → 201 {"id":7}; GET /posts/7 → 200 {"ok":true}.
    target = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/posts") {
        res.statusCode = 201;
        res.setHeader("content-type", "application/json");
        res.end('{"id":7}');
        return;
      }
      if (req.method === "GET" && req.url === "/posts/7") {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end('{"ok":true}');
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
    const base = await listen(target);

    // 2. Lado AGENTE: run_scenario via MCP (InMemoryTransport).
    const server = buildServer();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "scn-e2e-agent", version: "0.0.0" });
    await client.connect(ct);

    const metricBefore = getScenarioRunCount();
    const result = (await client.callTool({
      name: "run_scenario",
      arguments: {
        schemaVersion: 1,
        name: "create-then-fetch",
        steps: [
          {
            name: "create",
            request: { method: "POST", url: `${base}/posts`, body: "{}" },
            captures: { id: { jsonpath: "$.id" } },
            asserts: [{ source: "status", op: "equals", value: 201 }],
          },
          {
            name: "fetch",
            request: { method: "GET", url: `${base}/posts/${"${{ id }}"}` },
            asserts: [
              { source: "status", op: "equals", value: 200 },
              { source: "jsonpath:$.ok", op: "equals", value: true },
            ],
          },
        ],
      },
    })) as {
      structuredContent?: {
        runId: string;
        steps: Array<{ request: { url: string }; captures?: Record<string, unknown>; asserts?: Array<{ pass: boolean }> }>;
      };
    };

    const env = result.structuredContent!;
    // captura propagou: step2 URL reflete o id capturado no step1
    expect(env.steps[0]!.captures).toEqual({ id: 7 });
    expect(env.steps[1]!.request.url).toBe(`${base}/posts/7`);
    // asserts pass
    expect(env.steps[1]!.asserts!.every((a) => a.pass)).toBe(true);
    // runtime-metric proof
    expect(getScenarioRunCount()).toBe(metricBefore + 1);
    const runId = env.runId;
    await client.close();

    // 3. Persistido em arquivo (via core).
    const loaded = await loadRun(join(runsDir!, `${runId}.json`));
    expect(loaded.steps).toHaveLength(2);

    // 4. Lado HUMANO: web app renderiza asserts + captures.
    web = buildWebServer(runsDir!);
    const webBase = await listen(web);
    const page = await fetch(`${webBase}/runs/${runId}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Asserts");
    expect(html).toContain("Captures");
    expect(html).toContain("PASS");
  });
});
