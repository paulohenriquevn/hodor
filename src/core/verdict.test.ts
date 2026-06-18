import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveVerdict, loadVerdict, type Verdict } from "./verdict.js";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "hodor-verdict-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const verdict: Verdict = {
  runId: "r1",
  verdict: "approved",
  note: "looks good",
  decidedAt: "2026-06-18T00:00:00.000Z",
};

describe("verdict store", () => {
  it("save_verdict_writes_file_named_by_run_id", async () => {
    const dir = await tmp();
    const path = await saveVerdict(verdict, dir);
    expect(path).toBe(join(dir, "r1.json"));
  });

  it("load_verdict_round_trips", async () => {
    const dir = await tmp();
    await saveVerdict(verdict, dir);
    expect(await loadVerdict("r1", dir)).toEqual(verdict);
  });

  it("load_verdict_returns_null_when_absent", async () => {
    const dir = await tmp();
    expect(await loadVerdict("nope", dir)).toBeNull();
  });

  it("save_verdict_rejects_invalid_verdict_value", async () => {
    const dir = await tmp();
    await expect(
      saveVerdict({ ...verdict, verdict: "maybe" as never }, dir),
    ).rejects.toBeTruthy();
  });
});
