# Implementation Summary — m2-review-webapp

Date: 2026-06-18
Plan: knowledge-base/plans/m2-review-webapp-plan.md (v1.1, SHIPPABLE_WITH_CAVEATS 89)
Promise: **IMPLEMENTATION_COMPLETE**

## Resultado

Web app de review do M2 funcionando, server-rendered nativa (ZERO framework — risco #1):
`GET /` lista runs (cenário/data/steps/pass-fail/verdict); `GET /runs/:id` exibe req/resp/headers
por step + asserts (pass/fail evidente) + form de verdict; `POST /runs/:id/verdict` valida e
persiste o verdict humano em `verdicts/{runId}.json`. Render por content-type (`pickRenderer`) +
truncamento (risco #2). Métrica do Goal (`e2e_review_lists_renders_and_records_verdict`) verde.

## Validação (Final Phase)

| Gate | Resultado |
|---|---|
| `npx vitest run` | 87 testes, 17 arquivos — **PASS** |
| `npx tsc --noEmit` | 0 erros — **PASS** |
| `npm audit` | 0 vulnerabilidades (ZERO dep nova) — **PASS** |
| Coverage | verdict.ts 92.3% · render.ts 95.2% · all 96.37% — **PASS** (≥90%) |
| File size | máx 259 linhas (≤500) — **PASS** |
| Failure scenarios | verdict inválido/ausente 400 · run ausente 404 · traversal 400 · truncamento/binário — 4/4 |
| Backward-compat M0/M1 | run_request/run_scenario + render M0/M1 verdes; envelope `name` aditivo |

## Wiring triad por task

| Task | Caller (pillar a) | Integration test (pillar b) | Métrica/observável (pillar c) |
|---|---|---|---|
| T1.1 envelope name | runScenario passa scenario.name | runStore.test.ts | name no envelope |
| T1.2 verdict store | POST handler chama saveVerdict | verdict.test.ts (4) | verdict persistido (loadVerdict!=null) |
| T1.3 pickRenderer | bodyBlock usa pickRenderer/truncate | pickRenderer.test.ts (6) | n/a (puro) |
| T2.1 listing | GET / chama listRuns+loadRun+loadVerdict | server.test.ts (listing + corrompido) | listagem renderizada |
| T2.2 verdict POST | POST /runs/:id/verdict → saveVerdict (caller de produção) | server.test.ts (5 casos POST) | verdict gravado + 303 |
| T3.1 E2E | integra web+core | review-e2e.test.ts (1) | loadVerdict==approved no E2E |

## Edge cases / segurança honrados

- **EC-1** nota do verdict (input do humano) escapada no render — anti-XSS armazenado — testado.
- **EC-2** listagem tolera run corrompido (pula, não 500 a página toda) — testado.
- **EC-3** POST verdict inválido/ausente → 400 (zod na fronteira) — testado.
- **EC-4** sem CSRF → aceito/documentado (local single-user); follow-up se exposto a rede.
- EC-1 (M0) anti path-traversal reusado no path de verdict (400).
- Risco #1: ZERO framework/dep nova (server-rendered nativo). Risco #2: binário omitido + texto truncado (64KB).

## ADRs honrados
D1 (nativo, sem framework) · D2 (pickRenderer + truncate) · D3 (verdict store no core, validação zod) · D4 (envelope `name` aditivo, schemaVersion:1) · D5 (listagem GET /, verdict POST 303, pass/fail evidente).

## Backward-compatibility
- `buildRunEnvelope` ganhou 3º param `name?` opcional (callers M0/M1 intactos).
- `RunEnvelopeSchema.name?` opcional (runs M0/M1 sem name válidos).
- `renderRun(env, verdict?)` — verdict opcional (render M0/M1 intacto).

## Commits (develop)
`ec2928b` core (envelope name + verdict + pickRenderer) · `41e8b0f` web (listing + verdict POST) · `a3d7bd8` e2e + CHANGELOG.
