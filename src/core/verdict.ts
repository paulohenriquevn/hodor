import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/**
 * Verdict humano sobre uma execução (ADR D3 do M2). É a tese central do Hodor:
 * revisão humana com decisão persistida. Guardado SEPARADO do run (não muta o
 * artefato bruto), preparando o versionamento de M3. Validação na fronteira (zod).
 */
export const VerdictSchema = z.object({
  runId: z.string().min(1),
  verdict: z.enum(["approved", "rejected"]),
  note: z.string().optional(),
  decidedAt: z.string(),
});

export type Verdict = z.infer<typeof VerdictSchema>;

/** Diretório de verdicts (default `verdicts/`, override por env `HODOR_VERDICTS_DIR`). */
export function defaultVerdictsDir(): string {
  return process.env.HODOR_VERDICTS_DIR ?? "verdicts";
}

/** Valida (fronteira) e grava o verdict em `${dir}/${runId}.json`. */
export async function saveVerdict(
  verdict: Verdict,
  dir: string = defaultVerdictsDir(),
): Promise<string> {
  const valid = VerdictSchema.parse(verdict);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${valid.runId}.json`);
  await writeFile(path, JSON.stringify(valid, null, 2), "utf8");
  return path;
}

/** Lê o verdict de um run; ausente → `null` (pendente). Arquivo inválido → lança. */
export async function loadVerdict(
  runId: string,
  dir: string = defaultVerdictsDir(),
): Promise<Verdict | null> {
  let raw: string;
  try {
    raw = await readFile(join(dir, `${runId}.json`), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return VerdictSchema.parse(JSON.parse(raw));
}
