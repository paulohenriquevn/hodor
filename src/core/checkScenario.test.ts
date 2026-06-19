import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkScenario } from "./checkScenario.js";
import { persistRun } from "./runStore.js";
import { saveVerdict } from "./verdict.js";
import type { Scenario } from "./scenarioSchema.js";

let target: Server | undefined;
let runsDir: string | undefined;
let verdictsDir: string | undefined;
let serverValue = "A";

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "hodor-check-"));
  verdictsDir = await mkdtemp(join(tmpdir(), "hodor-check-v-"));
  serverValue = "A";
  target = createServer((_q, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ value: serverValue }));
  });
  await new Promise<void>((r) => target!.listen(0, "127.0.0.1", () => r()));
});
afterEach(async () => {
  if (target) await new Promise<void>((r) => target!.close(() => r()));
  target = undefined;
  for (const d of [runsDir, verdictsDir]) if (d) await rm(d, { recursive: true, force: true });
  runsDir = verdictsDir = undefined;
});
function base(): string {
  return `http://127.0.0.1:${(target!.address() as AddressInfo).port}`;
}
function scenario(): Scenario {
  return { schemaVersion: 1, name: "check-cen", steps: [{ name: "get", request: { method: "GET", url: `${base()}/x` }, asserts: [{ source: "status", op: "equals", value: 200 }] }] };
}
// cria um golden aprovado rodando o cenário e aprovando o run
async function makeGolden(): Promise<void> {
  const { runScenario } = await import("./runScenario.js");
  const g = await runScenario(scenario(), { newId: () => "golden-1", now: () => 0 });
  await persistRun(g, runsDir!);
  await saveVerdict({ runId: "golden-1", verdict: "approved", decidedAt: "x" }, verdictsDir!);
}

describe("checkScenario (M6)", () => {
  it("check_scenario_no_baseline_when_no_golden", async () => {
    const res = await checkScenario(scenario(), { runsDir, verdictsDir });
    expect(res.status).toBe("no_baseline");
    expect(res.diff).toBeNull();
  });

  it("check_scenario_ok_when_matches_golden", async () => {
    await makeGolden();
    const res = await checkScenario(scenario(), { runsDir, verdictsDir });
    expect(res.status).toBe("ok");
    expect(res.diff?.hasRegression).toBe(false);
  });

  it("check_scenario_regression_when_behavior_changes", async () => {
    await makeGolden();
    serverValue = "B"; // serviço mudou o body
    const res = await checkScenario(scenario(), { runsDir, verdictsDir });
    expect(res.status).toBe("regression");
    expect(res.diff?.hasRegression).toBe(true);
  });

  it("check_scenario_returns_fresh_run", async () => {
    await makeGolden();
    const res = await checkScenario(scenario(), { runsDir, verdictsDir, deps: { newId: () => "fresh-1", now: () => 9 } });
    expect(res.run.runId).toBe("fresh-1"); // run novo, não o golden
  });

  it("check_scenario_finds_golden_before_persisting", async () => {
    // EC-3: o core NÃO persiste; runs/ continua só com o golden após o check
    await makeGolden();
    await checkScenario(scenario(), { runsDir, verdictsDir, deps: { newId: () => "fresh-2" } });
    const files = (await readdir(runsDir!)).map((f) => f.replace(".json", ""));
    expect(files).toEqual(["golden-1"]); // o run novo não foi persistido pelo core
  });

  it("check_scenario_does_not_match_other_scenario_golden", async () => {
    // EC-2: golden de um cenário com name diferente não é usado
    await makeGolden();
    const other: Scenario = { ...scenario(), name: "OUTRO-cenário" };
    const res = await checkScenario(other, { runsDir, verdictsDir });
    expect(res.status).toBe("no_baseline");
  });

  it("check_scenario_never_writes_verdict", async () => {
    await makeGolden();
    const before = (await readdir(verdictsDir!)).length;
    await checkScenario(scenario(), { runsDir, verdictsDir });
    expect((await readdir(verdictsDir!)).length).toBe(before); // nenhum verdict novo
  });
});
