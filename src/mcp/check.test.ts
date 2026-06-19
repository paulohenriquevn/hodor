import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./server.js";
import { runScenario, persistRun, saveVerdict, saveDraft, type Scenario, type Provenance } from "../core/index.js";

let target: Server | undefined;
let runsDir: string | undefined;
let verdictsDir: string | undefined;
let draftsDir: string | undefined;
let serverValue = "A";
const prov: Provenance = { origin: "agent-generated", sourceKind: "endpoint", generatedAt: "x" };

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "hodor-mcp-check-"));
  verdictsDir = await mkdtemp(join(tmpdir(), "hodor-mcp-check-v-"));
  draftsDir = await mkdtemp(join(tmpdir(), "hodor-mcp-check-d-"));
  process.env.HODOR_RUNS_DIR = runsDir;
  process.env.HODOR_VERDICTS_DIR = verdictsDir;
  process.env.HODOR_DRAFTS_DIR = draftsDir;
  serverValue = "A";
  target = createServer((_q, res) => { res.statusCode = 200; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ value: serverValue })); });
  await new Promise<void>((r) => target!.listen(0, "127.0.0.1", () => r()));
});
afterEach(async () => {
  if (target) await new Promise<void>((r) => target!.close(() => r()));
  target = undefined;
  for (const d of [runsDir, verdictsDir, draftsDir]) if (d) await rm(d, { recursive: true, force: true });
  runsDir = verdictsDir = draftsDir = undefined;
  delete process.env.HODOR_RUNS_DIR; delete process.env.HODOR_VERDICTS_DIR; delete process.env.HODOR_DRAFTS_DIR;
});
function base(): string { return `http://127.0.0.1:${(target!.address() as AddressInfo).port}`; }
function scenario(): Scenario { return { schemaVersion: 1, name: "mcp-check", provenance: prov, steps: [{ name: "get", request: { method: "GET", url: `${base()}/x` } }] }; }
async function connected(): Promise<Client> {
  const server = buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "check-agent", version: "0.0.0" });
  await client.connect(ct);
  return client;
}
async function makeGolden(): Promise<void> {
  const g = await runScenario(scenario(), { newId: () => "golden-1", now: () => 0 });
  await persistRun(g, runsDir!);
  await saveVerdict({ runId: "golden-1", verdict: "approved", decidedAt: "x" }, verdictsDir!);
}

describe("mcp check_scenario / replay_suite (M6)", () => {
  it("check_scenario_tool_returns_structured_status", async () => {
    const client = await connected();
    const res = (await client.callTool({ name: "check_scenario", arguments: scenario() })) as { structuredContent?: { status: string } };
    expect(res.structuredContent?.status).toBe("no_baseline"); // sem golden
    await client.close();
  });

  it("check_scenario_tool_detects_regression", async () => {
    await makeGolden();
    serverValue = "CHANGED";
    const client = await connected();
    const res = (await client.callTool({ name: "check_scenario", arguments: scenario() })) as { structuredContent?: { status: string; hasRegression: boolean } };
    expect(res.structuredContent?.status).toBe("regression");
    expect(res.structuredContent?.hasRegression).toBe(true);
    await client.close();
  });

  it("check_scenario_tool_persists_run_but_no_verdict", async () => {
    await makeGolden();
    const before = (await readdir(verdictsDir!)).length;
    const client = await connected();
    await client.callTool({ name: "check_scenario", arguments: scenario() });
    expect((await readdir(runsDir!)).length).toBeGreaterThan(1); // run novo persistido
    expect((await readdir(verdictsDir!)).length).toBe(before); // nenhum verdict novo (não auto-aprova)
    await client.close();
  });

  it("replay_suite_tool_aggregates", async () => {
    await saveDraft(scenario(), { dir: draftsDir! });
    await makeGolden();
    const client = await connected();
    const res = (await client.callTool({ name: "replay_suite", arguments: {} })) as { structuredContent?: { allOk: boolean; total: number } };
    expect(res.structuredContent?.total).toBe(1);
    expect(res.structuredContent?.allOk).toBe(true);
    await client.close();
  });
});
