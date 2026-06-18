import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, getRunCount } from "./server.js";
import { loadRun } from "../core/index.js";

let target: Server | undefined;
let runsDir: string | undefined;

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "hodor-mcp-"));
  process.env.HODOR_RUNS_DIR = runsDir;
});

afterEach(async () => {
  if (target) {
    await new Promise<void>((r) => target!.close(() => r()));
    target = undefined;
  }
  if (runsDir) {
    await rm(runsDir, { recursive: true, force: true });
    runsDir = undefined;
  }
  delete process.env.HODOR_RUNS_DIR;
});

function listenTarget(status = 200, body = "ok"): Promise<string> {
  target = createServer((_req, res) => {
    res.statusCode = status;
    res.end(body);
  });
  return new Promise((resolve) => {
    target!.listen(0, "127.0.0.1", () => {
      const { port } = target!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}/`);
    });
  });
}

async function connectedClient(): Promise<Client> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("mcp run_request tool", () => {
  it("run_request_tool_executes_and_returns_envelope", async () => {
    const url = await listenTarget(200, "pong");
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "run_request",
      arguments: { method: "GET", url },
    })) as { structuredContent?: { schemaVersion: number; steps: unknown[] } };
    expect(result.structuredContent?.schemaVersion).toBe(1);
    expect(result.structuredContent?.steps).toHaveLength(1);
    await client.close();
  });

  it("run_request_tool_persists_run_file", async () => {
    const url = await listenTarget(200, "pong");
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "run_request",
      arguments: { method: "GET", url },
    })) as { structuredContent?: { runId: string } };
    const runId = result.structuredContent!.runId;
    const path = join(runsDir!, `${runId}.json`);
    await expect(access(path)).resolves.toBeUndefined();
    const back = await loadRun(path);
    expect(back.steps[0]!.response.status).toBe(200);
    await client.close();
  });

  it("run_request_tool_increments_run_count", async () => {
    const url = await listenTarget(200, "pong");
    const before = getRunCount();
    const client = await connectedClient();
    await client.callTool({ name: "run_request", arguments: { method: "GET", url } });
    expect(getRunCount()).toBe(before + 1);
    await client.close();
  });
});
