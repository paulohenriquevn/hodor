import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWebServer } from "./web/server.js";
import {
  runScenario, persistRun, findPreviousRun, diffRuns, scenarioKey, pruneRunHistory,
  type Scenario,
} from "./core/index.js";

let web: Server | undefined;
let target: Server | undefined;
let runsDir: string | undefined;
let verdictsDir: string | undefined;
let reviewsDir: string | undefined;

// servidor alvo: body com um `timestamp` VOLÁTIL + um campo `value` controlável
let serverValue = "stable-A";
beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "hodor-m5-"));
  verdictsDir = await mkdtemp(join(tmpdir(), "hodor-m5-v-"));
  reviewsDir = await mkdtemp(join(tmpdir(), "hodor-m5-r-"));
  serverValue = "stable-A";
  let tick = 0;
  target = createServer((_q, res) => {
    tick += 1;
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ value: serverValue, timestamp: `2026-06-19T00:00:0${tick}.000Z` }));
  });
  await new Promise<void>((r) => target!.listen(0, "127.0.0.1", () => r()));
});
afterEach(async () => {
  for (const s of [web, target]) if (s) await new Promise<void>((r) => s!.close(() => r()));
  web = target = undefined;
  for (const d of [runsDir, verdictsDir, reviewsDir]) if (d) await rm(d, { recursive: true, force: true });
  runsDir = verdictsDir = reviewsDir = undefined;
});
function targetBase(): string {
  return `http://127.0.0.1:${(target!.address() as AddressInfo).port}`;
}
function startWeb(): Promise<string> {
  web = buildWebServer(runsDir!, verdictsDir!, reviewsDir!);
  return new Promise((resolve) => web!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(web!.address() as AddressInfo).port}`)));
}

describe("E2E M5 — regressão: diff + anti-flaky", () => {
  it("e2e_m5_diff_detects_real_change_ignores_noise", async () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      name: "cenário-regressão",
      noise: ["$.timestamp"], // campo volátil declarado como noise
      steps: [{ name: "get", request: { method: "GET", url: `${targetBase()}/x` }, asserts: [{ source: "status", op: "equals", value: 200 }] }],
    };

    // run 1 e run 2: MESMO value estável, só o timestamp (noise) muda entre eles
    const r1 = await runScenario(scenario, { now: () => 1, newId: () => "00000000-0000-0000-0000-0000000000a1" });
    await persistRun(r1, runsDir!);
    const r2 = await runScenario(scenario, { now: () => 2, newId: () => "00000000-0000-0000-0000-0000000000a2" });
    await persistRun(r2, runsDir!);

    // 1. histórico comparável (DoD #1): findPreviousRun acha o run anterior do mesmo cenário
    const prev = await findPreviousRun(r2, runsDir!);
    expect(prev?.runId).toBe("00000000-0000-0000-0000-0000000000a1");

    // 2. anti-flaky (DoD #3, risco #1): só o noise mudou → bodyChanged false, sem regressão
    const noiseOnly = diffRuns(r2, await runScenario(scenario, { now: () => 3, newId: () => "x" }));
    expect(noiseOnly.steps[0]!.bodyChanged).toBe(false);
    expect(noiseOnly.hasRegression).toBe(false);

    // 3. mudança REAL no body (DoD #2): muda o value do servidor → run 3 → bodyChanged true
    serverValue = "changed-B";
    const r3 = await runScenario(scenario, { now: () => 4, newId: () => "00000000-0000-0000-0000-0000000000a3" });
    await persistRun(r3, runsDir!);
    const realDiff = diffRuns(r2, r3);
    expect(realDiff.steps[0]!.bodyChanged).toBe(true);
    expect(realDiff.hasRegression).toBe(true);

    // 4. web app destaca a mudança real e ignora o noise (DoD #2)
    const base = await startWeb();
    const html = await (await fetch(`${base}/runs/00000000-0000-0000-0000-0000000000a3/diff`)).text();
    expect(html).toContain("Mudança de comportamento detectada");
    expect(html).toContain("body mudou");

    // 5. retenção (risco #2): poda last-2 mantém os 2 mais recentes do cenário
    await pruneRunHistory(scenarioKey(r3), runsDir!, 2, verdictsDir!);
    const left = (await readdir(runsDir!)).map((f) => f.replace(".json", "")).sort();
    expect(left).toHaveLength(2);
    expect(left).toContain("00000000-0000-0000-0000-0000000000a3"); // mais recente mantido
    expect(left).not.toContain("00000000-0000-0000-0000-0000000000a1"); // mais antigo podado
  });
});
