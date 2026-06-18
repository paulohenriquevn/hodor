# Implementation Summary — m1-scenario-model

Date: 2026-06-18
Plan: knowledge-base/plans/m1-scenario-model-plan.md (v1.1, SHIPPABLE_WITH_CAVEATS 89)
Promise: **IMPLEMENTATION_COMPLETE**

## Resultado

Modelo de cenário multi-step do M1 funcionando: cenário declarativo JSON → engine `runScenario`
executa step-a-step, propaga variáveis capturadas (jsonpath/regex), avalia asserts
(`{source,op,value}`→`{pass,expected,actual}`), produz o envelope do M0 com cada step estendido
por `asserts[]`/`captures{}` (aditivo, backward-compat). Tool MCP `run_scenario` + render web de
asserts/captures. Métrica do Goal (`e2e_scenario_multistep_captures_and_asserts`) verde.

## Validação (Final Phase)

| Gate | Resultado |
|---|---|
| `npx vitest run` | 64 testes, 14 arquivos — **PASS** |
| `npx tsc --noEmit` | 0 erros — **PASS** |
| `npm audit` | 0 vulnerabilidades (incl. jsonpath-plus transitivo) — **PASS** |
| Coverage (core cenário) | 95.94% lines (evalAssert 96%, evalCapture 100%, runScenario 100%) — **PASS** (≥90%) |
| File size | máx 134 linhas (≤500) — **PASS** |
| Failure scenarios | network abort / jsonpath miss→null / assert fail registrado — 3/3 |
| Backward-compat M0 | run_request + runs/render M0 continuam verdes |

## Wiring triad por task

| Task | Caller (pillar a) | Integration test (pillar b) | Runtime metric (pillar c) |
|---|---|---|---|
| T0.1 jsonpath-plus | usado por evalCapture/evalAssert | npm audit | n/a |
| T1.1 scenarioSchema + RunStep ext | usado por engine/mcp/web | scenarioSchema.test.ts (4) | n/a |
| T1.2 interpolate | chamado por runScenario | interpolate.test.ts (5) | n/a |
| T1.3 evalCapture | chamado por runScenario | evalCapture.test.ts (4) | n/a |
| T1.4 evalAssert | chamado por runScenario | evalAssert.test.ts (11) | n/a |
| T1.5 runScenario | chamado pela tool run_scenario | runScenario.test.ts (5, vs http efêmero) | via envelope |
| T2.1 tool run_scenario | handler → runScenario | scenario.test.ts (3, InMemoryTransport) | getScenarioRunCount() + log stderr |
| T3.1 render asserts/captures | chamado pelo web server | render.test.ts (4 novos) | n/a |
| T4.1 E2E | integra todas as camadas | scenario-e2e.test.ts (1) | exercita getScenarioRunCount |

## Edge cases / decisões honradas

- **EC-1** assert `header:<name>` case-insensitive (headers lowercased) — testado.
- **EC-2** ops `contains`/`matches` coercem actual a string — testado.
- **EC-3** `interpolateRequest` faz `encodeURIComponent` na URL — testado.
- **EC-4** variáveis flat (`${{ id }}`, sem prefixo `captures.`); jsonpath primeiro match — documentado.
- **Q1** assert fail NÃO aborta; falha de rede aborta (RequestExecutionError) — testado.
- **Q2** var ausente na interpolação → ScenarioError (fail-fast) — testado.
- ADRs D1–D5 honrados: cenário JSON+zod; jsonpath-plus (só path queries, sem eval); assert {source,op,value}; envelope M0 reusado com RunStep aditivo (schemaVersion:1 mantido); engine no core + tool run_scenario.

## Backward-compatibility (anti re-trabalho M0)

- `RunStepSchema` ganhou `asserts`/`captures` OPCIONAIS → runs e render do M0 seguem válidos (testes `run_step_still_accepts_m0_shape`, `render_run_m0_step_without_asserts_still_renders`).
- `executeRequest`/`buildRunEnvelope` reusados sem mudança de assinatura.

## Commits (develop)

`e10efe1` dep · `213839a` core (T1.1-T1.5) · `35eefc7` mcp tool · `af982a4` web render · `5774f93` e2e+changelog.
