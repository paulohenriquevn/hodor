# Review: m7-env-secrets

**Date:** 2026-06-20
**Reviewers (spawned agents):** 6 — domain-security, architecture, tests, wiring, cross-validation, domain-api-design
**Findings:** 24 total (BLOCKER: 2, HIGH: 5, MEDIUM/LOW: vários) — TODOS resolvidos antes do merge
**Verdict:** READY_TO_MERGE (após corrigir os 2 BLOCKER + 5 HIGH; re-validado)

## Pré-condições

- `/code-quality` (re-audit pós-fixes): **PASS_WITH_CAVEATS** (0 HARD).
- Branch `develop`, árvore limpa, 245 testes verdes, `tsc` limpo, `npm audit` 0 vulns, ZERO dep nova.
- Milestone de SEGURANÇA — review adversarial focado em vazamento.

## BLOCKER findings — RESOLVIDOS

### F-xval-1 (cross-val/tests): `response.statusText` não redigido — RESOLVIDO
- Segredo ecoado no reason phrase HTTP é persistido em `runs/` E copiado para o artefato de review **commitável**. Provado por probes. **Resolução:** `redactSecretValues` redige `response.statusText`. Teste `redact_secret_values_scrubs_statustext`.

### F-xval-5 (cross-val): árvore vermelha por probes órfãos — RESOLVIDO
- Os arquivos de probe adversarial (`_probe_sec*.test.ts`) ficaram untracked deixando `vitest run` com 7 falhas. **Resolução:** removidos; os casos legítimos viraram testes de regressão commitados.

## HIGH findings — RESOLVIDOS

### WIRE-1 (wiring): o sink esquecido — error path — RESOLVIDO
- `executeRequest` embute a URL interpolada (segredo `encodeURIComponent`) na mensagem de `RequestExecutionError`; `runScenario` era awaited sem try/catch → alvo caído (o caso realista do gate) vazava o segredo ao agente/stderr. **Resolução:** `scrubSecretsFromText` redige a mensagem de erro em `run_scenario`/`check_scenario` (via `withSecretScrub`) e em `replaySuite`. E2E `e2e_m7_network_error_message_redacts_secret_in_url`.

### F-xval-2 / TESTS-MEDIUM: `name` + JSON-escaped — RESOLVIDO
- `name` do cenário não redigido; segredo com aspas em body JSON-escaped reconstruía no `JSON.parse`. **Resolução:** `redactSecretValues` redige `name` + adiciona a variante JSON-escaped (`JSON.stringify(v).slice(1,-1)`) e `encodeURI` defensivo. Testes dedicados.

### API-DOM-1 (domain-api): drop silencioso de secret — RESOLVIDO
- Secret curto/vazio/sem-sufixo era descartado silenciosamente → erro genérico "undefined variable" 3 camadas adiante (fail-silent, CLAUDE.md §8). **Resolução:** `resolveHodorSecrets` loga em stderr `{event: secret_dropped, name, reason}` (NOME, nunca valor). Teste `resolve_hodor_secrets_logs_dropped_short_secret`.

## MEDIUM/LOW (resolvidos/documentados)

| ID | Finding | Decisão |
|---|---|---|
| API-DOM-2/3 | convenção `HODOR_SECRET_` não documentada / atrito de rename | seção "Segredos / APIs autenticadas" no README |
| API-DOM-4 | `${{ env.X.Y }}` aninhado cai no erro genérico | aceito (erro explícito; aninhamento é YAGNI) |
| arch LOW | redação em 2 portas (adapter + checkScenario) | JSDoc-contrato; ambos os callers redigem |

## Avaliação positiva dos agentes

- **Architecture:** DIP limpo (core nunca lê SEGREDO de env; `resolveHodorSecrets` no adaptador); `redactSecretValues` puro; choke point correto.
- **Cross-validation:** allowlist por prefixo correta; teto de auth do M6 **realmente removido** (E2E 401→200 via env); 3 MUST-FIX (EC-1/2/3) implementados de verdade.
- **Tests:** o E2E prova ausência por GREP do arquivo inteiro (raw E encodado) no run E no review.

## DoD do ROADMAP §M7 — SATISFEITO (pós-fix)

| DoD | Evidência |
|---|---|
| #1 `${{ env.NOME }}` resolve no run time | `secrets` em deps + `resolveHodorSecrets`; E2E 401→200 |
| #2 segredo NUNCA persistido em runs/reviews/drafts | redação por valor em TODOS os sinks (incl. statusText/name/error-path/encodings); E2E grep nega raw+encoded |
| #3 E2E auth via env contra endpoint real passa | servidor exige Bearer; cenário com `${{ env.TOKEN }}` → 200 |

## Quality gates summary

- npm test: PASS (245 testes, 38 arquivos)
- tsc --noEmit: PASS · npm audit: PASS (0 vulns, ZERO dep nova)
- Coverage core: redactSecrets 100% lines · secrets/runScenario/checkScenario ≥96%
- code-quality: PASS_WITH_CAVEATS (0 HARD)

## Spawned agents (audit trail)

`.claude/agents/review-m7-env-secrets-2026-06-20/` (+ findings/*.yaml). Nota: 1 dos 6 agentes (domain-security original) foi rate-limited; os demais 5 cobriram segurança a fundo (cross-validation + tests + wiring provaram os vazamentos empiricamente com probes), então a cobertura de segurança foi alcançada.

## Handoff decision

**READY_TO_MERGE.** Os 2 BLOCKER (statusText leak; árvore vermelha) e 5 HIGH (error-path leak, name/JSON-escaped, drop silencioso) foram corrigidos com código+teste e re-validados. O review adversarial de segurança fez seu trabalho: encontrou vazamentos reais (statusText e error-path eram falhas concretas que o E2E original não exercitava). M7 remove o teto de auth do M6 sem vazar segredo. Próximo passo (humano): `/release` (release sozinho — lição do v0.6.0).
