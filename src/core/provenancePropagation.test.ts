import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ScenarioSchema } from "./scenarioSchema.js";
import { RunEnvelopeSchema, type RunStep } from "./runSchema.js";
import { buildRunEnvelope } from "./runStore.js";
import { runScenario } from "./runScenario.js";
import { buildReviewArtifact } from "./reviewArtifact.js";
import type { Provenance } from "./provenance.js";
import type { Verdict } from "./verdict.js";

const prov: Provenance = {
  origin: "agent-generated",
  sourceKind: "curl",
  sourceRef: "curl http://api.test/x",
  generatedAt: "2026-06-19T00:00:00.000Z",
};

const runStep: RunStep = {
  request: { method: "GET", url: "http://api.test/x", headers: {} },
  response: {
    status: 200,
    statusText: "OK",
    headers: {},
    body: "ok",
    timings: { startedAt: "2026-06-19T00:00:00.000Z", durationMs: 1 },
  },
};
const verdict: Verdict = { runId: "r1", verdict: "approved", decidedAt: "2026-06-19T00:00:00.000Z" };

let server: Server | undefined;
afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  }
});
function listen(): Promise<string> {
  server = createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end('{"ok":true}');
  });
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
  });
}

describe("M4 — proveniência aditiva + propagação Scenario→Run→Review", () => {
  it("scenario_schema_accepts_optional_provenance", () => {
    const withProv = { schemaVersion: 1, name: "c", provenance: prov, steps: [{ name: "s", request: { method: "GET", url: "http://x" } }] };
    expect(ScenarioSchema.safeParse(withProv).success).toBe(true);
    // M1 sem provenance segue válido (backward-compat)
    const m1 = { schemaVersion: 1, name: "c", steps: [{ name: "s", request: { method: "GET", url: "http://x" } }] };
    expect(ScenarioSchema.safeParse(m1).success).toBe(true);
  });

  it("run_envelope_accepts_optional_provenance", () => {
    const env = { schemaVersion: 1, runId: "r1", createdAt: "x", provenance: prov, steps: [runStep] };
    expect(RunEnvelopeSchema.safeParse(env).success).toBe(true);
    const legacy = { schemaVersion: 1, runId: "r1", createdAt: "x", steps: [runStep] };
    expect(RunEnvelopeSchema.safeParse(legacy).success).toBe(true);
  });

  it("build_run_envelope_carries_provenance_when_given", () => {
    const withP = buildRunEnvelope([runStep], { now: () => 0, newId: () => "r1" }, "c", prov);
    expect(withP.provenance?.origin).toBe("agent-generated");
    // sem o param → ausente (run_request M0 intacto)
    const without = buildRunEnvelope([runStep], { now: () => 0, newId: () => "r1" });
    expect("provenance" in without).toBe(false);
  });

  it("run_scenario_propagates_scenario_provenance_to_envelope", async () => {
    const base = await listen();
    const scenario = ScenarioSchema.parse({
      schemaVersion: 1,
      name: "gerado",
      provenance: prov,
      steps: [{ name: "get", request: { method: "GET", url: `${base}/x` } }],
    });
    const env = await runScenario(scenario, { now: () => 0, newId: () => "r1" });
    expect(env.provenance?.origin).toBe("agent-generated");
    expect(env.provenance?.sourceKind).toBe("curl");
  });

  it("build_review_artifact_carries_provenance", () => {
    const envWith = buildRunEnvelope([runStep], { now: () => 0, newId: () => "r1" }, "c", prov);
    expect(buildReviewArtifact(envWith, verdict).provenance?.origin).toBe("agent-generated");
    // sem provenance no env → ausente no artefato (artefatos M3 válidos)
    const envWithout = buildRunEnvelope([runStep], { now: () => 0, newId: () => "r1" }, "c");
    expect("provenance" in buildReviewArtifact(envWithout, verdict)).toBe(false);
  });
});
