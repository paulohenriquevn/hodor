import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaySuite } from "./replaySuite.js";
import { saveDraft } from "./draftStore.js";
import { runScenario } from "./runScenario.js";
import { persistRun } from "./runStore.js";
import { saveVerdict } from "./verdict.js";
import type { Scenario, Provenance } from "./index.js";

let target: Server | undefined;
let draftsDir: string | undefined;
let runsDir: string | undefined;
let verdictsDir: string | undefined;
let serverValue = "A";

const prov: Provenance = { origin: "agent-generated", sourceKind: "endpoint", generatedAt: "x" };

beforeEach(async () => {
  draftsDir = await mkdtemp(join(tmpdir(), "hodor-suite-d-"));
  runsDir = await mkdtemp(join(tmpdir(), "hodor-suite-r-"));
  verdictsDir = await mkdtemp(join(tmpdir(), "hodor-suite-v-"));
  serverValue = "A";
  target = createServer((_q, res) => { res.statusCode = 200; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ value: serverValue })); });
  await new Promise<void>((r) => target!.listen(0, "127.0.0.1", () => r()));
});
afterEach(async () => {
  if (target) await new Promise<void>((r) => target!.close(() => r()));
  target = undefined;
  for (const d of [draftsDir, runsDir, verdictsDir]) if (d) await rm(d, { recursive: true, force: true });
  draftsDir = runsDir = verdictsDir = undefined;
});
function base(): string { return `http://127.0.0.1:${(target!.address() as AddressInfo).port}`; }
function scenario(name: string, path: string): Scenario {
  return { schemaVersion: 1, name, provenance: prov, steps: [{ name: "get", request: { method: "GET", url: `${base()}${path}` } }] };
}
async function catalogWithGolden(name: string, path: string, goldenId: string): Promise<void> {
  const sc = scenario(name, path);
  await saveDraft(sc, { dir: draftsDir! }); // catálogo
  const g = await runScenario(sc, { newId: () => goldenId, now: () => 0 });
  await persistRun(g, runsDir!);
  await saveVerdict({ runId: goldenId, verdict: "approved", decidedAt: "x" }, verdictsDir!);
}

describe("replaySuite (M6)", () => {
  it("replay_suite_empty_catalog_is_allOk", async () => {
    const r = await replaySuite({ draftsDir, runsDir, verdictsDir });
    expect(r.total).toBe(0);
    expect(r.allOk).toBe(true);
  });

  it("replay_suite_counts_no_baseline_without_failing", async () => {
    await saveDraft(scenario("sem-golden", "/x"), { dir: draftsDir! }); // draft sem golden
    const r = await replaySuite({ draftsDir, runsDir, verdictsDir });
    expect(r.noBaseline).toBe(1);
    expect(r.regression).toBe(0);
    expect(r.allOk).toBe(true); // no_baseline não derruba
  });

  it("replay_suite_aggregates_ok_and_regression", async () => {
    await catalogWithGolden("cen-ok", "/ok", "g-ok");
    await catalogWithGolden("cen-reg", "/reg", "g-reg");
    serverValue = "CHANGED"; // muda o body p/ TODOS → ambos regridem... então diferencio:
    // re-aprovo cen-ok com o novo golden p/ casar
    const okSc = scenario("cen-ok", "/ok");
    const g2 = await runScenario(okSc, { newId: () => "g-ok2", now: () => 5 });
    await persistRun(g2, runsDir!);
    await saveVerdict({ runId: "g-ok2", verdict: "approved", decidedAt: "x" }, verdictsDir!);
    const r = await replaySuite({ draftsDir, runsDir, verdictsDir });
    expect(r.total).toBe(2);
    expect(r.ok).toBe(1); // cen-ok casa o golden novo
    expect(r.regression).toBe(1); // cen-reg regride vs golden velho
    expect(r.allOk).toBe(false);
  });

  it("replay_suite_isolates_failing_scenario", async () => {
    // EC-1: cenário cujo alvo está fora do ar → status error isolado, não aborta a suíte
    await catalogWithGolden("cen-vivo", "/x", "g-vivo");
    await saveDraft({ schemaVersion: 1, name: "cen-morto", provenance: prov, steps: [{ name: "get", request: { method: "GET", url: "http://127.0.0.1:1/dead" } }] }, { dir: draftsDir! });
    const r = await replaySuite({ draftsDir, runsDir, verdictsDir });
    expect(r.total).toBe(2);
    expect(r.error).toBe(1); // o morto vira error
    expect(r.ok).toBe(1); // o vivo roda normalmente
    expect(r.allOk).toBe(false); // error derruba allOk
  });

  it("replay_suite_results_carry_status_per_scenario", async () => {
    await catalogWithGolden("cen-x", "/x", "g-x");
    const r = await replaySuite({ draftsDir, runsDir, verdictsDir });
    expect(r.results[0]).toMatchObject({ scenarioKey: "cen-x", status: "ok" });
  });

  it("replay_suite_reports_uncatalogued_goldens", async () => {
    // F-dom-2: um cenário aprovado (golden) SEM draft → fora da suíte; o report avisa
    const orphan = scenario("cen-órfão", "/x");
    const g = await runScenario(orphan, { newId: () => "g-orphan", now: () => 0 });
    await persistRun(g, runsDir!);
    await saveVerdict({ runId: "g-orphan", verdict: "approved", decidedAt: "x" }, verdictsDir!);
    // NÃO salva draft do órfão; cataloga outro cenário
    await catalogWithGolden("cen-cat", "/y", "g-cat");
    const r = await replaySuite({ draftsDir, runsDir, verdictsDir });
    expect(r.total).toBe(1); // só o catalogado roda
    expect(r.uncataloguedGoldens).toBe(1); // o órfão tem golden mas não está na suíte
  });

  it("replay_suite_error_result_carries_reason", async () => {
    // F-dom-5: erro não é engolido — a razão fica no resultado
    await catalogWithGolden("cen-vivo", "/x", "g-vivo2");
    await saveDraft({ schemaVersion: 1, name: "cen-morto", provenance: prov, steps: [{ name: "get", request: { method: "GET", url: "http://127.0.0.1:1/dead" } }] }, { dir: draftsDir! });
    const r = await replaySuite({ draftsDir, runsDir, verdictsDir });
    const errored = r.results.find((x) => x.status === "error");
    expect(errored?.error).toBeTruthy(); // razão presente, não engolida
  });
});
