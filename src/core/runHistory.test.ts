import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scenarioKey, findPreviousRun, pruneRunHistory } from "./runHistory.js";
import { buildRunEnvelope, persistRun } from "./runStore.js";
import { saveVerdict } from "./verdict.js";
import type { RunEnvelope, RunStep } from "./runSchema.js";

const step: RunStep = {
  request: { method: "GET", url: "http://api.test/x", headers: {} },
  response: { status: 200, statusText: "OK", headers: {}, body: "ok", timings: { startedAt: "2026-06-19T00:00:00.000Z", durationMs: 1 } },
};

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "hodor-hist-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function mkEnv(over: Partial<RunEnvelope> = {}): RunEnvelope {
  return { schemaVersion: 1, runId: "r", createdAt: "2026-06-19T00:00:00.000Z", name: "cenário-a", steps: [step], ...over };
}

describe("scenarioKey", () => {
  it("scenario_key_uses_name_when_present", () => {
    expect(scenarioKey(mkEnv({ name: "x" }))).toBe("x");
  });

  it("scenario_key_falls_back_to_request_hash", () => {
    const a = mkEnv({ name: undefined, steps: [step] });
    const b = mkEnv({ name: undefined, steps: [step] });
    const c = mkEnv({ name: undefined, steps: [{ ...step, request: { ...step.request, url: "http://api.test/OTHER", headers: {} } }] });
    expect(scenarioKey(a)).toBe(scenarioKey(b)); // mesmo cenário → mesma key
    expect(scenarioKey(a)).not.toBe(scenarioKey(c)); // cenário diferente → key diferente
    expect(scenarioKey(a)).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
});

describe("findPreviousRun", () => {
  it("find_previous_run_returns_immediately_prior_same_scenario", async () => {
    const dir = await tmp();
    const t1 = mkEnv({ runId: "a1", createdAt: "2026-06-19T00:00:01.000Z" });
    const t2 = mkEnv({ runId: "a2", createdAt: "2026-06-19T00:00:02.000Z" });
    const other = mkEnv({ runId: "b1", name: "cenário-B", createdAt: "2026-06-19T00:00:01.500Z" });
    const t3 = mkEnv({ runId: "a3", createdAt: "2026-06-19T00:00:03.000Z" });
    for (const e of [t1, t2, other, t3]) await persistRun(e, dir);
    const prev = await findPreviousRun(t3, dir);
    expect(prev?.runId).toBe("a2"); // ignora o cenário B no meio
  });

  it("find_previous_run_null_for_first_run", async () => {
    const dir = await tmp();
    const only = mkEnv({ runId: "a1" });
    await persistRun(only, dir);
    expect(await findPreviousRun(only, dir)).toBeNull();
  });

  it("find_previous_run_breaks_createdAt_tie_deterministically", async () => {
    // EC-3: dois runs com createdAt idêntico → ordem total (createdAt, runId)
    const dir = await tmp();
    const a1 = mkEnv({ runId: "a1", createdAt: "2026-06-19T00:00:01.000Z" });
    const a2 = mkEnv({ runId: "a2", createdAt: "2026-06-19T00:00:01.000Z" });
    const a3 = mkEnv({ runId: "a3", createdAt: "2026-06-19T00:00:01.000Z" });
    for (const e of [a1, a2, a3]) await persistRun(e, dir);
    expect((await findPreviousRun(a3, dir))?.runId).toBe("a2"); // a2 < a3 por runId
    expect((await findPreviousRun(a2, dir))?.runId).toBe("a1");
    expect(await findPreviousRun(a1, dir)).toBeNull();
  });
});

describe("pruneRunHistory", () => {
  it("prune_run_history_keeps_last_n_per_scenario", async () => {
    const dir = await tmp();
    for (let i = 1; i <= 5; i++) await persistRun(mkEnv({ runId: `a${i}`, createdAt: `2026-06-19T00:00:0${i}.000Z` }), dir);
    await persistRun(mkEnv({ runId: "b1", name: "cenário-B" }), dir);
    await pruneRunHistory("cenário-a", dir, 2, await tmp());
    const { readdir } = await import("node:fs/promises");
    const left = (await readdir(dir)).map((f) => f.replace(".json", "")).sort();
    expect(left).toContain("a4");
    expect(left).toContain("a5");
    expect(left).toContain("b1"); // cenário raro não é expulso
    expect(left).not.toContain("a1");
  });

  it("prune_run_history_never_deletes_approved_run", async () => {
    // EC-1: run com verdict é PINNED (audit-trail-rotation: approved never rotates)
    const dir = await tmp();
    const vdir = await tmp();
    for (let i = 1; i <= 4; i++) await persistRun(mkEnv({ runId: `a${i}`, createdAt: `2026-06-19T00:00:0${i}.000Z` }), dir);
    await saveVerdict({ runId: "a1", verdict: "approved", decidedAt: "2026-06-19T00:00:00.000Z" }, vdir);
    await pruneRunHistory("cenário-a", dir, 2, vdir);
    const { readdir } = await import("node:fs/promises");
    const left = (await readdir(dir)).map((f) => f.replace(".json", ""));
    expect(left).toContain("a1"); // aprovado pinado, não removido
    expect(left).toContain("a4"); // recente mantido
  });

  it("prune_run_history_clamps_nonpositive_limit", async () => {
    // EC-2: limit 0/negativo/NaN não apaga o run recém-persistido
    const dir = await tmp();
    const vdir = await tmp();
    await persistRun(mkEnv({ runId: "a1" }), dir);
    await pruneRunHistory("cenário-a", dir, 0, vdir);
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(dir)).length).toBeGreaterThanOrEqual(1);
  });

  it("prune_run_history_tolerates_corrupt_file", async () => {
    const dir = await tmp();
    const vdir = await tmp();
    for (let i = 1; i <= 3; i++) await persistRun(mkEnv({ runId: `a${i}`, createdAt: `2026-06-19T00:00:0${i}.000Z` }), dir);
    await writeFile(join(dir, "corrupt.json"), "{ broken", "utf8");
    await expect(pruneRunHistory("cenário-a", dir, 1, vdir)).resolves.toBeUndefined();
  });
});
