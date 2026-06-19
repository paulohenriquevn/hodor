import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWebServer } from "./web/server.js";
import { buildRunEnvelope, persistRun, loadReviewArtifact, type RunStep } from "./core/index.js";

let server: Server | undefined;
let runsDir: string | undefined;
let verdictsDir: string | undefined;
let reviewsDir: string | undefined;

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "hodor-v1-"));
  verdictsDir = await mkdtemp(join(tmpdir(), "hodor-v1-v-"));
  reviewsDir = await mkdtemp(join(tmpdir(), "hodor-v1-r-"));
});
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
  for (const d of [runsDir, verdictsDir, reviewsDir]) if (d) await rm(d, { recursive: true, force: true });
  runsDir = verdictsDir = reviewsDir = undefined;
});

function start(): Promise<string> {
  server = buildWebServer(runsDir!, verdictsDir!, reviewsDir!);
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

// Mesmo cenário (request/response/assert idênticos) — só os VOLÁTEIS diferem entre runs.
function sameScenarioStep(date: string, durationMs: number): RunStep {
  return {
    request: { method: "GET", url: "http://api.test/x", headers: {} },
    response: {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json", date, etag: `e-${durationMs}` },
      body: '{"ok":true}',
      timings: { startedAt: "2026-06-19T00:00:00.000Z", durationMs },
    },
    asserts: [{ source: "status", op: "equals", value: 200, pass: true, expected: 200, actual: 200 }],
  };
}

const RUN_A = "00000000-0000-0000-0000-0000000000a1";
const RUN_B = "00000000-0000-0000-0000-0000000000b2";

describe("E2E V1 loop (M3 — persistência versionável)", () => {
  it("e2e_v1_loop_writes_committable_review_artifact", async () => {
    // 1. Dois runs do MESMO cenário, diferindo só em campos voláteis (date/timing/runId/createdAt).
    await persistRun(
      buildRunEnvelope([sameScenarioStep("Mon, 01 Jan 2026", 5)], { now: () => 0, newId: () => RUN_A }, "cenário-v1"),
      runsDir!,
    );
    await persistRun(
      buildRunEnvelope([sameScenarioStep("Tue, 02 Feb 2026", 999)], { now: () => 9_999, newId: () => RUN_B }, "cenário-v1"),
      runsDir!,
    );
    const base = await start();

    // 2. Humano registra verdict approved em cada (loop agente→execução→revisão→verdict).
    for (const id of [RUN_A, RUN_B]) {
      const res = await fetch(`${base}/runs/${id}/verdict`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "verdict=approved&note=revisado",
        redirect: "manual",
      });
      expect(res.status).toBe(303);
    }

    // 3. Cada artefato versionável existe, válido, com verdict embutido (DoD #2).
    const a = await loadReviewArtifact(RUN_A, reviewsDir!);
    const b = await loadReviewArtifact(RUN_B, reviewsDir!);
    expect(a?.verdict.verdict).toBe("approved");
    expect(b?.verdict.verdict).toBe("approved");

    // 4. Normalização estável (DoD #1): mesmos `steps` apesar dos voláteis diferentes.
    expect(a!.steps).toEqual(b!.steps);

    // 5. `reviews/` é COMMITÁVEL — não está no .gitignore do repo (DoD #1/#3).
    const gitignore = await readFile(join(process.cwd(), ".gitignore"), "utf8");
    const ignoresReviews = gitignore
      .split("\n")
      .some((line) => line.trim() === "reviews/" || line.trim() === "/reviews/");
    expect(ignoresReviews).toBe(false);
    // e `runs/` (bruto) permanece ignorado
    expect(gitignore.split("\n").some((l) => l.trim() === "runs/")).toBe(true);
  });
});
