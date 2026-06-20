import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./mcp/server.js";
import { buildReviewArtifact, saveReviewArtifact, loadRun, type Scenario } from "./core/index.js";

let target: Server | undefined;
let runsDir: string | undefined;
let verdictsDir: string | undefined;
let reviewsDir: string | undefined;

const TOKEN = "s3cr3t-bearer-token";
const QKEY = "a/b+c=d"; // 2º segredo com chars especiais (EC-2)

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "hodor-m7-"));
  verdictsDir = await mkdtemp(join(tmpdir(), "hodor-m7-v-"));
  reviewsDir = await mkdtemp(join(tmpdir(), "hodor-m7-r-"));
  process.env.HODOR_RUNS_DIR = runsDir;
  process.env.HODOR_VERDICTS_DIR = verdictsDir;
  process.env.HODOR_REVIEWS_DIR = reviewsDir;
  // servidor que EXIGE auth: 401 sem Bearer correto; 200 com.
  target = createServer((req, res) => {
    if (req.headers["authorization"] !== `Bearer ${TOKEN}`) { res.statusCode = 401; res.end('{"error":"unauthorized"}'); return; }
    res.statusCode = 200; res.setHeader("content-type", "application/json"); res.end('{"ok":true}');
  });
  await new Promise<void>((r) => target!.listen(0, "127.0.0.1", () => r()));
});
afterEach(async () => {
  if (target) await new Promise<void>((r) => target!.close(() => r()));
  target = undefined;
  for (const d of [runsDir, verdictsDir, reviewsDir]) if (d) await rm(d, { recursive: true, force: true });
  runsDir = verdictsDir = reviewsDir = undefined;
  for (const k of ["HODOR_RUNS_DIR", "HODOR_VERDICTS_DIR", "HODOR_REVIEWS_DIR", "HODOR_SECRET_TOKEN", "HODOR_SECRET_QKEY"]) delete process.env[k];
});
function port(): number { return (target!.address() as AddressInfo).port; }
async function connected(): Promise<Client> {
  const server = buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "m7-agent", version: "0.0.0" });
  await client.connect(ct);
  return client;
}

describe("E2E M7 — cenário autenticado via env, segredo nunca persistido", () => {
  it("e2e_m7_authenticated_scenario_never_persists_secret", async () => {
    process.env.HODOR_SECRET_TOKEN = TOKEN;
    process.env.HODOR_SECRET_QKEY = QKEY;
    const sc: Scenario = {
      schemaVersion: 1,
      name: "api-autenticada",
      steps: [{
        name: "get",
        request: {
          method: "GET",
          url: `http://127.0.0.1:${port()}/x?q=${"${{ env.QKEY }}"}`, // 2º segredo em QUERY (será encodado — EC-2)
          headers: { Authorization: "Bearer ${{ env.TOKEN }}" },
          body: `{"k":"${"${{ env.QKEY }}"}"}`, // 2º segredo em BODY
        },
        asserts: [{ source: "status", op: "equals", value: 200 }],
      }],
    };
    const client = await connected();

    // 3. auth via env funcionou → 200 (DoD #3)
    const res = (await client.callTool({ name: "run_scenario", arguments: sc })) as { structuredContent?: { runId: string; steps: { response: { status: number } }[] } };
    expect(res.structuredContent!.steps[0]!.response.status).toBe(200); // não 401 — token injetado

    // 4. o run persistido NÃO contém nenhum segredo (raw NEM encodado) (DoD #2)
    const files = await readdir(runsDir!);
    const raw = await readFile(join(runsDir!, files[0]!), "utf8");
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain(QKEY); // forma crua a/b+c=d
    expect(raw).not.toContain(encodeURIComponent(QKEY)); // EC-2: forma encodada a%2Fb%2Bc%3Dd
    expect(raw).toContain("<redacted>");

    // 5. o artefato de review (a partir do run redigido) também não vaza
    const env = await loadRun(join(runsDir!, files[0]!));
    const artifact = buildReviewArtifact(env, { runId: env.runId, verdict: "approved", decidedAt: "x" });
    const apath = await saveReviewArtifact(artifact, reviewsDir!);
    const reviewRaw = await readFile(apath, "utf8");
    expect(reviewRaw).not.toContain(TOKEN);
    expect(reviewRaw).not.toContain(QKEY);
    expect(reviewRaw).not.toContain(encodeURIComponent(QKEY));

    await client.close();
  });

  it("e2e_m7_missing_secret_fails_fast_and_non_prefixed_unreachable", async () => {
    // 6. secret ausente → ScenarioError (não dispara request sem auth) (D6)
    const noSecret: Scenario = { schemaVersion: 1, name: "x", steps: [{ name: "g", request: { method: "GET", url: `http://127.0.0.1:${port()}/x`, headers: { Authorization: "Bearer ${{ env.NAO_EXISTE }}" } } }] };
    const client = await connected();
    expect(((await client.callTool({ name: "run_scenario", arguments: noSecret })) as { isError?: boolean }).isError).toBe(true);

    // 7. env não-prefixado (PATH) inacessível
    const leak: Scenario = { schemaVersion: 1, name: "y", steps: [{ name: "g", request: { method: "GET", url: `http://127.0.0.1:${port()}/x`, headers: { "x-leak": "${{ env.PATH }}" } } }] };
    expect(((await client.callTool({ name: "run_scenario", arguments: leak })) as { isError?: boolean }).isError).toBe(true);
    await client.close();
  });
});
