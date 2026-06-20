/**
 * Resolução de segredos injetáveis (M7, ADR D1/D2). Lê APENAS env vars com o
 * prefixo `HODOR_SECRET_` (allowlist por construção — NUNCA expõe `process.env`
 * inteiro, que permitiria a um cenário exfiltrar segredos arbitrários via
 * `${{ env.AWS_SECRET }}` numa URL maliciosa). O prefixo é removido na exposição:
 * `HODOR_SECRET_TOKEN` → injetável como `${{ env.TOKEN }}`.
 *
 * Função PURA (recebe um env-like) — o core nunca lê `process.env` (DIP/D1).
 */
const PREFIX = "HODOR_SECRET_";
/** EC-4: valores muito curtos NÃO são injetáveis — redigir um valor de 1-3 chars
 * por VALOR destruiria toda ocorrência dele no run (over-redaction). Um token real
 * não tem < 4 chars; usar `${{ env.X }}` de um secret curto então dá ScenarioError. */
const MIN_SECRET_LEN = 4;

export function resolveHodorSecrets(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(PREFIX)) continue;
    const name = key.slice(PREFIX.length);
    // API-DOM-1: drop NÃO é silencioso — loga o NOME + motivo (NUNCA o valor) em stderr,
    // senão um secret curto/vazio vira um "undefined variable" genérico 3 camadas adiante.
    if (name === "") {
      console.error(JSON.stringify({ event: "secret_dropped", reason: "empty_suffix" }));
      continue; // EC-6
    }
    if (value === undefined || value === "") {
      console.error(JSON.stringify({ event: "secret_dropped", name, reason: "empty_value" }));
      continue; // EC-5
    }
    if (value.length < MIN_SECRET_LEN) {
      console.error(JSON.stringify({ event: "secret_dropped", name, reason: `too_short (< ${MIN_SECRET_LEN})` }));
      continue; // EC-4
    }
    out[name] = value;
  }
  return out;
}
