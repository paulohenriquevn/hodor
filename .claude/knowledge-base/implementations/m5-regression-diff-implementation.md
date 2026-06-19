# Implementation Summary — m5-regression-diff

Date: 2026-06-19
Plan: knowledge-base/plans/m5-regression-diff-plan.md (v1.1, SHIPPABLE_WITH_CAVEATS 89)
Promise: **IMPLEMENTATION_COMPLETE**

## Resultado

Motor de regressão do M5: `diffRuns(prev, curr)` compara o run atual com o anterior do mesmo cenário
após normalização em duas camadas — headers/timings via `normalizeRun` (M3) + corpo via `maskNoise`
(regras de `noise` jsonpath declaradas no cenário, mascaradas com sentinela visível `"<noise>"`,
reusando `jsonpath-plus`). `scenarioKey` agrupa o histórico; `findPreviousRun` acha o anterior por
ordem total; `pruneRunHistory` retém last-N por cenário SEM descartar runs aprovados. A web app
destaca o diff em `GET /runs/:id/diff`. Fecha a limitação de body-noise deferida no M3. ZERO dep nova.

## Validação (Final Phase)

| Gate | Resultado |
|---|---|
| `npx vitest run` | 184 testes, 31 arquivos — **PASS** |
| `npx tsc --noEmit` | 0 erros — **PASS** |
| `npm audit` | 0 vulnerabilidades (ZERO dep nova) — **PASS** |
| Coverage core | diffRuns 96.15% · maskNoise 100% · runHistory 93.54% lines — **PASS (≥90)** |
| DIP | `grep 'from "../web"\|"../mcp"' src/core/` vazio — **PASS** |
| Backward-compat M0-M4 | run_request/run_scenario/draft/verdict/review verdes |

## Wiring triad por task

| Task | Caller (pillar a) | Integration test (pillar b) | Observável (pillar c) |
|---|---|---|---|
| T1.1 noise | runScenario→buildRunEnvelope propaga | noisePropagation.test.ts (4) | env.noise |
| T1.2 maskNoise | diffRuns usa | maskNoise.test.ts (8) | body mascarado |
| T1.3 diffRuns | rota /diff + E2E | diffRuns.test.ts (8) | RunDiff |
| T2.1 runHistory | rota /diff (findPrevious) + mcp (prune após persist) | runHistory.test.ts (9) | runs/ podado |
| T3.1 web diff | GET /runs/:id/diff (caller de produção) | server.test.ts (4) + render.test.ts (4) | HTML diff |
| T4.1 E2E | integra core+web | m5-e2e.test.ts (1) | loop completo |

## DoD do ROADMAP §M5 (validado)

| DoD | Evidência |
|---|---|
| #1 execuções históricas guardadas e comparáveis (anterior vs atual) | `scenarioKey` + `findPreviousRun`; E2E acha o run anterior do cenário |
| #2 diff (status/headers/body) computado e destacado na web app | `diffRuns` + `renderDiff` + `GET /runs/:id/diff`; E2E vê "Mudança detectada" + "body mudou" |
| #3 normalização de voláteis (incl. body) reduz falsos positivos, regras inspecionáveis | `noise` jsonpath no cenário + `maskNoise` (sentinela visível) + `normalizeRun` headers; E2E: timestamp volátil suprimido |

## Edge cases absorvidos (4 MUST-FIX da v1.1)

- **EC-1** retenção NUNCA apaga run aprovado (verdict presente é PINNED) — alinha `audit-trail-rotation.md`.
- **EC-2** `limit` clampado `max(1,…)` — limit 0/negativo/NaN não apaga o run recém-persistido.
- **EC-3** ordem total determinística `(createdAt, runId)` — desempate de timestamps idênticos não-flaky.
- **EC-4** `:id` da rota permanece UUID-validado; `scenarioKey` vem do run carregado, NUNCA da URL (não reabre traversal).

## Backward-compatibility
- `noise?` OPCIONAL em Scenario/RunEnvelope (`schemaVersion:1` preservado); runs/cenários M0-M4 válidos.
- `buildRunEnvelope` param `noise?` aditivo ao final; tools/rotas M0-M4 inalteradas.
- `maskNoise` reusa `jsonpath-plus`; `diffRuns` reusa `normalizeRun`/`stableStringify`.

## Commits (develop)
`ae373d1` core diff (T1.1-T1.3) · `d5e3551` fix tsc maskNoise · `f9e4772` history+retenção (T2.1) · `b05261f` web diff (T3.1) · `1f9195c` E2E+CHANGELOG (T4.1).
