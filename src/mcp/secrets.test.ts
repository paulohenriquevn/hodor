import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./server.js";
import { resolveHodorSecrets } from "./secrets.js";
import type { Scenario } from "../core/index.js";

describe("resolveHodorSecrets (M7)", () => {
  it("resolve_hodor_secrets_only_prefixed", () => {
    const out = resolveHodorSecrets({ HODOR_SECRET_TOKEN: "abcd1234", PATH: "/x", AWS_SECRET_KEY: "y-very-long" });
    expect(out).toEqual({ TOKEN: "abcd1234" }); // só o prefixado; AWS/PATH ignorados (D2)
  });

  it("resolve_hodor_secrets_skips_empty_and_no_suffix", () => {
    const out = resolveHodorSecrets({ HODOR_SECRET_X: "", HODOR_SECRET_: "zzzz", HODOR_SECRET_OK: "valid-token" });
    expect(out).toEqual({ OK: "valid-token" }); // EC-5 vazio + EC-6 sem sufixo ignorados
  });

  it("resolve_hodor_secrets_skips_too_short", () => {
    expect(resolveHodorSecrets({ HODOR_SECRET_T: "a" })).toEqual({}); // EC-4: < MIN_SECRET_LEN
  });
});

describe("mcp run_scenario — M7 não persiste segredo (T2.1)", () => {
  let target: Server | undefined;
  let runsDir: string | undefined;
  let verdictsDir: string | undefined;
  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "hodor-sec-"));
    verdictsDir = await mkdtemp(join(tmpdir(), "hodor-sec-v-"));
    process.env.HODOR_RUNS_DIR = runsDir;
    process.env.HODOR_VERDICTS_DIR = verdictsDir;
    target = createServer((req, res) => { res.statusCode = 200; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ echo: req.headers["authorization"] ?? null })); });
    await new Promise<void>((r) => target!.listen(0, "127.0.0.1", () => r()));
  });
  afterEach(async () => {
    if (target) await new Promise<void>((r) => target!.close(() => r()));
    target = undefined;
    for (const d of [runsDir, verdictsDir]) if (d) await rm(d, { recursive: true, force: true });
    runsDir = verdictsDir = undefined;
    delete process.env.HODOR_RUNS_DIR; delete process.env.HODOR_VERDICTS_DIR;
    delete process.env.HODOR_SECRET_TOKEN;
  });
  function port(): number { return (target!.address() as AddressInfo).port; }
  async function connected(): Promise<Client> {
    const server = buildServer();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "sec-agent", version: "0.0.0" });
    await client.connect(ct);
    return client;
  }
  const scenario = (): Scenario => ({ schemaVersion: 1, name: "auth", steps: [{ name: "get", request: { method: "GET", url: `http://127.0.0.1:${port()}/x`, headers: { Authorization: "Bearer ${{ env.TOKEN }}" } } }] });

  it("run_scenario_tool_does_not_persist_secret", async () => {
    process.env.HODOR_SECRET_TOKEN = "s3cr3t-token-xyz";
    const client = await connected();
    await client.callTool({ name: "run_scenario", arguments: scenario() });
    // o segredo executou (servidor ecoou) mas o run persistido está redigido
    const files = await readdir(runsDir!);
    const raw = await readFile(join(runsDir!, files[0]!), "utf8");
    expect(raw).not.toContain("s3cr3t-token-xyz"); // segredo NÃO persistido
    expect(raw).toContain("<redacted>");
    await client.close();
  });

  it("run_scenario_tool_structured_content_redacted", async () => {
    process.env.HODOR_SECRET_TOKEN = "s3cr3t-token-xyz";
    const client = await connected();
    const res = (await client.callTool({ name: "run_scenario", arguments: scenario() })) as { structuredContent?: { steps: { request: { headers: Record<string, string> } }[] } };
    expect(res.structuredContent!.steps[0]!.request.headers["Authorization"]).toBe("Bearer <redacted>");
    await client.close();
  });

  it("mcp_does_not_expose_non_prefixed_env", async () => {
    // cenário tenta ler PATH (não-prefixado) → ScenarioError (não é injetável)
    const sc: Scenario = { schemaVersion: 1, name: "leak", steps: [{ name: "get", request: { method: "GET", url: `http://127.0.0.1:${port()}/x`, headers: { "x-leak": "${{ env.PATH }}" } } }] };
    const client = await connected();
    const res = (await client.callTool({ name: "run_scenario", arguments: sc })) as { isError?: boolean };
    expect(res.isError).toBe(true); // PATH não-injetável → erro, não vaza
    await client.close();
  });
});

describe("resolveHodorSecrets — drop diagnóstico (API-DOM-1)", () => {
  it("resolve_hodor_secrets_logs_dropped_short_secret", () => {
    const logs: string[] = [];
    const orig = console.error;
    console.error = (m?: unknown) => { logs.push(String(m)); };
    try {
      resolveHodorSecrets({ HODOR_SECRET_T: "ab" }); // curto → drop logado
    } finally { console.error = orig; }
    expect(logs.some((l) => l.includes("secret_dropped") && l.includes('"name":"T"') && l.includes("too_short"))).toBe(true);
    expect(logs.join()).not.toContain("ab"); // valor NUNCA logado
  });
});
