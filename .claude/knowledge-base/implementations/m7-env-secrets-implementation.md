# Implementation Summary — m7-env-secrets

Date: 2026-06-20
Plan: knowledge-base/plans/m7-env-secrets-plan.md (v1.1, SHIPPABLE_WITH_CAVEATS 89)
Promise: **IMPLEMENTATION_COMPLETE**

## Resultado

Injeção de env/secrets no run time (remove o teto de auth do M6): `${{ env.NOME }}` resolve de env
vars allowlisted por prefixo `HODOR_SECRET_*` (process.env nunca exposto inteiro), executando contra
APIs autenticadas reais. O segredo NUNCA é persistido: `redactSecretValues` redige por VALOR
(longest-first, forma crua E `encodeURIComponent`) em todos os sinks, no choke point antes de todo
`persistRun` e no structuredContent. ZERO dep nova (reusa `interpolate` do M1; `process.env` stdlib).

## Validação (Final Phase)

| Gate | Resultado |
|---|---|
| `npx vitest run` | 238 testes, 38 arquivos — **PASS** |
| `npx tsc --noEmit` | 0 erros — **PASS** |
| `npm audit` | 0 vulnerabilidades (ZERO dep nova) — **PASS** |
| Coverage core | redactSecrets 100% lines; runScenario/checkScenario ≥96% — **PASS** |
| Segredo (raw+encoded) ausente em runs/+reviews/ | E2E assere — **PASS** |
| core não lê SEGREDO de process.env (via deps) | runScenario lê `deps.secrets` (DIP/D1) — **PASS** |
| Backward-compat M0-M6 | tools/rotas verdes |

## Wiring triad por task

| Task | Caller (pillar a) | Integration test (pillar b) | Observável (pillar c) |
|---|---|---|---|
| T1.1 secrets em deps | mcp run_scenario/check_scenario | runScenario.test.ts (2) | env.* resolvido |
| T1.2 redactSecretValues | checkScenario + mcp choke point + E2E | redactSecrets.test.ts (7) | `<redacted>` |
| T1.3 checkScenario redige | tool check_scenario + replaySuite | checkScenario.test.ts (1) | run redigido |
| T2.1 resolveHodorSecrets + wire | run_scenario/check_scenario/replay_suite | mcp/secrets.test.ts (6) | run não vaza |
| T3.1 E2E | integra core+mcp | m7-e2e.test.ts (2) | loop autenticado |

## DoD do ROADMAP §M7 (validado)

| DoD | Evidência |
|---|---|
| #1 `${{ env.NOME }}` resolve no run time | `secrets` em deps + namespace `env.*` + `resolveHodorSecrets`; E2E: 401→200 com token |
| #2 segredo NUNCA persistido em runs/reviews/drafts | `redactSecretValues` no choke point; E2E assere ausência (raw+encoded) em run e review; drafts são template |
| #3 E2E auth via env contra endpoint real passa | servidor exige Bearer; cenário com `${{ env.TOKEN }}` → 200 |

## Edge cases absorvidos (3 MUST-FIX + EC-4/5/6)

- **EC-1** (MUST-FIX, o achado central): a redação cobre TAMBÉM a forma `encodeURIComponent` — o `interpolateRequest` encoda o valor na URL, então o segredo é persistido encodado; sem isso vazaria encodado.
- **EC-2** (MUST-FIX): o E2E usa um 2º segredo com chars especiais (`a/b+c=d`) em query+body, asserindo ausência das formas crua E encodada — sem isso o E2E daria falsa confiança.
- **EC-3** (MUST-FIX): redação no CHOKE POINT único (antes de todo `persistRun` no adaptador), não em deps opcional — mesmo replaySuite→checkScenario não persiste token vivo.
- **EC-4/5/6**: `resolveHodorSecrets` ignora secret < 4 chars (over-redaction), vazio e sem-sufixo.

## Segurança (milestone de segurança)

- **Allowlist por prefixo** `HODOR_SECRET_*` — cenário não exfiltra env var arbitrário (mitiga SSRF+secrets do M6); `process.env` nunca exposto inteiro (anti-pattern do bruno rejeitado).
- **Redação por valor** complementa a por-nome do M3 (cobre header não-sensível/body/url + encodado).
- **stderr limpo** — logs do MCP só registram nomes/contagens/ids, nunca valores.

## Backward-compatibility
- `RunScenarioDeps.secrets?` opcional ao final — callers M1-M6 sem secret intactos.
- `interpolate` reusado sem mudança; tools M0-M6 e rotas M2-M6 inalteradas.

## Commits (develop)
`e5b7c04` core injeção+redação (T1.1-T1.3) · `8db4253` mcp resolve+choke point (T2.1) · `560f00b` E2E+CHANGELOG (T3.1).
