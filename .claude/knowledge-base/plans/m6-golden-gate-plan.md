---
slug: m6-golden-gate
milestone_id: M6
created_at: 2026-06-19
goal: Fechar o loop do Hodor — um gate de regressão consumível por máquina que compara o run atual contra o último run APROVADO do cenário (golden), via tool MCP, provado por um teste E2E verde.
---

# Plan: M6 — Fechar o loop: golden baseline + gate de regressão

> **Version 1.1** (absorveu EC-1 MUST-FIX de `knowledge-base/reviews/m6-golden-gate-edge-cases-2026-06-19.md`: `replaySuite` isola cada cenário com try/catch → status 4-way `ok|regression|no_baseline|error`; um serviço-alvo caído NÃO derruba a suíte; `allOk = regression===0 && error===0`). Baseado no blueprint SHIPPABLE `knowledge-base/discoveries/blueprints/m6-golden-gate-blueprint.md` (keploy: replay/golden + testrun status; step-ci: agregação de suíte; mcp-sdk: veredito estruturado). Fecha o loop do V1: o agente passa a CONSUMIR a aprovação, não só produzi-la. `findGoldenRun` = run mais recente do cenário com verdict `approved` (generaliza `findPreviousRun` do M5). `checkScenario` RE-RODA o cenário via `runScenario` (recaptura tokens frescos — NÃO reconstrói os requests do golden, que têm captures resolvidos/velhos) e compara o run novo vs golden via `diffRuns` (M5) → `{status: ok|regression|no_baseline, diff}`. `replaySuite` itera o catálogo (`drafts/` — única fonte dos specs) ∩ golden e agrega pass/fail. Duas tools MCP finas (`check_scenario`, `replay_suite`) com `outputSchema` (machine-readable). NENHUMA grava verdict — humano segue único aprovador. Web: diff `?vs=golden`. ZERO dep nova (reusa `runScenario`, `diffRuns`, `loadVerdict`, `listDrafts`, `normalizeRun`, `maskNoise`).

## Goal

> Entregar o gate de regressão `check_scenario` (tool MCP) que executa um cenário contra o serviço atual e retorna `{status: "ok"|"regression"|"no_baseline", diff}` comparando vs o golden aprovado, sem auto-aprovar, measured by o teste E2E `e2e_m6_check_scenario_gates_on_golden` retornando verde.

## Context

`ROADMAP.md` §M6 (V2; depende de M2/M3/M5) pede: (1) `findGoldenRun(scenarioKey)` = run mais recente com verdict `approved` (null se nunca aprovado); (2) tool MCP `check_scenario` → `{status, diff}` vs golden, nunca auto-aprova; (3) replay de suíte (todos os cenários com golden, relatório agregado); (4) web: diff vs golden + listagem marca regressões. Riscos: (#1) golden stale/cenário editado (scenarioKey muda → golden órfão) — avisar "sem baseline"; (#2) re-execução contra serviço real — sem env/secrets (M7) só cobre endpoints sem auth (teto declarado).

O blueprint fixou (D1-D6 neste plano; 7 ADRs de design no blueprint): `findGoldenRun` filtra `loadVerdict==="approved"` (não `hasVerdict`, que pegaria rejected); `checkScenario` re-roda (D2 — captures frescos); catálogo = `listDrafts` ∩ golden (D3); core puro + 2 tools finas (D4); agregação `{allOk,total,ok,regression,noBaseline}`, `no_baseline` não derruba o gate (D5); status 3-way trivial sobre `RunDiff.hasRegression` (D6); web `?vs=golden` (D6).

## Baseline Context (deep review of current state)

> Estado real pós-M5 (READY_TO_MERGE em develop). Evidência: `git log` + `wc -l`. `runs/`+`verdicts/` efêmeros; `reviews/`+`drafts/` commitáveis.

### Files that will be touched

| File | LoC hoje | Last commit | Por que existe | Invariante a preservar |
|---|---|---|---|---|
| `src/core/runHistory.ts` | 130 | `df0211d` | scenarioKey/findPreviousRun/prune (M5) | add `findGoldenRun`; exporta `loadAllRuns`/`compareRuns` p/ reuso interno; M5 intacto |
| `src/core/verdict.ts` | 49 | `ec2928b` | VerdictSchema + load (M2) | `loadVerdict` reusado p/ achar golden; sem mudança |
| `src/core/diffRuns.ts` | 90 | `df0211d` | diff de regressão (M5) | reusado por `checkScenario`; sem mudança |
| `src/core/runScenario.ts` | 47 | `4351af8` | engine multi-step (M1) | reusado por `checkScenario` (re-roda o cenário); sem mudança |
| `src/core/draftStore.ts` | 175 | `3a4bf36` | save/load/listDrafts (M4) | `listDrafts`+`loadDraft` reusados p/ o catálogo da suíte; sem mudança |
| `src/core/checkScenario.ts` (NEW) | 0 | — | (a criar) orquestra run+golden+diff → status | core; recebe deps injetáveis; NÃO grava verdict |
| `src/core/replaySuite.ts` (NEW) | 0 | — | (a criar) itera catálogo ∩ golden → relatório agregado | core; `no_baseline` não derruba; deps injetáveis |
| `src/core/index.ts` | 80 | `df0211d` | superfície pública (DIP) | add exports M6; preserva existentes |
| `src/mcp/server.ts` | 152 | `df0211d` | adaptador MCP | add tools `check_scenario`+`replay_suite` (outputSchema); tools M0-M5 intactas; métrica stderr |
| `src/web/server.ts` | 290 | `df0211d` | adaptador HTTP | rota `/runs/:id/diff` aceita `?vs=golden`; listagem marca regressão vs baseline; rotas M2-M5 preservadas |
| `src/web/render.ts` | 340 | `df0211d` | render HTML | `renderDiff` reusado (golden como prev); badge de regressão na listagem; XSS mantido |
| `CHANGELOG.md` | — | (release) | contrato público | entrada em `[Unreleased] § Added` |

### Current callers / dependents

- **`findPreviousRun`/`loadAllRuns`/`compareRuns`** (`runHistory.ts`): internos do M5; `findGoldenRun` reusa a mesma maquinaria (carrega runs, filtra por scenarioKey, ordena). `loadAllRuns`/`compareRuns` passam a ser usados por 2 funções — extrair como helpers exportados-internos (sem duplicar).
- **`loadVerdict`** (`verdict.ts:37`): caller `web/server.ts` (listagem/run). `findGoldenRun` passa a ser segundo caller (filtra approved).
- **`diffRuns`** (`diffRuns.ts`): caller `web/server.ts` (rota /diff). `checkScenario` passa a ser segundo caller.
- **`runScenario`** (`runScenario.ts`): callers `mcp/server.ts` (run_scenario). `checkScenario` reusa para re-rodar.
- **`listDrafts`/`loadDraft`** (`draftStore.ts`): hoje só em testes; `replaySuite` passa a ser o caller de produção (catálogo).

### Domain glossary

- **golden run** — run mais recente de um cenário cujo `runId` tem verdict `approved` em `verdicts/`. É o baseline de regressão.
- **gate** — `check_scenario`: re-executa o cenário e devolve um veredito de regressão consumível por máquina (não aprova).
- **catálogo** — `drafts/`: a única fonte dos specs de cenário (asserts/captures) — o run só guarda resultados, não specs.
- **no_baseline** — não há golden para a `scenarioKey` (cenário nunca aprovado OU editado desde a aprovação → key órfã). NÃO é regressão.

### Architecture boundaries affected

Lógica no `src/core/` (checkScenario, replaySuite, findGoldenRun — orquestram funções core puras/IO já existentes). `src/mcp/` e `src/web/` são adaptadores que só importam de `src/core/index.js`. `core` não importa de mcp/web. DIP preservado.

## Prior Art & Related Work

- Interno: blueprint `knowledge-base/discoveries/blueprints/m6-golden-gate-blueprint.md` (7 ADRs); `findPreviousRun`/`diffRuns` (M5); `loadVerdict` (M2); `listDrafts` (M4); `runScenario` (M1).
- Externo (citado no blueprint): keploy (replay/golden + testrun status), step-ci (agregação de suíte + exit code), mcp-typescript-sdk (outputSchema estruturado).

## ADRs

### D1 — `findGoldenRun` generaliza `findPreviousRun` filtrando verdict `approved`

**Decisão:** `findGoldenRun(key, runsDir, verdictsDir)` = run mais recente (ordem total `(createdAt, runId)`) cujo `scenarioKey(r) === key` E `loadVerdict(r.runId).verdict === "approved"`. Reusa `loadAllRuns`/`compareRuns` do M5 (extraídos como helpers exportados-internos). `null` se nenhum aprovado.

**Rationale:** keploy usa o testcase gravado como golden; o Hodor usa o run aprovado. Filtrar por `approved` (não `hasVerdict`, que incluiria `rejected`) é o oráculo correto. Reuso de 80% da query que `pruneRunHistory` já fazia. Key órfã por edição → `null` → resolve risco #1 de graça.

**Alternativas rejeitadas:** golden = último run com `reviews/` (reviews existe p/ approved E rejected — pegaria rejeitado); índice de golden persistido (YAGNI — `loadAllRuns` + filtro basta no volume local).

### D2 — `checkScenario` RE-RODA o cenário (não reconstrói requests do golden)

**Decisão:** `checkScenario(scenario, deps)` executa o cenário via `runScenario` (recebe os specs na fronteira), acha o golden por `scenarioKey` do run novo, e retorna `{status, diff, run}` onde `diff = diffRuns(golden, run)`. NÃO reconstrói os requests do golden.

**Rationale:** o golden tem captures inter-step com valores JÁ RESOLVIDOS (token velho → falso 401 ao re-emitir). Re-rodar via `runScenario` recaptura tokens frescos; o golden é só o lado esquerdo do `diffRuns`. keploy contorna com mocks de dependência; o Hodor não tem mocks → re-executa vivo (honesto sobre o teto: endpoints autenticados precisam do M7).

**Alternativas rejeitadas:** pure-replay reconstruindo `golden.steps[].request` (quebra com captures resolvidos/stale); mock de dependências (escopo enorme, fora do V2 imediato).

### D3 — Catálogo da suíte = `listDrafts` ∩ golden

**Decisão:** `replaySuite(draftsDir, runsDir, verdictsDir, deps)` itera `listDrafts` (specs de cenário), para cada draft com golden roda `checkScenario`, agrega. Drafts sem golden → contados como `no_baseline` (não derrubam o gate).

**Rationale:** `drafts/` é a ÚNICA fonte dos specs (asserts/captures); o run guarda só resultados/valores resolvidos, não specs. Sem índice novo (YAGNI). Cenários rodados via `run_scenario` sem `save_scenario_draft` ficam fora da suíte — limitação honesta (o agente cataloga via `save_scenario_draft`).

**Alternativas rejeitadas:** reconstruir cenários dos runs (sem specs — ver D2); índice separado de cenários (YAGNI).

### D4 — `checkScenario`/`replaySuite` no core + 2 tools MCP finas com `outputSchema`

**Decisão:** a lógica vive no core (`checkScenario.ts`, `replaySuite.ts`) com deps injetáveis; os adaptadores MCP `check_scenario` e `replay_suite` apenas chamam e publicam `outputSchema` zod (machine-readable, DoD #2) + métrica em stderr. O adaptador persiste o run novo (consistência com `run_scenario`) e poda. NENHUMA tool grava verdict.

**Rationale:** `architecture.md` §1-§2 (lógica no core, MCP é adaptador). `outputSchema` torna o veredito consumível por mim (o agente) deterministicamente (mcp-sdk). Persistir o run novo permite ao humano revisar/aprovar uma regressão depois.

**Alternativas rejeitadas:** lógica no adaptador MCP (viola DIP); tool que auto-aprova em `ok` (viola DoD #2 — humano é o único aprovador).

### D5 — Status 3-way + agregação; `no_baseline` não derruba o gate

**Decisão:** `status = golden == null ? "no_baseline" : diff.hasRegression ? "regression" : "ok"`. `replaySuite` agrega `{allOk, total, ok, regression, noBaseline, results[]}`; `allOk = regression === 0` (no_baseline NÃO conta como falha — cenário novo não é regressão).

**Rationale:** mapeia trivialmente `RunDiff.hasRegression` (M5). keploy trata "sem baseline/obsolete" ortogonal ao pass/fail. step-ci agrega e devolve exit code no adaptador.

**Alternativas rejeitadas:** `no_baseline` como falha (bloquearia todo cenário novo — falso positivo); 2-way ok/fail (perde o sinal "precisa de baseline").

### D6 — Web `GET /runs/:id/diff?vs=golden`

**Decisão:** a rota `/runs/:id/diff` aceita `?vs=golden` → acha o golden do cenário do run e renderiza `diffRuns(golden, run)` com `renderDiff` (reuso M5); sem `?vs` mantém o comportamento M5 (vs anterior). Sem golden → "sem baseline para esta versão do cenário". A listagem marca (best-effort) runs que são regressão vs seu golden.

**Rationale:** reusa `diffRuns`+`renderDiff` (M5); `?vs=golden` é aditivo (não quebra o link M5). `:id` segue UUID-validado (M2); golden vem do run carregado, nunca da URL.

**Alternativas rejeitadas:** rota separada `/golden-diff` (duplica a lógica de diff); tornar golden o default (quebraria o link M5 existente).

## Dependency Graph

```
P1 (core: findGoldenRun) ──> P2 (core: checkScenario) ──> P3 (core: replaySuite)
                                    │                            │
                                    └──> P4 (mcp tools) <─────────┘
P1 ──> P5 (web ?vs=golden)
P2,P3,P4,P5 ──> P6 (E2E)
```

## Phases

### Phase 1 — Core: `findGoldenRun`

#### T1.1 — `findGoldenRun` (run aprovado mais recente do cenário)

**Why this step:** é o baseline de tudo no M6 (DoD #1). Ação: extrair `loadAllRuns`/`compareRuns` como helpers internos reutilizáveis em `runHistory.ts` e adicionar `findGoldenRun(key, runsDir, verdictsDir)`. Raciocínio: D1; generaliza `findPreviousRun` filtrando `loadVerdict==="approved"`.

**Files to edit:** `src/core/runHistory.ts`, `src/core/runHistory.test.ts`, `src/core/index.ts`.

**Deep file dependency analysis:** reusa `loadAllRuns`/`compareRuns`/`scenarioKey` (M5) + `loadVerdict` (M2). I/O isolado no core; sem mudança de comportamento do M5.

#### TDD
- RED `find_golden_run_returns_latest_approved` — 3 runs do cenário (t1,t2,t3); t1 e t2 approved, t3 sem verdict → golden = t2 (mais recente aprovado, não t3).
- RED `find_golden_run_ignores_rejected` — run com verdict `rejected` NÃO é golden.
- RED `find_golden_run_null_when_none_approved` — nenhum aprovado → null.
- RED `find_golden_run_ignores_other_scenarios` — run aprovado de OUTRO scenarioKey é ignorado.

**Acceptance:** `findGoldenRun(key, runsDir, verdictsDir)` retorna o run aprovado mais recente do cenário ou null; ignora rejected e outros cenários.

**DoD:** `npx vitest run src/core/runHistory.test.ts` verde; M5 intacto; `tsc` limpo.

#### Concurrency tests
(none — single-threaded).

### Phase 2 — Core: `checkScenario`

#### T2.1 — `checkScenario` (gate vs golden)

**Why this step:** é o gate consumível por mim (DoD #2). Ação: criar `src/core/checkScenario.ts` — `checkScenario(scenario, {deps, runsDir, verdictsDir})` roda `runScenario`, acha golden por `scenarioKey(run)`, retorna `{status, diff, run}`. Raciocínio: D2 (re-roda) + D5 (status 3-way).

**Files to edit:** `src/core/checkScenario.ts` (NEW), `src/core/checkScenario.test.ts` (NEW), `src/core/index.ts`.

**Deep file dependency analysis:** reusa `runScenario` (M1), `findGoldenRun` (T1.1), `diffRuns` (M5), `scenarioKey` (M5). NÃO persiste nem grava verdict (o adaptador persiste).

#### TDD
- RED `check_scenario_no_baseline_when_no_golden` — cenário sem golden → `status:"no_baseline"`, `diff:null`.
- RED `check_scenario_ok_when_matches_golden` — golden aprovado + serviço inalterado → `status:"ok"` (sem regressão).
- RED `check_scenario_regression_when_behavior_changes` — golden aprovado + serviço muda o body → `status:"regression"`, `diff.hasRegression:true`.
- RED `check_scenario_returns_fresh_run` — o `run` retornado é a execução nova (recaptura), não o golden.
- RED `check_scenario_finds_golden_before_persisting` (EC-3) — o core NÃO persiste o run novo; o golden é buscado entre runs já existentes, então o run novo nunca é seu próprio baseline.
- RED `check_scenario_does_not_match_other_scenario_golden` (EC-2) — golden de um cenário com `name` diferente não é usado (scenarioKey distinta).
- RED `check_scenario_never_writes_verdict` — após checkScenario não existe novo `verdicts/` (humano é o aprovador).

**Acceptance:** `checkScenario` re-roda, compara vs golden, devolve status 3-way + diff + run novo; nunca grava verdict.

**DoD:** `npx vitest run src/core/checkScenario.test.ts` verde (servidor efêmero real); `tsc` limpo.

#### Concurrency tests
(none — single-threaded).

#### Failure scenarios
- **Serviço-alvo fora do ar** (`runScenario`→`executeRequest`): erro de request propaga como `RequestExecutionError` (M0) — checkScenario não mascara. Coberto pelo contrato do M0/M1.
- **Golden corrompido em `runs/`**: `loadAllRuns` (M5) tolera/pula — golden inválido não derruba o gate.

### Phase 3 — Core: `replaySuite`

#### T3.1 — `replaySuite` (catálogo ∩ golden → relatório agregado)

**Why this step:** o gate de suíte que eu invoco antes de declarar uma mudança pronta (DoD #3). Ação: criar `src/core/replaySuite.ts` — itera `listDrafts`, para cada draft roda `checkScenario` ISOLADO em try/catch (EC-1), agrega `{allOk, total, ok, regression, noBaseline, error, results[]}`. Raciocínio: D3 (catálogo) + D5 (agregação; no_baseline não derruba) + EC-1 (um alvo caído não derruba a suíte).

**Files to edit:** `src/core/replaySuite.ts` (NEW), `src/core/replaySuite.test.ts` (NEW), `src/core/index.ts`.

**Deep file dependency analysis:** reusa `listDrafts`/`loadDraft` (M4) + `checkScenario` (T2.1). Tolera draft corrompido (listDrafts já pula) E checkScenario que lança (serviço caído → `status:"error"`, não aborta a suíte).

#### TDD
- RED `replay_suite_aggregates_ok_and_regression` — 2 drafts com golden: um casa (ok), um regride → `{total:2, ok:1, regression:1, allOk:false}`.
- RED `replay_suite_counts_no_baseline_without_failing` — draft sem golden → `noBaseline:1`, NÃO conta em `regression`; `allOk` reflete só regressões/erros.
- RED `replay_suite_isolates_failing_scenario` (EC-1) — um cenário cujo serviço-alvo está fora do ar (checkScenario lança) → `status:"error"` para ESSE item, os demais rodam normalmente; `allOk = regression===0 && error===0` → false; a suíte NÃO aborta.
- RED `replay_suite_empty_catalog_is_allOk` — sem drafts → `{total:0, allOk:true}`.
- RED `replay_suite_results_carry_status_per_scenario` — `results[]` tem `{scenarioKey, status}` por cenário.

**Acceptance:** `replaySuite` agrega pass/fail+diff por cenário do catálogo; status 4-way (`ok|regression|no_baseline|error`); `no_baseline` não derruba `allOk`; um cenário que lança vira `error` isolado sem abortar a suíte.

**DoD:** `npx vitest run src/core/replaySuite.test.ts` verde.

#### Concurrency tests
(none — single-threaded; cenários rodados em sequência — paralelização é M-futuro).

### Phase 4 — MCP: tools `check_scenario` + `replay_suite`

#### T4.1 — Tools MCP com `outputSchema`

**Why this step:** a superfície consumível por mim (DoD #2). Ação: `registerTool("check_scenario", {inputSchema: ScenarioSchema.shape, outputSchema: {status, runId, hasRegression, diff?}}, ...)` e `registerTool("replay_suite", {outputSchema: {allOk, total, ok, regression, noBaseline}}, ...)`; delegam ao core; persistem o run novo + podam; métrica stderr. Raciocínio: D4.

**Files to edit:** `src/mcp/server.ts`, `src/mcp/check.test.ts` (NEW).

**Deep file dependency analysis:** callers de produção de `checkScenario`/`replaySuite`. Persistem via `persistRun`+`pruneAfterPersist` (M5). NUNCA gravam verdict.

#### TDD
- RED `check_scenario_tool_returns_structured_status` — via InMemoryTransport, `check_scenario` de um cenário sem golden → `structuredContent.status:"no_baseline"`.
- RED `check_scenario_tool_detects_regression` — golden aprovado + serviço mudado → `status:"regression"`.
- RED `check_scenario_tool_persists_run_but_no_verdict` — após a tool, o run novo está em `runs/` mas NÃO há verdict novo.
- RED `replay_suite_tool_aggregates` — catálogo com golden → `structuredContent.allOk` coerente.

**Acceptance:** tools aparecem em `tools/list`; retornam veredito estruturado; persistem run sem aprovar; métrica observável.

**DoD:** `npx vitest run src/mcp` verde; `tsc` limpo.

#### Concurrency tests
(none — single-threaded).

### Phase 5 — Web: diff `?vs=golden` + badge de regressão

#### T5.1 — Rota `?vs=golden` + listagem marca regressão

**Why this step:** DoD #4 — diff vs golden na web + regressões visíveis. Ação: `/runs/:id/diff?vs=golden` acha o golden e renderiza `diffRuns(golden, run)`; sem golden → "sem baseline"; a listagem marca (best-effort) runs que regridem vs golden. Raciocínio: D6.

**Files to edit:** `src/web/server.ts`, `src/web/render.ts`, `src/web/server.test.ts`, `src/web/render.test.ts`.

**Deep file dependency analysis:** reusa `findGoldenRun`+`diffRuns`+`renderDiff`. `:id` segue UUID-validado (M2); golden vem do run carregado. Listagem: para cada run, melhor-esforço calcula golden+diff (volume local bounded pela retenção M5).

#### TDD
- RED `web_diff_route_vs_golden_renders_against_golden` — run com golden aprovado + `?vs=golden` → diff vs golden (não vs anterior).
- RED `web_diff_route_vs_golden_no_baseline_message` — sem golden → "sem baseline para esta versão do cenário".
- RED `web_diff_route_default_still_vs_previous` — sem `?vs` → comportamento M5 (vs anterior) preservado.
- RED `web_listing_marks_regression_vs_golden` — run que regride vs golden → badge "regressão" na listagem; run ok → sem badge.

**Acceptance:** `?vs=golden` compara vs golden; default M5 preservado; sem golden → mensagem; listagem marca regressão; XSS-safe.

**DoD:** `npx vitest run src/web` verde.

#### Concurrency tests
(none — single-threaded).

### Phase 6 — Final Phase: Integration Validation (E2E M6)

#### T6.1 — E2E `e2e_m6_check_scenario_gates_on_golden`

**Why this step:** prova o loop fechado e a métrica do Goal. Ação: criar `src/m6-e2e.test.ts`. Raciocínio: integra P1-P5.

**Files to edit:** `src/m6-e2e.test.ts` (NEW), `CHANGELOG.md`.

#### TDD
- RED `e2e_m6_check_scenario_gates_on_golden`:
  1. roda um cenário contra um servidor efêmero (value estável) → run A; humano aprova (saveVerdict approved) → A vira golden.
  2. `checkScenario(cenário)` com serviço inalterado → `status:"ok"` (sem regressão vs golden).
  3. muda o serviço (value diferente) → `checkScenario` → `status:"regression"`, `diff.hasRegression:true` (gate pega a mudança real).
  4. cenário NUNCA aprovado → `checkScenario` → `status:"no_baseline"`.
  5. `replaySuite` sobre o catálogo (`drafts/` com o cenário salvo) → agrega `{regression≥1, allOk:false}`.
  6. web `GET /runs/:id/diff?vs=golden` do run regredido destaca a mudança.
  7. o golden NUNCA foi auto-aprovado: nenhum verdict novo foi gravado pelo gate.

**Acceptance:** E2E verde; os 4 DoDs do ROADMAP §M6 demonstrados (golden; gate consumível; replay de suíte; web vs golden).

**DoD (Final Phase):** `npx vitest run` (suíte completa) verde; `tsc --noEmit` 0 erros; `npm audit` 0 vulns (ZERO dep nova); coverage core novos ≥ 90%; backward-compat M0-M5 verde; CHANGELOG `[Unreleased] § Added`.

#### Concurrency tests
(none — single-threaded).

#### Failure scenarios
- **Endpoint autenticado sem env/secret** (teto declarado, risco #2): `checkScenario` re-roda; sem token fresco o request pode dar 401 → falso `regression`. DOCUMENTADO: M7 (env/secrets) remove o teto. O E2E usa endpoint sem auth.
- **Golden órfão por cenário editado** (risco #1): `scenarioKey` muda → `findGoldenRun` retorna null → `status:"no_baseline"` (não compara contra golden de outra versão). Coberto em T1.1/T2.1.
- **Serviço-alvo fora do ar**: erro de request propaga (M0/M1) — não mascarado.

## Coverage Matrix

| # | Gap / Requirement (ROADMAP §M6 DoD) | Task(s) | Resolution |
|---|---|---|---|
| 1 | DoD #1 — `findGoldenRun` (run aprovado mais recente) | T1.1 | filtra `loadVerdict==="approved"` sobre runs do scenarioKey |
| 2 | DoD #2 — tool `check_scenario` `{status, diff}` vs golden, sem auto-aprovar | T2.1, T4.1 | `checkScenario` core + tool MCP com outputSchema; nunca grava verdict |
| 3 | DoD #3 — replay de suíte (relatório agregado) | T3.1, T4.1 | `replaySuite` sobre `drafts/` ∩ golden + tool `replay_suite` |
| 4 | DoD #4 — web diff vs golden + listagem marca regressões | T5.1 | rota `?vs=golden` + badge de regressão |
| 5 | Risco #1 — golden órfão por cenário editado | T1.1, T2.1 | scenarioKey muda → null → `no_baseline` |
| 6 | Risco #2 — teto sem auth (re-execução real) | T6.1 | documentado; E2E usa endpoint sem auth; M7 remove o teto |
| 7 | Backward-compat M0-M5 + ZERO dep nova | T1.1, T6.1 | reuso de runScenario/diffRuns/loadVerdict/listDrafts; suíte existente verde |

**Coverage: 7/7 gaps cobertos (100%)**

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `zod` | `^3.x` (já declarado) | npm | `outputSchema` das tools; validação na fronteira (reuso M0-M5) |
| `@modelcontextprotocol/sdk` | `1.29.0` (já declarado) | npm | `registerTool` com outputSchema (reuso M0/M1/M4) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | — | M6 é composição de M1/M2/M5; nada novo. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Global DoD

- Todos os testes verdes; `tsc --noEmit` 0 erros; `npm audit` 0 vulns.
- ZERO dependência nova (`git diff package.json` vazio).
- Coverage dos arquivos core novos (`checkScenario.ts`, `replaySuite.ts`) + `findGoldenRun` ≥ 90%.
- Arquivos ≤ 500 LoC; SRP.
- DIP: `grep -rn 'from "../web"\|from "../mcp"' src/core/` vazio.
- NENHUMA tool grava verdict (humano é o único aprovador).
- CHANGELOG `[Unreleased] § Added` com a entrada do M6.
- Os 4 DoDs do ROADMAP §M6 validados empiricamente pelo E2E.

## Drawbacks & Risks

| Risco | Severidade | Mitigação | Owner |
|---|---|---|---|
| Teto sem auth — `check_scenario` re-executa; endpoint autenticado dá falso `regression` (risco #2) | Alta | declarado; M7 (env/secrets) remove o teto; E2E usa endpoint sem auth | dev |
| Golden órfão por cenário editado (risco #1) | Média | scenarioKey muda → `no_baseline` (não compara contra golden de outra versão) | dev |
| Cenário rodado sem `save_scenario_draft` fica fora da suíte | Baixa | `replaySuite` cataloga via `drafts/`; documentado — o agente salva o draft p/ catalogar | dev |
| Listagem marcar regressão custa um diff por run | Baixa | volume local bounded pela retenção M5; best-effort/tolerante a erro | dev |

## Unresolved Questions

(none — every decision is resolved at plan time; design fixado no blueprint e escopo de parsimônia neste plano.)
