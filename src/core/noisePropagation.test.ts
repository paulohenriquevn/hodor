import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ScenarioSchema } from "./scenarioSchema.js";
import { RunEnvelopeSchema, type RunStep } from "./runSchema.js";
import { buildRunEnvelope } from "./runStore.js";
import { runScenario } from "./runScenario.js";

const runStep: RunStep = {
  request: { method: "GET", url: "http://api.test/x", headers: {} },
  response: { status: 200, statusText: "OK", headers: {}, body: "ok", timings: { startedAt: "2026-06-19T00:00:00.000Z", durationMs: 1 } },
};

let server: Server | undefined;
afterEach(async () => {
  if (server) { await new Promise<void>((r) => server!.close(() => r())); server = undefined; }
});
function listen(): Promise<string> {
  server = createServer((_q, res) => { res.statusCode = 200; res.setHeader("content-type", "application/json"); res.end('{"ok":true}'); });
  return new Promise((resolve) => server!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`)));
}

describe("M5 — noise aditivo + propagação Scenario→Run", () => {
  it("scenario_schema_accepts_optional_noise", () => {
    const withNoise = { schemaVersion: 1, name: "c", noise: ["$.ts"], steps: [{ name: "s", request: { method: "GET", url: "http://x" } }] };
    expect(ScenarioSchema.safeParse(withNoise).success).toBe(true);
    const m1 = { schemaVersion: 1, name: "c", steps: [{ name: "s", request: { method: "GET", url: "http://x" } }] };
    expect(ScenarioSchema.safeParse(m1).success).toBe(true); // M1-M4 sem noise seguem válidos
  });

  it("run_envelope_accepts_optional_noise", () => {
    expect(RunEnvelopeSchema.safeParse({ schemaVersion: 1, runId: "r1", createdAt: "x", noise: ["$.ts"], steps: [runStep] }).success).toBe(true);
    expect(RunEnvelopeSchema.safeParse({ schemaVersion: 1, runId: "r1", createdAt: "x", steps: [runStep] }).success).toBe(true);
  });

  it("build_run_envelope_carries_noise_when_given", () => {
    expect(buildRunEnvelope([runStep], { now: () => 0, newId: () => "r1" }, "c", undefined, ["$.ts"]).noise).toEqual(["$.ts"]);
    expect("noise" in buildRunEnvelope([runStep], { now: () => 0, newId: () => "r1" })).toBe(false);
  });

  it("run_scenario_propagates_noise_to_envelope", async () => {
    const base = await listen();
    const scenario = ScenarioSchema.parse({ schemaVersion: 1, name: "c", noise: ["$.timestamp"], steps: [{ name: "get", request: { method: "GET", url: `${base}/x` } }] });
    const env = await runScenario(scenario, { now: () => 0, newId: () => "r1" });
    expect(env.noise).toEqual(["$.timestamp"]);
  });
});
