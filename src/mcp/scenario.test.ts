import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, getScenarioRunCount } from "./server.js";
import { loadRun } from "../core/index.js";

let target: Server | undefined;
let runsDir: string | undefined;

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "hodor-scn-"));
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

function listenTarget(): Promise<string> {
  target = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/posts") {
      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.end('{"id":7}');
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end('{"ok":true}');
  });
  return new Promise((resolve) => {
    target!.listen(0, "127.0.0.1", () => {
      const { port } = target!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

async function connectedClient(): Promise<Client> {
  const server = buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "scn-agent", version: "0.0.0" });
  await client.connect(ct);
  return client;
}

function scenario(base: string) {
  return {
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
        asserts: [{ source: "status", op: "equals", value: 200 }],
      },
    ],
  };
}

describe("mcp run_scenario tool", () => {
  it("run_scenario_tool_executes_and_returns_envelope", async () => {
    const base = await listenTarget();
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "run_scenario",
      arguments: scenario(base),
    })) as { structuredContent?: { schemaVersion: number; steps: unknown[] } };
    expect(result.structuredContent?.schemaVersion).toBe(1);
    expect(result.structuredContent?.steps).toHaveLength(2);
    await client.close();
  });

  it("run_scenario_tool_persists_run_file", async () => {
    const base = await listenTarget();
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "run_scenario",
      arguments: scenario(base),
    })) as { structuredContent?: { runId: string } };
    const path = join(runsDir!, `${result.structuredContent!.runId}.json`);
    await expect(access(path)).resolves.toBeUndefined();
    const back = await loadRun(path);
    expect(back.steps).toHaveLength(2);
    await client.close();
  });

  it("run_scenario_tool_increments_count", async () => {
    const base = await listenTarget();
    const before = getScenarioRunCount();
    const client = await connectedClient();
    await client.callTool({ name: "run_scenario", arguments: scenario(base) });
    expect(getScenarioRunCount()).toBe(before + 1);
    await client.close();
  });
});
