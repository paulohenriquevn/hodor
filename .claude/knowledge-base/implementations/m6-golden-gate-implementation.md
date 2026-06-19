# Implementation Summary — m6-golden-gate

Date: 2026-06-19
Plan: knowledge-base/plans/m6-golden-gate-plan.md (v1.1, SHIPPABLE_WITH_CAVEATS 89)
Promise: **IMPLEMENTATION_COMPLETE**

## Resultado

Fechou o loop do Hodor (abre o V2): o agente passa a CONSUMIR a aprovação. `findGoldenRun` =
run mais recente do cenário com verdict `approved`. `checkScenario` re-roda o cenário via
`runScenario` (recaptura tokens frescos) e compara o run novo vs golden via `diffRuns` (M5) →
`{status: ok|regression|no_baseline}`. `replaySuite` itera o catálogo (`drafts/`) ∩ golden,
isolando cada cenário (erro não derruba a suíte), e agrega pass/fail. Tools MCP `check_scenario`
e `replay_suite` com `outputSchema` (machine-readable). NENHUMA grava verdict. Web: `?vs=golden`.
ZERO dep nova (composição de M1/M2/M5).

## Validação (Final Phase)

| Gate | Resultado |
|---|---|
| `npx vitest run` | 212 testes, 35 arquivos — **PASS** |
| `npx tsc --noEmit` | 0 erros — **PASS** |
| `npm audit` | 0 vulnerabilidades (ZERO dep nova) — **PASS** |
| Coverage core | checkScenario 100% stmts · replaySuite 100% lines · runHistory 95.55% — **PASS** |
| DIP | `grep 'from "../web"\|"../mcp"' src/core/` vazio — **PASS** |
| Backward-compat M0-M5 | run_request/run_scenario/draft/verdict/review/diff verdes |

## Wiring triad por task

| Task | Caller (pillar a) | Integration test (pillar b) | Observável (pillar c) |
|---|---|---|---|
| T1.1 findGoldenRun | checkScenario + web listagem/diff | runHistory.test.ts (4) | golden run |
| T2.1 checkScenario | tool check_scenario + replaySuite + E2E | checkScenario.test.ts (7) | {status, diff, run} |
| T3.1 replaySuite | tool replay_suite + E2E | replaySuite.test.ts (5) | SuiteReport |
| T4.1 tools MCP | check_scenario/replay_suite (produção) | mcp/check.test.ts (4) | checkCount/replayCount stderr |
| T5.1 web ?vs=golden | GET /runs/:id/diff?vs=golden + listagem | server.test.ts (3) + render.test.ts (1) | HTML diff vs golden + badge |
| T6.1 E2E | integra core+mcp+web | m6-e2e.test.ts (1) | loop fechado |

## DoD do ROADMAP §M6 (validado)

| DoD | Evidência |
|---|---|
| #1 findGoldenRun (run aprovado mais recente) | filtra `loadVerdict==="approved"`; ignora rejected/outros cenários |
| #2 tool check_scenario {status, diff} vs golden, sem auto-aprovar | `checkScenario` + tool com outputSchema; E2E prova nenhum verdict gravado |
| #3 replay de suíte (relatório agregado) | `replaySuite` sobre drafts/ ∩ golden + tool replay_suite; isolamento por item |
| #4 web diff vs golden + listagem marca regressões | rota `?vs=golden` + badge ⚠ regressão |

## Edge cases / decisões honradas

- **EC-1** (MUST-FIX): `replaySuite` isola cada cenário em try/catch → status 4-way (`ok|regression|no_baseline|error`); serviço-alvo caído não derruba a suíte; `allOk = regression===0 && error===0`.
- **EC-2/EC-3**: golden buscado entre runs existentes (core não persiste — run novo nunca é seu próprio baseline); golden de outro cenário (name diferente) não é usado.
- **Golden + retenção (M5)**: run aprovado é PINNED na poda (EC-1 do M5) → golden nunca é podado. Interação segura.
- **scenarioKey alargado** para shape estrutural (`ScenarioIdentity`) — uma key para RunEnvelope E Scenario (DRY).
- **Teto sem-auth (risco #2)**: documentado — endpoint autenticado dá falso `regression` (401) até o M7 (env/secrets). E2E usa endpoint sem auth.
- ADRs D1-D6 honrados; humano permanece o único aprovador (nenhuma tool grava verdict).

## Backward-compatibility
- M6 é puramente aditivo: novas funções/tools/rota; nenhum schema mudou; tools M0-M5 e rotas M2-M5 intactas.
- `?vs=golden` é opt-in (sem ele, a rota /diff mantém o comportamento M5 vs anterior).

## Commits (develop)
`c7396c5` core golden+gate (T1.1-T3.1) · `2b41db6` tools MCP (T4.1) · `f4f846f` web ?vs=golden (T5.1) · `634b0c1` E2E+CHANGELOG (T6.1).
