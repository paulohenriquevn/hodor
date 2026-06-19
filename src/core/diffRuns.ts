import type { RunEnvelope } from "./runSchema.js";
import { normalizeRun, type NormalizedStep } from "./normalizeRun.js";
import { maskNoise } from "./maskNoise.js";
import { stableStringify } from "./stableStringify.js";

/**
 * Motor de regressão (M5, ADR D3). Compara dois runs do MESMO cenário APÓS
 * normalização: headers/timings via `normalizeRun` (reuso M3) + body via `maskNoise`
 * (paths de noise do cenário). O core diz O QUE mudou (status/headers/body por step);
 * a web pinta. Puro, sem I/O, determinístico. Anti-flaky: voláteis e noise suprimidos.
 */

export interface HeaderDiff {
  key: string;
  prev: string | null;
  curr: string | null;
}

export interface StepDiff {
  stepIndex: number;
  statusChanged: boolean;
  headerDiffs: HeaderDiff[];
  bodyChanged: boolean;
}

export interface RunDiff {
  steps: StepDiff[];
  stepCountChanged: boolean;
  /** F-dom-1: as regras de noise diferem entre os runs comparados (revisar com atenção). */
  noiseChanged: boolean;
  hasRegression: boolean;
}

/** Normaliza um body p/ comparação: mascara noise e ordena chaves (order-insensitive). */
function normalizedBody(body: string, noise: string[]): string {
  const masked = maskNoise(body, noise);
  try {
    return stableStringify(JSON.parse(masked));
  } catch {
    return masked; // body não-JSON: compara texto cru já mascarado
  }
}

function diffHeaders(prev: Record<string, string>, curr: Record<string, string>): HeaderDiff[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
  const diffs: HeaderDiff[] = [];
  for (const key of keys) {
    const p = prev[key] ?? null;
    const c = curr[key] ?? null;
    if (p !== c) diffs.push({ key, prev: p, curr: c });
  }
  return diffs;
}

function diffStep(prev: NormalizedStep, curr: NormalizedStep, index: number, prevNoise: string[], currNoise: string[]): StepDiff {
  const statusChanged = prev.response.status !== curr.response.status || prev.response.statusText !== curr.response.statusText;
  const headerDiffs = diffHeaders(prev.response.headers, curr.response.headers);
  // F-dom-1: cada lado é mascarado com o SEU próprio noise. Se o noise foi alterado
  // entre os runs, o campo aparece como mudança (SURFACE) em vez de ser escondido nos
  // dois lados — não escondemos uma regressão real só porque o noise mudou (risco #1).
  const bodyChanged = normalizedBody(prev.response.body, prevNoise) !== normalizedBody(curr.response.body, currNoise);
  return { stepIndex: index, statusChanged, headerDiffs, bodyChanged };
}

function sameNoise(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function diffRuns(prev: RunEnvelope, curr: RunEnvelope): RunDiff {
  const prevNoise = prev.noise ?? [];
  const currNoise = curr.noise ?? [];
  const noiseChanged = !sameNoise(prevNoise, currNoise);
  const a = normalizeRun(prev).steps;
  const b = normalizeRun(curr).steps;
  const stepCountChanged = a.length !== b.length;
  const n = Math.min(a.length, b.length);
  const steps: StepDiff[] = [];
  for (let i = 0; i < n; i++) {
    steps.push(diffStep(a[i]!, b[i]!, i, prevNoise, currNoise));
  }
  const hasRegression =
    stepCountChanged ||
    steps.some((s) => s.statusChanged || s.bodyChanged || s.headerDiffs.length > 0);
  return { steps, stepCountChanged, noiseChanged, hasRegression };
}
