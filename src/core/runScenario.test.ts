import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { runScenario } from "./runScenario.js";
import { RequestExecutionError, ScenarioError } from "./errors.js";
import type { Scenario } from "./scenarioSchema.js";

let server: Server | undefined;
afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  }
});

// Servidor alvo: POST /posts → 201 {"id":7}; GET /posts/7 → 200 {"ok":true}.
function listen(): Promise<string> {
  server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/posts") {
      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.end('{"id":7}');
      return;
    }
    if (req.method === "GET" && req.url === "/posts/7") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end('{"ok":true}');
      return;
    }
    res.statusCode = 404;
    res.end('{"error":"not found"}');
  });
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function twoStepScenario(base: string): Scenario {
  return {
    schemaVersion: 1,
    name: "create-then-fetch",
    steps: [
      {
        name: "create",
        request: { method: "POST", url: `${base}/posts`, body: "{}" },
        captures: { id: { jsonpath: "$.id" } },
        asserts: [{ source: "status", op: "equals", value: 201 }],
      },
      {
        name: "fetch",
        request: { method: "GET", url: `${base}/posts/${"${{ id }}"}` },
        asserts: [
          { source: "status", op: "equals", value: 200 },
          { source: "jsonpath:$.ok", op: "equals", value: true },
        ],
      },
    ],
  };
}

describe("runScenario", () => {
  it("run_scenario_executes_steps_in_order", async () => {
    const base = await listen();
    const env = await runScenario(twoStepScenario(base), { now: () => 0, newId: () => "s1" });
    expect(env.steps).toHaveLength(2);
    expect(env.steps[0]!.request.method).toBe("POST");
    expect(env.steps[1]!.request.method).toBe("GET");
  });

  it("run_scenario_propagates_captured_variable", async () => {
    const base = await listen();
    const env = await runScenario(twoStepScenario(base), { now: () => 0, newId: () => "s2" });
    // step1 capturou id=7; step2 usou ${{ id }} na URL
    expect(env.steps[0]!.captures).toEqual({ id: 7 });
    expect(env.steps[1]!.request.url).toBe(`${base}/posts/7`);
  });

  it("run_scenario_records_assert_pass_and_fail", async () => {
    const base = await listen();
    const scenario: Scenario = {
      schemaVersion: 1,
      name: "mixed-asserts",
      steps: [
        {
          name: "create",
          request: { method: "POST", url: `${base}/posts`, body: "{}" },
          asserts: [
            { source: "status", op: "equals", value: 201 }, // pass
            { source: "status", op: "equals", value: 500 }, // fail
          ],
        },
      ],
    };
    const env = await runScenario(scenario, { now: () => 0, newId: () => "s3" });
    const asserts = env.steps[0]!.asserts!;
    expect(asserts[0]!.pass).toBe(true);
    expect(asserts[1]!.pass).toBe(false);
    expect(asserts[1]!.actual).toBe(201);
  });

  it("run_scenario_aborts_on_network_error", async () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      name: "net-fail",
      steps: [{ name: "x", request: { method: "GET", url: "http://127.0.0.1:1/nope" } }],
    };
    await expect(runScenario(scenario)).rejects.toBeInstanceOf(RequestExecutionError);
  });

  it("run_scenario_aborts_on_undefined_variable", async () => {
    // Q2 via engine: step usa ${{ missing }} nunca capturada → ScenarioError ANTES do HTTP
    const base = await listen();
    const scenario: Scenario = {
      schemaVersion: 1,
      name: "bad-var",
      steps: [{ name: "x", request: { method: "GET", url: `${base}/posts/${"${{ missing }}"}` } }],
    };
    await expect(runScenario(scenario)).rejects.toBeInstanceOf(ScenarioError);
  });

  it("run_scenario_result_step_has_asserts_and_captures", async () => {
    const base = await listen();
    const env = await runScenario(twoStepScenario(base), { now: () => 0, newId: () => "s4" });
    expect(env.steps[0]!.captures).toBeDefined();
    expect(env.steps[1]!.asserts).toBeDefined();
    expect(env.steps[1]!.asserts!.every((a) => a.pass)).toBe(true);
  });
});
