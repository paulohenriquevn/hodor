import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWebServer } from "./web/server.js";
import {
  saveDraft,
  loadDraft,
  runScenario,
  persistRun,
  loadReviewArtifact,
  type Scenario,
  type Provenance,
} from "./core/index.js";

let web: Server | undefined;
let target: Server | undefined;
let runsDir: string | undefined;
let verdictsDir: string | undefined;
let reviewsDir: string | undefined;
let draftsDir: string | undefined;

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "hodor-m4-"));
  verdictsDir = await mkdtemp(join(tmpdir(), "hodor-m4-v-"));
  reviewsDir = await mkdtemp(join(tmpdir(), "hodor-m4-r-"));
  draftsDir = await mkdtemp(join(tmpdir(), "hodor-m4-d-"));
});
afterEach(async () => {
  for (const s of [web, target]) if (s) await new Promise<void>((r) => s!.close(() => r()));
  web = target = undefined;
  for (const d of [runsDir, verdictsDir, reviewsDir, draftsDir]) if (d) await rm(d, { recursive: true, force: true });
  runsDir = verdictsDir = reviewsDir = draftsDir = undefined;
});

function listenTarget(): Promise<string> {
  target = createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end('{"ok":true}');
  });
  return new Promise((resolve) =>
    target!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(target!.address() as AddressInfo).port}`)),
  );
}
function startWeb(): Promise<string> {
  web = buildWebServer(runsDir!, verdictsDir!, reviewsDir!);
  return new Promise((resolve) =>
    web!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(web!.address() as AddressInfo).port}`)),
  );
}

const RUN_ID = "00000000-0000-0000-0000-0000000000c4";

describe("E2E M4 — geração assistida → revisão → verdict", () => {
  it("e2e_m4_agent_draft_flows_to_review_marked_pending", async () => {
    const base = await listenTarget();
    const prov: Provenance = {
      origin: "agent-generated",
      sourceKind: "curl",
      sourceRef: `curl ${base}/x`,
      generatedAt: "2026-06-19T00:00:00.000Z",
    };

    // 1. AGENTE gera e salva um draft (não-executado, não-aprovado).
    const scenario: Scenario = {
      schemaVersion: 1,
      name: "cenário-gerado",
      provenance: prov,
      steps: [{ name: "get", request: { method: "GET", url: `${base}/x` }, asserts: [{ source: "status", op: "lt", value: 500 }] }],
    };
    const { draftId } = await saveDraft(scenario, { dir: draftsDir! });
    // draft existe e é editável; nenhum review ainda (risco #1)
    expect((await loadDraft(draftId, draftsDir!))?.provenance.origin).toBe("agent-generated");
    await expect(access(join(reviewsDir!, `${RUN_ID}.json`))).rejects.toThrow();

    // 2. HUMANO executa o draft → run carrega a proveniência; web mostra "pendente".
    const env = await runScenario(scenario, { now: () => 0, newId: () => RUN_ID });
    expect(env.provenance?.origin).toBe("agent-generated");
    await persistRun(env, runsDir!);
    const webBase = await startWeb();
    const listing = await (await fetch(`${webBase}/`)).text();
    expect(listing).toContain("🤖 gerado");
    expect(listing).toContain("pendente");
    // antes do verdict NÃO existe artefato de review (risco #1 — nunca auto-aprova)
    expect(await loadReviewArtifact(RUN_ID, reviewsDir!)).toBeNull();

    // 3. HUMANO registra o verdict → artefato versionável carrega a proveniência.
    const res = await fetch(`${webBase}/runs/${RUN_ID}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "verdict=approved&note=revisado",
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    const artifact = await loadReviewArtifact(RUN_ID, reviewsDir!);
    expect(artifact?.verdict.verdict).toBe("approved");
    expect(artifact?.provenance?.origin).toBe("agent-generated"); // proveniência sobreviveu ao loop

    // 4. drafts/ e reviews/ commitáveis; runs/ e verdicts/ efêmeros (gitignore do repo).
    const gitignore = await readFile(join(process.cwd(), ".gitignore"), "utf8");
    const ignored = (p: string) => gitignore.split("\n").some((l) => l.trim() === p);
    expect(ignored("drafts/")).toBe(false);
    expect(ignored("reviews/")).toBe(false);
    expect(ignored("runs/")).toBe(true);
    expect(ignored("verdicts/")).toBe(true);
  });
});
