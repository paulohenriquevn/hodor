# Review: m1-scenario-model

**Date:** 2026-06-18
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-api-design, domain-security
**Plan:** knowledge-base/plans/m1-scenario-model-plan.md (v1.1, SHIPPABLE_WITH_CAVEATS 89)
**Code-quality gate:** PASS_WITH_CAVEATS
**Verdict:** **READY_TO_MERGE**

## Findings (consolidado)

Inicial: BLOCKER 0 · HIGH 1 · MEDIUM 5 · LOW ~12 · INFO ~10.
Após correções (commit `0d1732d`): **BLOCKER 0 · HIGH 0** · MEDIUM restantes documentados como aceitos/follow-up.

### HIGH resolvido antes do merge

| ID | Achado | Correção (commit `0d1732d`) |
|---|---|---|
| F-arch-1 | extração jsonpath duplicada em `evalAssert.ts` e `evalCapture.ts` (DRY/Rule 12; o plano T1.4 dizia reusar) | extraído `evalJsonPath()` único em `evalCapture.ts`; `evalAssert` reusa; `jsonpath-plus` agora SÓ em `evalCapture.ts` (encapsulamento ADR D2) |

### MEDIUM resolvidos antes do merge

| ID | Achado | Correção |
|---|---|---|
| F-wire-1 | `loadScenario` export público MORTO (zero caller/teste; risco `dead_public_export` FAIL_HARD) | removido (YAGNI — M1 recebe cenário via MCP, sem load de disco; volta no M2/CLI) |
| F-tests-1 | Q2 (var ausente → ScenarioError) só testada no unit interpolate, não via `runScenario` | teste `run_scenario_aborts_on_undefined_variable` adicionado |
| F-dom-4 | `contains`/`matches` com actual `null` viravam `"null"` (falso-positivo) | guard: actual null/undefined → `false` |

### MEDIUM/LOW aceitos como caveat / follow-up (não bloqueiam)

| ID | Achado | Decisão |
|---|---|---|
| F-dom-1 | abort de rede num step intermediário descarta steps já executados (sem envelope parcial) | Aceito M1 (fail-fast); evolução para envelope-parcial-com-erro documentada como follow-up M4/M5 (regressão precisa do ponto de quebra) |
| F-sec-1 | ReDoS: `new RegExp(spec.regex)` sem timeout (fase síncrona fora do AbortController) | Aceito M1 — uso local single-user, autor do regex = operador; follow-up de hardening (cap de input / re2) para qualquer exposição a terceiros |
| F-dom-2 | açúcar `check.status` (ADR D3) não implementado (só forma explícita) | YAGNI no M1; a forma explícita `{source:"status",op:"equals"}` cobre o DoD; açúcar é aditivo futuro |
| F-arch-2 | `InterpolatableRequest` redeclarado em vez de inferir do schema | LOW; sem divergência hoje (request shape estável); refatorar quando o request ganhar campos (M2) |
| F-sec-2/3, F-dom-3/5, F-tests-2..6 | CRLF terceirizado ao undici; cap de body; `equals` estrito; namespace flat; loadScenario sem teste (removido) | LOW/INFO; documentados; nenhum bloqueia M1 |

## Cross-validation (plano vs implementação)

| Métrica | Resultado |
|---|---|
| Tasks do plano | 9 (T0.1–T4.1) |
| FULLY implementadas | 9/9 |
| PARTIAL / MISSING / DIVERGED | 0 |
| Coverage Matrix | 8/8 gaps resolvidos em código real |
| ADRs D1–D5 | 5/5 respeitados |
| Plan drift | nenhum (plano congelado antes do 1º commit de impl) |
| Backward-compat M0 | preservada (RunStep aditivo; 15 testes M0 verdes; executeRequest/buildRunEnvelope reusados) |
| Goal (`e2e_scenario_multistep_captures_and_asserts`) | verde |

## DoD do ROADMAP §M1 (validado pelo cross-validation)

| DoD | Satisfeito | Evidência |
|---|---|---|
| (1) Formato declarativo de cenário (steps; step=request+asserts; captura p/ steps seguintes) | ✓ | `ScenarioSchema` + interpolação `${{ var }}` |
| (2) Engine step-a-step + propaga variáveis + avalia asserts (status/headers/body jsonpath/regex) | ✓ | `runScenario` + `evalAssert` (status/header/jsonpath) + `evalCapture` (jsonpath/regex) |
| (3) Resultado por step: request/response/headers + pass/fail por assert + variáveis | ✓ | `RunStep` += `asserts[{pass,expected,actual}]`+`captures{}`; render exibe |

## Quality gates (re-validação)

| Gate | Resultado |
|---|---|
| `npx vitest run` | 65/65 — **PASS** |
| `npx tsc --noEmit` | 0 erros — **PASS** |
| Coverage core cenário | 95.89% lines (functions 100%) — **PASS** (≥90%) |
| `npm audit` | 0 vulnerabilidades (jsonpath-plus@10.4.0 incl.) — **PASS** |
| Wiring triad | engine wired ao fluxo E2E real; `getScenarioRunCount` exercitado no E2E; sem dead export (loadScenario removido) |
| Fronteira DIP | core não importa mcp/web; `jsonpath-plus` SÓ em `evalCapture.ts` — **PASS** |
| Backward-compat M0 | run_request + render/runs M0 verdes — **PASS** |

## Spawned agents (audit trail)

- .claude/agents/review-m1-scenario-model-2026-06-18/{architecture,tests,wiring,cross-validation,domain-api-design,domain-security}.md (+ findings/)

## Handoff decision

**READY_TO_MERGE** — 0 BLOCKER, 0 HIGH (o HIGH F-arch-1 + os MEDIUM de maior risco corrigidos antes do merge). MEDIUM/LOW restantes são caveats explícitos aceitos para o escopo M1 (uso local single-user) ou follow-ups datados para M4/M5, documentados acima. Próximo passo (fora do escopo do goal): `/release` (corte develop→main, gate de aprovação humana — Regra 4).
