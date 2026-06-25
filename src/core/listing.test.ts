import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildListing } from "./listing.js";
import { buildRunEnvelope, persistRun, saveVerdict, type RunStep } from "./index.js";

const okStep: RunStep = {
  request: { method: "GET", url: "http://127.0.0.1/ok", headers: {} },
  response: {
    status: 200,
    statusText: "OK",
    headers: {},
    body: "ok",
    timings: { startedAt: "2026-06-20T00:00:00.000Z", durationMs: 1 },
  },
  asserts: [{ source: "status", op: "equals", expected: 200, actual: 200, pass: true }],
};

const UUID1 = "00000000-0000-0000-0000-000000000001";
const UUID2 = "00000000-0000-0000-0000-000000000002";

let dir: string;
let vdir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hodor-listing-"));
  vdir = await mkdtemp(join(tmpdir(), "hodor-listing-v-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(vdir, { recursive: true, force: true });
});

describe("buildListing (M8 — extraído de web/server.listRuns)", () => {
  it("build_listing_returns_empty_when_dir_missing", async () => {
    expect(await buildListing(join(dir, "nope"), vdir)).toEqual([]);
  });

  it("build_listing_returns_items_newest_first", async () => {
    await persistRun(buildRunEnvelope([okStep], { now: () => 0, newId: () => UUID1 }, "a"), dir);
    await new Promise((r) => setTimeout(r, 5));
    await persistRun(buildRunEnvelope([okStep], { now: () => 0, newId: () => UUID2 }, "b"), dir);
    const items = await buildListing(dir, vdir);
    expect(items.map((i) => i.runId)).toEqual([UUID2, UUID1]); // mtime desc
    expect(items[0]!.name).toBe("b");
    expect(items[0]!.stepCount).toBe(1);
    expect(items[0]!.allAssertsPass).toBe(true);
    expect(items[0]!.verdict).toBeNull();
  });

  it("build_listing_marks_golden_when_approved", async () => {
    await persistRun(buildRunEnvelope([okStep], { now: () => 0, newId: () => UUID1 }, "c"), dir);
    await saveVerdict({ runId: UUID1, verdict: "approved", decidedAt: "2026-06-20T00:00:00.000Z" }, vdir);
    const items = await buildListing(dir, vdir);
    expect(items[0]!.isGolden).toBe(true);
    expect(items[0]!.verdict).toBe("approved");
  });

  it("build_listing_skips_corrupted_run", async () => {
    await persistRun(buildRunEnvelope([okStep], { now: () => 0, newId: () => UUID1 }, "ok"), dir);
    await writeFile(join(dir, `${UUID2}.json`), "{ not valid json", "utf8");
    const items = await buildListing(dir, vdir);
    expect(items.map((i) => i.runId)).toEqual([UUID1]); // corrompido pulado (EC-2)
  });
});
