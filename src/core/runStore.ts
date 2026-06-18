import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { RunEnvelopeSchema, type RunEnvelope, type RunStep } from "./runSchema.js";

export interface EnvelopeDeps {
  /** Clock injetável (ms). Default Date.now. */
  now?: () => number;
  /** Gerador de id injetável. Default crypto.randomUUID. */
  newId?: () => string;
}

/** Diretório de runs default (ADR/Q1): `runs/`, override por env `HODOR_RUNS_DIR`. */
export function defaultRunsDir(): string {
  return process.env.HODOR_RUNS_DIR ?? "runs";
}

/**
 * Monta o envelope N-step (ADR D3). M0 passa 1 step; M1 passará N.
 * Clock/id injetáveis tornam o resultado determinístico em teste (testing.md §6).
 * As chaves são construídas em ordem fixa (diff-amigável, semente de M3).
 */
export function buildRunEnvelope(steps: RunStep[], deps: EnvelopeDeps = {}): RunEnvelope {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  return {
    schemaVersion: 1,
    runId: newId(),
    createdAt: new Date(now()).toISOString(),
    steps,
  };
}

/** Grava o envelope em `${dir}/${runId}.json` e retorna o path absoluto-relativo. */
export async function persistRun(env: RunEnvelope, dir: string = defaultRunsDir()): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${env.runId}.json`);
  await writeFile(path, JSON.stringify(env, null, 2), "utf8");
  return path;
}

/**
 * Lê e VALIDA um run do disco (validação na fronteira, architecture.md §2).
 * Arquivo malformado/incompatível lança (ZodError) — fail-loud.
 */
export async function loadRun(path: string): Promise<RunEnvelope> {
  const raw = await readFile(path, "utf8");
  return RunEnvelopeSchema.parse(JSON.parse(raw));
}
