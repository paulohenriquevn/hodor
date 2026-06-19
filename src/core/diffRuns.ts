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

function diffStep(prev: NormalizedStep, curr: NormalizedStep, index: number, noise: string[]): StepDiff {
  const statusChanged = prev.response.status !== curr.response.status || prev.response.statusText !== curr.response.statusText;
  const headerDiffs = diffHeaders(prev.response.headers, curr.response.headers);
  const bodyChanged = normalizedBody(prev.response.body, noise) !== normalizedBody(curr.response.body, noise);
  return { stepIndex: index, statusChanged, headerDiffs, bodyChanged };
}

export function diffRuns(prev: RunEnvelope, curr: RunEnvelope): RunDiff {
  const noise = curr.noise ?? prev.noise ?? [];
  const a = normalizeRun(prev).steps;
  const b = normalizeRun(curr).steps;
  const stepCountChanged = a.length !== b.length;
  const n = Math.min(a.length, b.length);
  const steps: StepDiff[] = [];
  for (let i = 0; i < n; i++) {
    steps.push(diffStep(a[i]!, b[i]!, i, noise));
  }
  const hasRegression =
    stepCountChanged ||
    steps.some((s) => s.statusChanged || s.bodyChanged || s.headerDiffs.length > 0);
  return { steps, stepCountChanged, hasRegression };
}
