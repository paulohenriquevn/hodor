import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReviewArtifact,
  saveReviewArtifact,
  loadReviewArtifact,
  ReviewArtifactSchema,
} from "./reviewArtifact.js";
import type { RunEnvelope, RunStep } from "./runSchema.js";
import type { Verdict } from "./verdict.js";

const step: RunStep = {
  request: { method: "GET", url: "http://api.test/x", headers: {} },
  response: {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json", date: "Mon, 01 Jan" },
    body: '{"ok":true}',
    timings: { startedAt: "2026-06-19T00:00:00.000Z", durationMs: 5 },
  },
};
const env: RunEnvelope = { schemaVersion: 1, runId: "r1", createdAt: "2026-06-19T00:00:00.000Z", name: "cen", steps: [step] };
const verdict: Verdict = { runId: "r1", verdict: "approved", note: "ok", decidedAt: "2026-06-19T00:00:00.000Z" };

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "hodor-review-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("reviewArtifact", () => {
  it("build_review_artifact_embeds_verdict_and_normalized_steps", () => {
    const a = buildReviewArtifact(env, verdict);
    expect(a.artifactVersion).toBe(1);
    expect(a.verdict.verdict).toBe("approved");
    expect("timings" in a.steps[0]!.response).toBe(false);
    expect(a.steps[0]!.response.headers["date"]).toBeUndefined();
    expect(a.scenarioName).toBe("cen");
  });

  it("save_review_artifact_writes_stable_bytes", async () => {
    const dir = await tmp();
    const a = buildReviewArtifact(env, verdict);
    const { readFile } = await import("node:fs/promises");
    await saveReviewArtifact(a, dir);
    const first = await readFile(join(dir, "r1.json"), "utf8");
    await saveReviewArtifact(a, dir);
    const second = await readFile(join(dir, "r1.json"), "utf8");
    expect(first).toBe(second); // byte-idêntico
    expect(first.indexOf('"artifactVersion"')).toBeLessThan(first.indexOf('"verdict"')); // chaves ordenadas
  });

  it("load_review_artifact_round_trips", async () => {
    const dir = await tmp();
    const a = buildReviewArtifact(env, verdict);
    await saveReviewArtifact(a, dir);
    expect(await loadReviewArtifact("r1", dir)).toEqual(a);
  });

  it("review_artifact_rejects_wrong_version", () => {
    const bad = { artifactVersion: 2, runId: "r1", createdAt: "x", verdict, steps: [] };
    expect(ReviewArtifactSchema.safeParse(bad).success).toBe(false);
  });

  it("load_review_artifact_returns_null_when_absent", async () => {
    const dir = await tmp();
    expect(await loadReviewArtifact("nope", dir)).toBeNull();
  });
});
