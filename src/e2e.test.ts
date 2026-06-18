import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, getRunCount } from "./mcp/server.js";
import { buildWebServer } from "./web/server.js";
import { loadRun } from "./core/index.js";

let target: Server | undefined;
let web: Server | undefined;
let runsDir: string | undefined;

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "hodor-e2e-"));
  process.env.HODOR_RUNS_DIR = runsDir;
});

afterEach(async () => {
  for (const s of [target, web]) {
    if (s) await new Promise<void>((r) => s.close(() => r()));
  }
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

describe("E2E walking skeleton", () => {
  it("e2e_run_request_persists_and_renders", async () => {
    // 1. API-alvo real (servidor HTTP efêmero).
    target = createServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end('{"ok":true}');
    });
    const targetUrl = (await listen(target)) + "/health";

    // 2. Lado AGENTE: chama run_request via MCP (InMemoryTransport).
    const server = buildServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "e2e-agent", version: "0.0.0" });
    await client.connect(clientT);

    const metricBefore = getRunCount();
    const result = (await client.callTool({
      name: "run_request",
      arguments: { method: "POST", url: targetUrl, body: "{}" },
    })) as { structuredContent?: { runId: string; steps: Array<{ response: { status: number } }> } };

    expect(result.structuredContent?.steps[0]?.response.status).toBe(200);
    const runId = result.structuredContent!.runId;
    // Runtime-metric proof (DoD): a métrica foi exercitada no loop, não só compila.
    expect(getRunCount()).toBe(metricBefore + 1);
    await client.close();

    // 3. Resultado persistido em arquivo (verifica via core).
    const env = await loadRun(join(runsDir!, `${runId}.json`));
    expect(env.steps[0]!.request.url).toBe(targetUrl);

    // 4. Lado HUMANO: web app renderiza o run.
    web = buildWebServer(runsDir!);
    const webBase = await listen(web);
    const page = await fetch(`${webBase}/runs/${runId}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("200"); // status capturado visível
    expect(html).toContain(targetUrl); // url capturada visível
  });
});
