# Review: m0-walking-skeleton

**Date:** 2026-06-18
**Reviewers (spawned agents):** 7 — architecture, tests, wiring, cross-validation, domain-api-design, domain-security, domain-concurrency
**Plan:** knowledge-base/plans/m0-walking-skeleton-plan.md (v1.1, SHIPPABLE 98)
**Code-quality gate:** PASS_WITH_CAVEATS (entra no review)
**Verdict:** **READY_TO_MERGE**

## Findings (consolidado)

Inicial: BLOCKER 0 · HIGH 3 · MEDIUM ~5 · LOW ~12 · INFO ~12.
Após correções (commit `2f88936`): **BLOCKER 0 · HIGH 0** · MEDIUM 4 (aceitos/diferidos) · LOW/INFO documentados.

### HIGH resolvidos antes do merge

| ID | Achado | Correção (commit `2f88936`) |
|---|---|---|
| F-dom-1 | tool `run_request` sem `outputSchema` → structuredContent sem contrato/validação na fronteira MCP | `outputSchema: RunEnvelopeSchema.shape` adicionado; SDK publica em `tools/list` e valida |
| F-wire-1 | DoD "Runtime-metric proof" afirmava E2E exercitar a métrica, mas o E2E não referenciava `getRunCount` | E2E agora assere `getRunCount() == before+1` |
| F-tests-1 | `GET /` → 302 ao run mais recente sem teste (toda `latestRunId` sem cobertura comportamental) | teste `web_server_root_redirects_to_latest_run` (persiste 2 runs, valida location) |

### MEDIUM (aceitos como caveat / diferidos para M1)

| ID | Achado | Decisão |
|---|---|---|
| F-arch-3 / F-tests-4 | `durationMs` usa `performance.now()` não injetável; asserção de timing fraca (`>=0`); `now` injetável nunca usado em teste | Aceito M0: schema só exige `>=0`; determinismo de `startedAt` existe. Tornar `durationMs` injetável é melhoria de testabilidade para M1. |
| F-wire-2 | `getRunCount()` é export write-only (sem reader de produção; sem endpoint de métricas) | Aceito M0: o log estruturado em stderr (D5) cobre a observabilidade; o contador será consumido por health/metrics em milestone futuro. |
| F-tests-2 | branches "binary omitted" e "(empty body)" do render sem teste | Aceito M0: tratamento binário completo é escopo declarado de M2. |
| F-dom-2 | 405 sem header `Allow` (RFC 9110 MUST) | **Corrigido** (`Allow: GET` + teste) — promovido de caveat para fix. |

### LOW / INFO (notas; não bloqueiam)

- Segurança: path-traversal (EC-1) verificado seguro empiricamente (allowlist UUID antes do `join`); XSS — todos os 14 `${}` do render escapados; SSRF documentado/aceito (EC-4); 500 reflete `err.message` (F-sec-5 — endurecer mensagem genérica em M1).
- Concorrência (latentes, fora do escopo M0 single-thread, rastrear em M1): `writeFile` não-atômico → torn-read sob escrita concorrente (sugestão tmp+rename); `await response.text()` fora do escopo do timeout do AbortController.
- Cosméticos: checkboxes do plano em `[ ]` apesar de cumpridos (F-xval-3); `src/web/server.test.ts` é scope-creep benéfico (F-xval-1); casing de arquivo camelCase segue o plano (F-arch-12).

## Cross-validation (plano vs implementação)

| Métrica | Resultado |
|---|---|
| Tasks do plano | 8 (T0.1–T4.1) |
| FULLY implementadas | 8/8 |
| PARTIAL / MISSING / DIVERGED | 0 |
| Coverage Matrix | 7/7 gaps resolvidos em código real |
| ADRs D1–D5 | 5/5 respeitados (grep + versão confirmados) |
| Plan drift | nenhum (plano congelado antes do 1º commit de impl) |
| Goal (`e2e_run_request_persists_and_renders`) | verde — loop genuíno, não stub |

## Edge-case coverage

- EC-1 path-traversal: coberto (teste 400 + verificação empírica de bypasses).
- EC-2 GET-com-body: coberto. EC-3 Set-Cookie repetido: coberto. EC-4 SSRF: documentado/aceito.
- Failure scenarios (5xx capturado / connection-refused / timeout): 3/3 cobertos.

## Quality gates (re-validação, thresholds estritos)

| Gate | Resultado |
|---|---|
| `npx vitest run` | 27/27 — **PASS** |
| `npx tsc --noEmit` | 0 erros — **PASS** |
| Coverage core | 100% (global 98.3%) — **PASS** |
| Lint (tsc strict) | 0 — **PASS** |
| `npm audit` | 0 vulnerabilidades — **PASS** |
| Wiring triad | pillar (a) 7/7 caller de produção · (b) 8/8 integração · (c) métrica exercitada no E2E (pós-fix) |
| Fronteira DIP (D2) | core não importa mcp/web/SDK — **PASS** |

## Spawned agents (audit trail)

- .claude/agents/review-m0-walking-skeleton-2026-06-18/architecture.md
- .claude/agents/review-m0-walking-skeleton-2026-06-18/tests.md
- .claude/agents/review-m0-walking-skeleton-2026-06-18/wiring.md
- .claude/agents/review-m0-walking-skeleton-2026-06-18/cross-validation.md
- .claude/agents/review-m0-walking-skeleton-2026-06-18/domain-api-design.md
- .claude/agents/review-m0-walking-skeleton-2026-06-18/domain-security.md
- .claude/agents/review-m0-walking-skeleton-2026-06-18/domain-concurrency.md
- (findings YAML em .../findings/)

## Handoff decision

**READY_TO_MERGE** — 0 BLOCKER, 0 HIGH (os 3 HIGH foram corrigidos antes do merge). MEDIUM/LOW restantes são caveats explícitos aceitos para o escopo M0 ou diferidos para M1, documentados acima. Próximo passo: `/release` (corte develop→main, gate de aprovação humana — Unbreakable Rule 4).
