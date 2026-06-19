import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWebServer } from "./web/server.js";
import {
  runScenario, persistRun, saveVerdict, saveDraft, checkScenario, replaySuite,
  type Scenario, type Provenance,
} from "./core/index.js";

let web: Server | undefined;
let target: Server | undefined;
let runsDir: string | undefined;
let verdictsDir: string | undefined;
let reviewsDir: string | undefined;
let draftsDir: string | undefined;
let serverValue = "A";
const prov: Provenance = { origin: "agent-generated", sourceKind: "endpoint", generatedAt: "x" };

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "hodor-m6-"));
  verdictsDir = await mkdtemp(join(tmpdir(), "hodor-m6-v-"));
  reviewsDir = await mkdtemp(join(tmpdir(), "hodor-m6-r-"));
  draftsDir = await mkdtemp(join(tmpdir(), "hodor-m6-d-"));
  serverValue = "A";
  target = createServer((_q, res) => { res.statusCode = 200; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ value: serverValue })); });
  await new Promise<void>((r) => target!.listen(0, "127.0.0.1", () => r()));
});
afterEach(async () => {
  for (const s of [web, target]) if (s) await new Promise<void>((r) => s!.close(() => r()));
  web = target = undefined;
  for (const d of [runsDir, verdictsDir, reviewsDir, draftsDir]) if (d) await rm(d, { recursive: true, force: true });
  runsDir = verdictsDir = reviewsDir = draftsDir = undefined;
});
function base(): string { return `http://127.0.0.1:${(target!.address() as AddressInfo).port}`; }
function startWeb(): Promise<string> {
  web = buildWebServer(runsDir!, verdictsDir!, reviewsDir!);
  return new Promise((resolve) => web!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(web!.address() as AddressInfo).port}`)));
}
function scenario(): Scenario {
  return { schemaVersion: 1, name: "cenário-gate", provenance: prov, steps: [{ name: "get", request: { method: "GET", url: `${base()}/x` }, asserts: [{ source: "status", op: "equals", value: 200 }] }] };
}

const GOLDEN = "00000000-0000-0000-0000-0000000000g1";

describe("E2E M6 — gate de regressão vs golden", () => {
  it("e2e_m6_check_scenario_gates_on_golden", async () => {
    const sc = scenario();

    // 4. cenário NUNCA aprovado → no_baseline
    expect((await checkScenario(sc, { runsDir, verdictsDir })).status).toBe("no_baseline");

    // 1. roda + humano APROVA → vira golden
    await saveDraft(sc, { dir: draftsDir! }); // cataloga p/ a suíte
    const g = await runScenario(sc, { newId: () => GOLDEN, now: () => 0 });
    await persistRun(g, runsDir!);
    await saveVerdict({ runId: GOLDEN, verdict: "approved", decidedAt: "x" }, verdictsDir!);

    // 2. serviço inalterado → check = ok (sem regressão vs golden)
    expect((await checkScenario(sc, { runsDir, verdictsDir })).status).toBe("ok");

    // 7. o gate NUNCA gravou verdict (humano é o único aprovador)
    expect((await readdir(verdictsDir!)).length).toBe(1); // só o do golden

    // 3. serviço MUDA → check = regression (gate pega a mudança real)
    serverValue = "CHANGED";
    const reg = await checkScenario(sc, { runsDir, verdictsDir, deps: { newId: () => "00000000-0000-0000-0000-0000000000c1", now: () => 5 } });
    expect(reg.status).toBe("regression");
    expect(reg.diff?.hasRegression).toBe(true);

    // 5. replay de suíte → agrega a regressão (allOk false)
    const report = await replaySuite({ draftsDir, runsDir, verdictsDir });
    expect(report.total).toBe(1);
    expect(report.regression).toBe(1);
    expect(report.allOk).toBe(false);

    // 6. web: diff ?vs=golden do run regredido destaca a mudança
    await persistRun(reg.run, runsDir!); // persiste o run regredido p/ vê-lo na web
    const webBase = await startWeb();
    const html = await (await fetch(`${webBase}/runs/00000000-0000-0000-0000-0000000000c1/diff?vs=golden`)).text();
    expect(html).toContain("Mudança de comportamento detectada");
  });
});
