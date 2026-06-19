import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, getDraftSavedCount } from "./server.js";
import { loadDraft, listDrafts } from "../core/index.js";

let draftsDir: string | undefined;

beforeEach(async () => {
  draftsDir = await mkdtemp(join(tmpdir(), "hodor-mcp-draft-"));
  process.env.HODOR_DRAFTS_DIR = draftsDir;
});
afterEach(async () => {
  if (draftsDir) await rm(draftsDir, { recursive: true, force: true });
  draftsDir = undefined;
  delete process.env.HODOR_DRAFTS_DIR;
});

async function connectedClient(): Promise<Client> {
  const server = buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "draft-agent", version: "0.0.0" });
  await client.connect(ct);
  return client;
}

const genScenario = {
  schemaVersion: 1,
  name: "gerado-de-curl",
  provenance: { origin: "agent-generated", sourceKind: "curl", sourceRef: "curl http://api.test/x", generatedAt: "2026-06-19T00:00:00.000Z" },
  steps: [{ name: "get", request: { method: "GET", url: "http://api.test/x" }, asserts: [{ source: "status", op: "lt", value: 500 }] }],
};

describe("mcp save_scenario_draft tool", () => {
  it("save_scenario_draft_tool_persists_draft_via_inmemory_transport", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({ name: "save_scenario_draft", arguments: genScenario })) as {
      structuredContent?: { draftId: string; path: string };
    };
    const draftId = result.structuredContent!.draftId;
    expect(draftId).toBeTruthy();
    const back = await loadDraft(draftId, draftsDir!);
    expect(back?.provenance.origin).toBe("agent-generated");
    expect(back?.name).toBe("gerado-de-curl");
    await client.close();
  });

  it("save_scenario_draft_tool_rejects_invalid_scenario", async () => {
    const client = await connectedClient();
    // steps vazio → inválido na fronteira MCP → isError; nada persiste.
    const result = (await client.callTool({
      name: "save_scenario_draft",
      arguments: { ...genScenario, steps: [] },
    })) as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(await listDrafts(draftsDir!)).toEqual([]); // nada persistido
    await client.close();
  });

  it("save_scenario_draft_tool_does_not_execute_or_approve", async () => {
    // a tool NÃO escreve em runs/ nem reviews/ — só drafts/. (risco #1)
    const runsDir = await mkdtemp(join(tmpdir(), "hodor-mcp-draft-runs-"));
    process.env.HODOR_RUNS_DIR = runsDir;
    const client = await connectedClient();
    await client.callTool({ name: "save_scenario_draft", arguments: genScenario });
    const { readdir } = await import("node:fs/promises");
    await expect(readdir(runsDir)).resolves.toEqual([]); // nenhum run criado
    await client.close();
    await rm(runsDir, { recursive: true, force: true });
    delete process.env.HODOR_RUNS_DIR;
  });

  it("save_scenario_draft_increments_metric", async () => {
    const before = getDraftSavedCount();
    const client = await connectedClient();
    await client.callTool({ name: "save_scenario_draft", arguments: genScenario });
    expect(getDraftSavedCount()).toBe(before + 1);
    await client.close();
  });
});
