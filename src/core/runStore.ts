import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { RunEnvelopeSchema, type RunEnvelope, type RunStep } from "./runSchema.js";
import type { Provenance } from "./provenance.js";

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
export function buildRunEnvelope(
  steps: RunStep[],
  deps: EnvelopeDeps = {},
  name?: string,
  provenance?: Provenance,
  noise?: string[],
): RunEnvelope {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  return {
    schemaVersion: 1,
    runId: newId(),
    createdAt: new Date(now()).toISOString(),
    // M2 (D4): inclui name só quando fornecido (run_request do M0 não tem cenário).
    ...(name !== undefined ? { name } : {}),
    // M4 (D2): propaga proveniência do cenário quando fornecida (aditivo).
    ...(provenance !== undefined ? { provenance } : {}),
    // M5 (D1): propaga regras de noise do cenário quando fornecidas (aditivo).
    ...(noise !== undefined ? { noise } : {}),
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
