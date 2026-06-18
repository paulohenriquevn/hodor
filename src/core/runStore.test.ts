import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRunEnvelope, persistRun, loadRun } from "./runStore.js";
import { RunEnvelopeSchema, type RunStep } from "./runSchema.js";

const step: RunStep = {
  request: { method: "GET", url: "http://127.0.0.1:8080/ok", headers: {} },
  response: {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "text/plain" },
    body: "hi",
    timings: { startedAt: "2026-06-18T00:00:00.000Z", durationMs: 3 },
  },
};

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "hodor-runstore-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("runStore — M2 envelope name", () => {
  it("build_run_envelope_includes_name_when_provided", () => {
    const env = buildRunEnvelope([step], { now: () => 0, newId: () => "n1" }, "meu-cenário");
    expect(env.name).toBe("meu-cenário");
  });

  it("build_run_envelope_omits_name_when_absent", () => {
    const env = buildRunEnvelope([step], { now: () => 0, newId: () => "n2" });
    expect("name" in env).toBe(false);
    expect(RunEnvelopeSchema.safeParse(env).success).toBe(true);
  });
});

describe("runStore", () => {
  it("build_run_envelope_uses_injected_clock_and_id", () => {
    const env = buildRunEnvelope([step], {
      now: () => 0,
      newId: () => "fixed-id",
    });
    expect(env.schemaVersion).toBe(1);
    expect(env.runId).toBe("fixed-id");
    expect(env.createdAt).toBe("1970-01-01T00:00:00.000Z");
    expect(env.steps).toHaveLength(1);
  });

  it("persist_run_writes_file_named_by_run_id", async () => {
    const dir = await tmp();
    const env = buildRunEnvelope([step], { now: () => 0, newId: () => "abc-123" });
    const path = await persistRun(env, dir);
    expect(path).toBe(join(dir, "abc-123.json"));
    const back = await loadRun(path);
    expect(back.runId).toBe("abc-123");
  });

  it("load_run_round_trips_persisted_envelope", async () => {
    const dir = await tmp();
    const env = buildRunEnvelope([step], { now: () => 1718668800000, newId: () => "rt-1" });
    const path = await persistRun(env, dir);
    const back = await loadRun(path);
    expect(back).toEqual(env);
  });

  it("load_run_rejects_invalid_file", async () => {
    const dir = await tmp();
    const bad = join(dir, "bad.json");
    await writeFile(bad, JSON.stringify({ schemaVersion: 2, runId: "x", createdAt: "n", steps: [] }));
    await expect(loadRun(bad)).rejects.toBeTruthy();
  });
});
