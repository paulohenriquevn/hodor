# Blueprint: M6 — Fechar o loop: golden baseline + gate de regressão

> Discovery executada sobre `keploy` (o CORAÇÃO do M6 — o modelo golden/replay: o testcase gravado É o oráculo, replay re-emite o request gravado e compara a response com a gravada — `pkg/service/replay/replay.go`; agregação pass/fail/no-tests num relatório de testrun — `pkg/models/testrun.go`), `step-ci` (a forma do replay de SUÍTE: por-teste `passed` boolean → resultado de workflow agregado → `exit(5)` no fail — `step-ci/src/index.ts`) e `mcp-typescript-sdk` (o padrão de tool MCP com `outputSchema`/`structuredContent` para devolver veredito consumível por máquina — `examples/server/src/mcpServerOutputSchema.ts`), para decidir ANTES de codar: como achar o golden, replay reconstruindo requests vs re-rodar Scenario, o catálogo de cenários com golden, o mapeamento de status, onde mora `checkScenario`/`replaySuite`, e a web vs-golden. Mínimo 2 referências independentes (keploy + step-ci + MCP SDK + baseline Hodor). Plano sugerido: `.claude/knowledge-base/discoveries/plans/m6-golden-gate-plan.md` (a criar via `/discover-plan`).

## Context

M6 (`ROADMAP.md:206`, depende de M2/M3/M5) pede: (1) conceito de **golden run** — `findGoldenRun(scenarioKey)` = run mais recente cujo cenário tem verdict `approved` (generaliza `findPreviousRun` do M5 de "anterior" para "último aprovado"; `null` se nunca aprovado) (`ROADMAP.md:212`); (2) tool MCP **`check_scenario`** que executa um cenário contra o serviço atual e retorna estruturado `{ status: "ok" | "regression" | "no_baseline", diff }` comparando vs golden — **nunca auto-aprova** (`ROADMAP.md:214`); (3) **replay de SUÍTE** — roda todos os cenários que têm golden e devolve relatório agregado pass/fail + diff (o gate que o agente invoca antes de declarar uma mudança pronta) (`ROADMAP.md:216`); (4) **web** — diff compara "vs golden aprovado" (além de vs anterior); listagem marca regressões vs baseline (`ROADMAP.md:218`). Riscos declarados (`ROADMAP.md:222-224`): (#1) golden stale / cenário editado (a `scenarioKey` muda → golden órfão) — mitigar avisando "sem baseline para esta versão do cenário" em vez de comparar contra um golden de outra forma; (#2) `check_scenario` re-executa contra o serviço real — sem env/secrets (M7) só cobre endpoints sem auth — declarar o teto honestamente e tratar como dependência do M7.

**Baseline (o que já existe, M0-M5):**

- `src/core/runHistory.ts:27` — `scenarioKey(env)` = `name ?? sha256(stableStringify(steps[].{method,url}))` (`:27-29`); `compareRuns:34` ordem total (createdAt, desempata runId); `findPreviousRun(curr, dir):63` = run anterior do mesmo `scenarioKey` por ordem total; **`pruneRunHistory:90`** já lê `verdicts/{id}.json` via `hasVerdict:118` e PINA runs aprovados (`:101-104` "approved never rotates") — **o M6 generaliza essa MESMA query `hasVerdict` para `findGoldenRun`**.
- `src/core/diffRuns.ts:78` — `diffRuns(prev, curr): RunDiff` PURO; lê `noise` dos PRÓPRIOS envelopes (`prev.noise ?? []` `:79`, `curr.noise ?? []` `:80`); normaliza ambos (`normalizeRun` `:82-83`), mascara body por step (`maskNoise`), compara campo-a-campo; `RunDiff = {steps[], stepCountChanged, noiseChanged, hasRegression}` (`:23-30`); `hasRegression` (`:88-90`) = stepCount mudou OU algum step com status/body/header diff. **Reusável SEM modificação para vs-golden.**
- `src/core/runScenario.ts:21` — `runScenario(scenario, deps?)`: executa steps EM ORDEM, interpola variáveis capturadas, reusa `executeRequest` do M0 (`:32`); falha de rede num step ABORTA o cenário (propaga `RequestExecutionError` `:31`); produz `RunEnvelope` propagando `scenario.noise` ao envelope (`:46`).
- `src/core/verdict.ts:38` — `loadVerdict(runId, dir)` lê `verdicts/{runId}.json`; ausente → `null` (`:46`); `Verdict = {runId, verdict:"approved"|"rejected", note?, decidedAt}` (`:11-16`); `defaultVerdictsDir():22` (`verdicts/`, env `HODOR_VERDICTS_DIR`).
- `src/core/draftStore.ts:53` — `DraftSchema = ScenarioSchema.extend({provenance})`; drafts COMMITÁVEIS em `drafts/{id}.json` (`:60`); `listDrafts`/`loadDraft` exportados (`core/index.ts:51`). **É o catálogo de Scenarios autorados/gerados — a fonte dos asserts/captures specs que o run NÃO guarda.**
- `src/core/scenarioSchema.ts:51` — `ScenarioSchema = {schemaVersion:1, name, provenance?, noise?, steps[].min(1)}`; `ScenarioStep:38` = `{name, request:{method,url,headers?,body?}, captures?, asserts?}`. O cenário CARREGA asserts/captures; o `RunEnvelope` NÃO (só o request executado + response — `runSchema.ts`).
- `src/web/server.ts:102` — `GET /runs/:id/diff` (`:101-112`): carrega run, `findPreviousRun(curr, dir):110`, `diffRuns(prev, curr):111`, `renderDiff(curr, prev, diff):112`. `scenarioKey` vem do run carregado, NUNCA da URL (`:109` — anti-traversal). `RUN_ID_RE` allowlist.
- `src/mcp/server.ts:56` — `buildServer()`; tools `run_request`/`run_scenario`/`save_scenario_draft`; `run_scenario:104` chama `runScenario` → `persistRun` → `pruneAfterPersist` (M5); padrão de runtime metric em stderr (`:80`, pillar c); `outputSchema: RunEnvelopeSchema.shape` (`:73`) publica o contrato estruturado.

Restrições: `architecture.md` §1-§2 (lógica no core, MCP/web são adaptadores); `parsimony-ladder.md` (rung 4 — reusar `diffRuns`/`runScenario`/`runHistory`/`loadVerdict` já instalados antes de qualquer dep nova); `testing.md` §2/§6 (core puro testável; integração na fronteira).

## Objective

Decidir, ANTES de codar: (a) **como achar o golden** (generalizar `findPreviousRun` filtrando por verdict `approved`, reusando o `hasVerdict` que `pruneRunHistory` JÁ usa); (b) **replay: reconstruir request a partir de `golden.steps[].request` vs re-rodar o `Scenario` original** — a decisão central, dado que o golden RunEnvelope tem requests EXECUTADOS mas NÃO os asserts/captures specs; (c) o **catálogo de cenários com golden** para o replay de suíte (iterar `runs/` agrupando por `scenarioKey`, achar o aprovado mais recente); (d) o **mapeamento de status** `{ok|regression|no_baseline}` ao `RunDiff.hasRegression` e ao caso "scenarioKey órfão" (risco #1); (e) **onde mora `checkScenario`/`replaySuite`** (core puro) + adaptador MCP fino; (f) a **web vs-golden**. Tudo de modo que o veredito seja consumível por máquina (DoD #2), nunca auto-aprove (humano no gate), e o teto sem-auth seja declarado (risco #2). ZERO dep nova esperada.

## Coverage Corner 1 — Integration Tests

**Pergunta (Q-IT):** Como as referências testam a fronteira "executa cenário → compara vs golden → veredito" e o que isso prescreve para os testes de integração do M6?

- **keploy** estrutura o replay como um LOOP por testcase (`pkg/service/replay/replay.go:1592` `for idx, testCase := range testsToRun`): para cada um, `SimulateRequest` re-emite o request gravado (`replay.go:1685`, `pkg/service/replay/hooks.go:40` → `pkg.SimulateHTTP` `hooks.go:86`), compara a response atual com a gravada via `CompareHTTPResp` (`replay.go:2948`) e ATRIBUI status: `testPass → TestStatusPassed` (`replay.go:1918`), senão `TestStatusFailed` (`replay.go:1928`), ou `TestStatusObsolete` quando há mock-mismatch (`replay.go:1925`). O resultado por teste vira `TestResult{Status, TestCaseID, Res, Noise, Result}` (`pkg/models/testrun.go:43`). **Lição:** o veredito é POR cenário (pass/fail) derivado de um diff response-vs-golden; o "golden" é o artefato gravado, não um arquivo separado.
- **keploy** trata o caso "SEM testes" explicitamente: `len(testCases) == 0 → TestSetStatusNoTestsToRun` (`replay.go:947-970`, status `"NO_TESTS_TO_RUN"` `pkg/models/testrun.go:205`) — um estado de PRIMEIRA CLASSE, distinto de pass/fail. **Mapeia direto ao `no_baseline` do Hodor (risco #1).**
- **step-ci** mostra a forma do replay de SUÍTE: cada teste emite `test:result` com `test.passed` boolean (`step-ci/src/index.ts:21-22`), o workflow agrega em `workflow:result` (`:29`) e o processo sai com `exit(5)` SSE `!result.passed` (`:31`). **Lição:** a suíte é a soma dos pass/fail por cenário; o "gate" é o booleano agregado (o agente lê `allOk`).

**Aplicação ao Hodor (testing.md §2/§6 — integração na fronteira):**

- `check_returns_ok_when_current_run_matches_golden` — cenário cujo golden aprovado e o run atual são idênticos sob noise → `{status:"ok", diff:hasRegression=false}`. Piso (espelha `TestStatusPassed` `replay.go:1918`).
- `check_returns_regression_when_status_diverges_from_golden` — golden status 200, serviço atual 500 → `{status:"regression", diff:hasRegression=true}` (espelha `TestStatusFailed` `replay.go:1928`).
- `check_returns_no_baseline_when_scenario_never_approved` — cenário sem nenhum run aprovado → `{status:"no_baseline", diff:null}` (espelha `NoTestsToRun` `replay.go:947`; risco #1).
- `check_returns_no_baseline_when_scenario_edited_since_approval` — cenário editado (method/url de um step mudou → nova `scenarioKey`) → golden órfão → `{status:"no_baseline"}` com aviso "sem baseline para esta versão do cenário" — **o teste-guarda do risco #1** (NÃO compara contra o golden da versão antiga).
- `check_never_writes_a_verdict` — após `check_scenario`, `verdicts/{newRunId}.json` NÃO existe (nunca auto-aprova; humano no gate — DoD #2).
- `find_golden_returns_most_recent_approved_run_of_scenario` — dados 3 runs do mesmo cenário (aprovado / rejeitado / aprovado-mais-novo), `findGoldenRun` retorna o aprovado MAIS RECENTE (espelha `getLatestTestRunID` ordenado, mas filtrando por verdict approved).
- `find_golden_returns_null_when_only_rejected_runs_exist` — só runs rejeitados → `null` (rejeitado ≠ baseline).
- `replay_suite_aggregates_pass_fail_per_scenario_with_golden` — N cenários, M com golden → relatório com `{total:M, ok, regression, noBaseline}` + diff por cenário; cenários SEM golden contam como `noBaseline`, não como fail (espelha step-ci `passed` agregado `index.ts:29` + keploy `GetTestRunTotals` `status.go:39`).
- `replay_suite_allOk_false_when_any_scenario_regresses` — uma regressão → `allOk=false` (o gate; espelha `exit(5)` step-ci `index.ts:31`).

## Coverage Corner 2 — Dependencies

**Pergunta (Q-DEP):** Precisamos de lib nova (replay, orquestração de suíte, agregação)? O que as referências usam e o que o Hodor reusa?

- **keploy** NÃO usa lib de replay/regressão externa — o loop de testcase (`replay.go:1592`), a comparação (`CompareHTTPResp` `replay.go:2948`) e a agregação (`printSummary` `replay.go:3229`, `GetTestRunTotals` `status.go:39`) são código próprio sobre os modelos do `pkg/models`. A seleção do "mais recente" é `strconv.Atoi`/sort sobre o sufixo do run-id — stdlib.
- **step-ci** delega ao `@stepci/runner` (`index.ts:5`) mas a AGREGAÇÃO que importa para o M6 (`test.passed` → `result.passed` → exit) é um `EventEmitter` stdlib + booleano (`index.ts:20-32`) — sem dep de agregação.
- **mcp-typescript-sdk** — a tool com veredito estruturado usa só `registerTool` + `outputSchema`/`structuredContent` (`examples/server/src/mcpServerOutputSchema.ts:17,25,46,66`), o MESMO padrão que `run_scenario` já usa (`src/mcp/server.ts:104-128`). Zod (já dep) descreve o `outputSchema`.

**Decisão Hodor (Rule 9 / parsimony rungs 1-4):**

- **ZERO dep nova.** `checkScenario` = `runScenario` (M1, já existe) + `findGoldenRun` (generaliza `findPreviousRun`, M5) + `diffRuns` (M5, já existe e já lê noise dos envelopes) + mapeamento de status (3-way switch trivial). `replaySuite` = iterar o catálogo de cenários + `checkScenario` por cenário + somar contadores (como `GetTestRunTotals` `status.go:39`). Tudo composição de funções core já instaladas (rung 4).
- **NÃO escrever um motor de replay** (rung 1) — o Hodor JÁ tem o motor (`runScenario`); o M6 só adiciona "compare o resultado vs golden". `node:crypto`/`fs` stdlib (já usados em `runHistory.ts:2`, `verdict.ts:1`) cobrem identidade e I/O.
- **zod** (já dep) descreve o `outputSchema` da tool `check_scenario` (veredito consumível por máquina — DoD #2). Nenhuma dep de validação nova.

## Coverage Corner 3 — Tools

**Pergunta (Q-TOOL):** Onde mora o catálogo de cenários com golden? Quantas tools MCP novas? Qual o shape do veredito consumível por máquina?

- **keploy** cataloga por DIRETÓRIOS — testsets em pastas, cada `test-set-N/tests/*.yaml` é um testcase; `GetAllTestSetIDs` (`replay.go:906`) lista os testsets; `GetTestCases` (`replay.go:910`) lê os testcases de um testset. O catálogo É o filesystem; o "golden" de cada testcase é o próprio arquivo gravado. A seleção do run anterior é `getLatestTestRunID` (sort sobre run-ids).
- **Hodor**: dois candidatos a catálogo. (a) `drafts/` (M4) — Scenarios COMMITÁVEIS com asserts/captures specs (`draftStore.ts:60`, `listDrafts`); (b) `runs/` agrupado por `scenarioKey` (M5) — runs executados, alguns aprovados. O `runs/` tem os requests mas NÃO os specs; `drafts/` tem os specs mas pode não ter golden. A INTERSEÇÃO (Scenario do draft + golden run do mesmo `scenarioKey`) é o catálogo do replay de suíte.

**Decisão Hodor (KISS — catálogo = `drafts/` ∩ golden de `runs/`; 1 tool MCP nova; veredito zod-tipado):**

- **Catálogo do replay de suíte = os Scenarios em `drafts/` que TÊM um golden** (`findGoldenRun(scenarioKey(draft)) !== null`). Para CADA draft, `replaySuite` re-executa via `runScenario` (precisa dos asserts/captures specs — só o draft os tem) e compara vs o golden. Cenários sem golden → `no_baseline` (contados, não falham). Isto espelha keploy (catálogo = artefatos no filesystem) e reusa `listDrafts` (M4) + `findGoldenRun` (M6) — zero índice novo (rung 1: índice é YAGNI; o `runs/` é local/small).
- **1 tool MCP nova: `check_scenario`** (recebe um `Scenario` validado, re-executa, compara vs golden, devolve `{status, diff}`). O replay de SUÍTE pode ser uma SEGUNDA tool `replay_suite` (sem input — varre o catálogo) OU ficar só no core + CLI/web; recomenda-se expor `replay_suite` como tool porque o DoD #3 diz "o gate que o AGENTE invoca antes de declarar uma mudança pronta" — o agente precisa chamá-lo (ver D5). NENHUMA tool de "aprovar" — aprovação é o verdict humano (M2), nunca da tool (DoD #2).
- **Veredito consumível por máquina** = `outputSchema` zod (`structuredContent`), espelhando `mcpServerOutputSchema.ts:25,66` e o `run_scenario` existente (`server.ts:128`). `check_scenario` → `{ status: "ok"|"regression"|"no_baseline", diff: RunDiff|null, goldenRunId: string|null }`. `replay_suite` → `{ allOk: boolean, total, ok, regression, noBaseline, scenarios: [{name, status, goldenRunId, hasRegression}] }`.

## Coverage Corner 4 — Techniques

### T1 — Golden run: generalizar `findPreviousRun` filtrando por verdict `approved` (Q-golden, DoD #1, risco #1)

keploy: o "baseline" é o testcase GRAVADO (o golden É o artefato), e o "mais recente" é selecionado por sort sobre run-ids (`getLatestTestRunID`). O Hodor NÃO grava um "golden" separado — o golden é um run de `runs/` que recebeu verdict `approved`. **A query já existe meio-pronta:** `pruneRunHistory` (`runHistory.ts:90`) JÁ chama `hasVerdict(run.runId, verdictsDir)` (`:118`) para PINAR runs aprovados ("approved never rotates" `:101`). M6 reusa exatamente esse predicado.

**Aplicação ao Hodor:** `src/core/runHistory.ts` ganha `findGoldenRun(scenarioKey, runsDir, verdictsDir): Promise<RunEnvelope | null>`:
1. `loadAllRuns(runsDir)` (helper já existe, `:39` — tolera corrompidos).
2. Filtra por `scenarioKey(r) === key` (mesma identidade do M5).
3. Filtra por `loadVerdict(r.runId, verdictsDir)?.verdict === "approved"` (reusa `verdict.ts:38`; NÃO basta `hasVerdict` — um `rejected` tem verdict mas NÃO é golden; o predicado do golden é mais estrito que o pin do prune — ver D1 trade-off).
4. `.sort(compareRuns)` (ordem total já existe `:34`) e retorna o ÚLTIMO (mais recente). `null` se nenhum aprovado.

Risco #1 cai naturalmente: se o cenário foi editado, sua `scenarioKey` muda; o golden antigo tem a key ANTIGA; `findGoldenRun(novaKey)` não o encontra → `null` → status `no_baseline` (não compara contra golden de outra versão). O `name` (quando presente) é a key; editar o body/headers de um step NÃO muda a key (D4 do M5: key = `name ?? hash(method+url)`) — então só editar method/url/name órfana o golden, o que é o comportamento desejado (mudança de comportamento esperado ⇒ re-aprovar).

### T2 — `checkScenario`: re-rodar o Scenario (não reconstruir o request) + comparar vs golden (Q-replay, DoD #2)

**A decisão central do M6.** keploy faz **pure replay**: re-emite o request GRAVADO (`SimulateRequest` `hooks.go:40` usa `tc.HTTPReq` — o request do testcase) e a response gravada é o oráculo (`CompareHTTPResp` `replay.go:2948` compara contra `tc.HTTPResp`). Isso funciona em keploy porque o testcase é AUTOCONTIDO (request + response + noise no mesmo arquivo) e NÃO há captures inter-step resolvidos em runtime — keploy injeta mocks para tornar o replay determinístico.

O Hodor é DIFERENTE em dois pontos:
1. O golden RunEnvelope tem os requests JÁ RESOLVIDOS (interpolação do M1 já aplicada — `runScenario.ts:30` interpola ANTES de executar e guarda o request executado). Reconstruir o request a partir de `golden.steps[].request` e re-emitir via `executeRequest` PARECE possível — mas os captures inter-step quebram isso: se o step 2 usa `${{ token }}` capturado do step 1, o golden guardou o token JÁ RESOLVIDO (valor antigo); re-emitir o request gravado mandaria o token VELHO ao serviço atual, que provavelmente o rejeita (401) — um falso-positivo de regressão. keploy contorna com mocks; o Hodor (M6) NÃO tem mocks e re-executa contra serviço REAL.
2. O `check_scenario` recebe um `Scenario` (com asserts/captures specs) na fronteira da tool — então pode RE-EXECUTAR o cenário do zero (`runScenario`), recapturando variáveis frescas em cada step.

**Decisão:** `checkScenario` **RE-RODA o `Scenario`** (`runScenario`, M1) contra o serviço atual — NÃO reconstrói o request do golden. O golden serve só como o LADO ESQUERDO do `diffRuns(golden, novoRun)`. Isto resolve o problema dos captures inter-step (cada execução recaptura tokens frescos) e reusa o motor M1 inteiro. O golden é o ORÁCULO da response (como keploy), mas o request é re-derivado do Scenario vivo (diferente de keploy, por causa dos captures + ausência de mocks). `diffRuns` já normaliza ambos e mascara noise — então o diff é anti-flaky por construção.

### T3 — `replaySuite`: catálogo → checkScenario por cenário → agregar (Q-suíte, DoD #3)

keploy agrega num `TestReport{Total, Success, Failure, Obsolete, Ignored}` (`pkg/models/testrun.go:7-25`) por testset e soma no `printSummary` (`replay.go:3229`)/`GetTestRunTotals` (`status.go:39` → `total, passed, failed`). step-ci: `test.passed` por teste → `result.passed` agregado → `exit(5)` (`index.ts:21-31`).

**Aplicação ao Hodor:** `src/core/replaySuite.ts` — `replaySuite(deps): Promise<SuiteReport>`:
1. `listDrafts(draftsDir)` (M4 catálogo) — os Scenarios autorados/gerados.
2. Para cada draft: `golden = findGoldenRun(scenarioKey(draft))`. Se `null` → registra `{name, status:"no_baseline"}` (não executa — sem oráculo, executar não agrega valor; espelha keploy `NoTestsToRun` `replay.go:947`). Se golden existe → `checkScenario(draft)` (T2) → `{name, status, hasRegression, goldenRunId}`.
3. Agregar: `SuiteReport = {allOk, total, ok, regression, noBaseline, scenarios:[...]}`; `allOk = regression === 0` (cenários `no_baseline` NÃO derrubam o gate — são informativos; espelha keploy que conta obsolete separado de failed). PURO no core (`architecture.md` §2); o adaptador (MCP/CLI) decide o exit code (step-ci `exit(5)` `index.ts:31`).

Nota: re-executa contra serviço real ⇒ I/O não-determinístico, então `replaySuite` é uma função core que RECEBE as deps de execução (`RunScenarioDeps`) por injeção (DIP — `architecture.md` §2), testável com um `executeRequest` fake.

### T4 — Status mapping + teto sem-auth (Q-status, risco #1 e #2)

keploy mapeia `testPass` (booleano de `CompareHTTPResp`) → `TestStatusPassed/Failed` (`replay.go:1918-1928`), com `NoTestsToRun` como estado ortogonal (`replay.go:947`). O Hodor tem 3 estados, e o `RunDiff.hasRegression` (`diffRuns.ts:23`) já é o booleano pronto.

**Aplicação ao Hodor — mapeamento (D6):**
| Caso | `checkScenario` status | Derivação |
|---|---|---|
| golden existe E `diffRuns(golden, curr).hasRegression === false` | `"ok"` | espelha `TestStatusPassed` |
| golden existe E `hasRegression === true` | `"regression"` | espelha `TestStatusFailed` |
| `findGoldenRun === null` (nunca aprovado OU scenarioKey órfã por edição) | `"no_baseline"` | espelha `NoTestsToRun`; risco #1 |

**Teto sem-auth (risco #2, dependência M7):** `checkScenario` re-executa via `runScenario`, que executa o request COMO ESTÁ no Scenario (sem injeção de secrets — M7). Endpoints autenticados receberão requests sem credencial → 401/403 → marcados como `regression` (falso-positivo) OU o golden também foi gravado sem auth (improvável para endpoint protegido). **O blueprint declara HONESTAMENTE:** M6 cobre endpoints SEM auth; endpoints autenticados ficam fora até M7 (`ROADMAP.md:236` "Desbloqueia o teto do M6"). O report da suíte e o doc da tool DEVEM declarar esse teto (não silenciar — `CLAUDE.md` §3 honestidade). Mitigação no MVP: nenhuma técnica — só a declaração explícita (a solução é M7).

## Cross-cutting Comparison

| Dimensão | keploy | step-ci | mcp-typescript-sdk | Decisão M6 (Hodor) |
|---|---|---|---|---|
| O que é o golden | testcase gravado (request+response+noise) é o oráculo (`replay.go:2948`) | response gravada do workflow | n/a | run de `runs/` com verdict `approved` (D1) |
| Como achar o golden | sort sobre run-ids (`getLatestTestRunID`) | n/a | n/a | `findGoldenRun` = `findPreviousRun` + filtro `verdict==approved` (`runHistory.ts:90` reusa `hasVerdict`) |
| Replay re-emite o quê | o request GRAVADO (`SimulateRequest` `hooks.go:40`) + mocks | re-roda o workflow | n/a | **re-roda o Scenario** (`runScenario`), por causa dos captures inter-step + ausência de mocks (D2) |
| Comparação | `CompareHTTPResp` próprio (`replay.go:2948`) | igualdade de asserts | n/a | `diffRuns(golden, novoRun)` (M5, reuso total — já lê noise) |
| Status por cenário | Passed/Failed/Obsolete (`replay.go:1918-1928`) | `test.passed` booleano | n/a | `ok`/`regression`/`no_baseline` (D6) |
| Sem baseline | `NoTestsToRun` (`replay.go:947`) | n/a | n/a | `no_baseline` (1ª classe; risco #1) |
| Catálogo da suíte | testsets em diretórios (`GetAllTestSetIDs` `replay.go:906`) | arquivos de workflow | n/a | `drafts/` ∩ golden de `runs/` (D3) |
| Agregação | `GetTestRunTotals` total/passed/failed (`status.go:39`) | `result.passed` → `exit(5)` (`index.ts:31`) | n/a | `SuiteReport{allOk, total, ok, regression, noBaseline}` (D5) |
| Veredito p/ máquina | YAML report | exit code | `outputSchema`/`structuredContent` (`mcpServerOutputSchema.ts:25,66`) | tool MCP `check_scenario`/`replay_suite` com `outputSchema` zod (D4) |
| Auto-aprova? | n/a (record é separado) | n/a | n/a | **NUNCA** — só verdict humano (M2); DoD #2 (D4) |

## ADRs

### D1 — `findGoldenRun(scenarioKey)` no `runHistory.ts`: generaliza `findPreviousRun` filtrando por verdict `approved` (reusa o predicado que `pruneRunHistory` já usa)

**Decision:** adicionar a `src/core/runHistory.ts` a função `findGoldenRun(scenarioKey: string, runsDir = defaultRunsDir(), verdictsDir = defaultVerdictsDir()): Promise<RunEnvelope | null>` que: carrega todos os runs (`loadAllRuns` `:39`, já existe), filtra pelos do mesmo `scenarioKey`, mantém apenas aqueles cujo `loadVerdict(runId, verdictsDir)?.verdict === "approved"`, ordena por `compareRuns` (`:34`, já existe) e retorna o mais recente (`null` se nenhum). Exportar por `core/index.ts` ao lado de `findPreviousRun`.

**Rationale:** o DoD #1 (`ROADMAP.md:212`) pede explicitamente "generaliza o `findPreviousRun` do M5 de 'anterior' para 'último aprovado'". `pruneRunHistory` (`runHistory.ts:90`) JÁ tem a query meio-pronta: `hasVerdict(run.runId, verdictsDir)` (`:118`) pina runs aprovados ("approved never rotates" `:101`). M6 reusa o MESMO `verdictsDir`/`loadVerdict` (parsimony rung 4 — código já instalado; Rule 9). keploy seleciona o golden por sort sobre run-ids (`getLatestTestRunID`); o Hodor seleciona por `compareRuns` (ordem total já testada no M5) + filtro de verdict — a identidade do golden é "aprovado + mais recente do cenário", não o id da execução.

**Alternatives considered:** (a) reusar `hasVerdict` direto (predicado do prune) — REJEITADO: `hasVerdict` é true para `rejected` também; o golden exige `verdict === "approved"` estritamente (um run rejeitado NÃO é baseline). Por isso D1 usa `loadVerdict().verdict`, não `hasVerdict`. (b) gravar um arquivo `golden/{scenarioKey}.json` apontando para o golden — REJEITADO (índice derivável é YAGNI; `runs/` é local/pequeno; um índice introduz invalidação/staleness que o risco #1 já pune). (c) golden = run anterior aprovado vs último aprovado-ABSOLUTO — escolhido o último aprovado absoluto (o baseline é o melhor estado conhecido-bom, não o penúltimo).

**Consequences:** golden derivado de `runs/` + `verdicts/` sem novo storage; reusa `loadAllRuns`/`compareRuns`/`loadVerdict`; risco #1 (cenário editado → key órfã → `null` → `no_baseline`) cai sem código extra; campo nenhum novo no schema.

### D2 — `checkScenario` RE-RODA o `Scenario` (via `runScenario`), NÃO reconstrói o request do golden; o golden é só o lado esquerdo de `diffRuns`

**Decision:** `src/core/checkScenario.ts` exporta `checkScenario(scenario: Scenario, deps?: RunScenarioDeps): Promise<CheckResult>`. Passos: (1) `key = scenarioKey(buildEnvelopeShapeOf(scenario))` — a mesma identidade do M5; (2) `golden = findGoldenRun(key)` (D1); (3) se `null` → `{status:"no_baseline", diff:null, goldenRunId:null}`; (4) senão `curr = await runScenario(scenario, deps)` (RE-EXECUTA, M1); (5) `diff = diffRuns(golden, curr)` (M5); (6) status = `diff.hasRegression ? "regression" : "ok"` (D6). NUNCA grava verdict. Persistir o `curr` em `runs/` (como `run_scenario` faz) é opcional — recomendado para o humano poder aprovar depois (ver Consequences).

**Rationale:** a decisão central do escopo. keploy faz pure replay (re-emite o request gravado + mocks — `SimulateRequest` `hooks.go:40`) porque o testcase é autocontido e determinístico via mocks. O Hodor NÃO pode reconstruir o request do `golden.steps[].request` e re-emitir porque (i) os captures inter-step do M1 (`runScenario.ts:30,37-39`) gravaram valores JÁ RESOLVIDOS no golden (ex.: um `token` capturado do step 1); re-emitir o request gravado mandaria o token VELHO ao serviço atual → falso 401 → falsa regressão; (ii) o Hodor re-executa contra serviço REAL sem mocks (M6 não tem record/replay de dependências). Re-rodar o `Scenario` (que `check_scenario` recebe com os asserts/captures specs na fronteira da tool) recaptura variáveis frescas em cada execução, resolvendo os captures inter-step. O golden continua sendo o ORÁCULO da response (como keploy), mas o request é re-derivado vivo. `diffRuns` (M5) já normaliza + mascara noise dos DOIS lados (`diffRuns.ts:79-83`) ⇒ anti-flaky de graça.

**Alternatives considered:** (a) reconstruir e re-emitir `golden.steps[].request` via `executeRequest` (pure replay à la keploy) — REJEITADO: quebra com captures inter-step (token velho → falso 401) e perde a re-validação dos asserts/captures vivos; só funcionaria para cenários single-step sem auth/captures (subconjunto pequeno). (b) `check_scenario` aceitar um `runId` de golden + re-emitir — REJEITADO (mesmo problema dos captures). (c) comparar o golden contra o último run JÁ persistido (sem re-executar) — REJEITADO: o DoD #2 diz "executa um cenário contra o serviço ATUAL" — o ponto é detectar regressão AGORA, não comparar dois runs antigos (isso já é o `/diff` do M5). (d) injetar mocks como keploy — REJEITADO (record/replay de dependências é um produto inteiro, fora do escopo M6; YAGNI).

**Consequences:** reusa `runScenario` (M1) + `findGoldenRun` (D1) + `diffRuns` (M5) inteiros; captures inter-step funcionam; teto: endpoints com auth dão falso `regression` até M7 (D6/risco #2). Recomenda-se persistir o `curr` (reusando `persistRun` + `pruneAfterPersist` do M5) para que o humano possa revisar o run e, se a mudança for legítima, APROVÁ-LO (promovendo-o a novo golden) — fechando o loop autor→aprovação→consumo sem auto-aprovar.

### D3 — Catálogo do replay de suíte = Scenarios em `drafts/` que têm golden (interseção `listDrafts` ∩ `findGoldenRun`); sem índice novo

**Decision:** o replay de suíte itera o catálogo de Scenarios via `listDrafts(draftsDir)` (M4, `draftStore.ts`/`core/index.ts:51`) — a única fonte que tem os asserts/captures specs necessários para re-executar (D2). Para cada draft, calcula `scenarioKey` e consulta `findGoldenRun` (D1). Cenários COM golden entram no replay; cenários SEM golden são reportados como `no_baseline` (contados, não executados, não falham). Nenhum índice/manifesto novo.

**Rationale:** o run gravado (`runs/`) tem o request mas NÃO os specs (`runSchema.ts` não guarda asserts/captures specs — só `asserts` RESULTADOS e `captures` valores); para RE-EXECUTAR (D2) precisamos do `Scenario` original, que vive em `drafts/` (M4, `draftStore.ts:60` COMMITÁVEL). keploy cataloga por diretórios de testset (`GetAllTestSetIDs` `replay.go:906`) — o Hodor cataloga por `drafts/` (mesma ideia: artefatos no filesystem são o catálogo). A interseção com golden espelha keploy rodando só testsets selecionados. Sem índice (rung 1 — derivável de `drafts/` + `runs/`; índice introduz staleness, que o risco #1 já pune).

**Alternatives considered:** (a) catálogo = `runs/` agrupado por `scenarioKey` — REJEITADO: runs não têm os specs para re-executar; só serviriam para comparar runs antigos (já é o `/diff` M5). (b) índice `suite.json` listando cenários — REJEITADO (YAGNI; staleness). (c) catálogo = `reviews/` (artefatos aprovados) — REJEITADO: `reviewArtifact` também não guarda os specs de capture (só normaliza o run, `reviewArtifact.ts:50`); `drafts/` é a única fonte dos specs. (d) exigir que o cenário seja passado ao `replay_suite` — REJEITADO: o DoD #3 diz "roda TODOS os cenários que têm golden" — a varredura é o ponto.

**Consequences:** o replay de suíte reusa `listDrafts` (M4) + `findGoldenRun` (D1); drafts são o catálogo versionado (alinha com "regras revisáveis no git"); cenários sem golden não poluem o gate (informativos).

### D4 — `checkScenario`/`replaySuite` moram no CORE puro; 1-2 tools MCP finas (`check_scenario`, `replay_suite`) com `outputSchema` zod; NUNCA auto-aprovam

**Decision:** a lógica vive em `src/core/checkScenario.ts` (`checkScenario`) e `src/core/replaySuite.ts` (`replaySuite`), funções puras que recebem deps de execução por injeção (DIP). O adaptador `src/mcp/server.ts` registra `check_scenario` (input = `ScenarioSchema.shape`; output = `CheckResultSchema.shape`) e `replay_suite` (input vazio/opcional; output = `SuiteReportSchema.shape`), delegando 100% ao core, com runtime metric em stderr (pillar c, como `server.ts:80`). NENHUMA tool grava verdict — a aprovação é exclusivamente o `saveVerdict` humano (M2), nunca a tool.

**Rationale:** `architecture.md` §1-§2 (lógica no core; MCP é adaptador) — o padrão já seguido por `run_scenario` (`server.ts:104` delega a `runScenario`). O `outputSchema`/`structuredContent` torna o veredito CONSUMÍVEL POR MÁQUINA (DoD #2) — exatamente o que `mcpServerOutputSchema.ts:25,66` demonstra e o que `run_scenario` já usa (`server.ts:128`). Duas tools porque o DoD separa "checar UM cenário" (#2) de "replay de SUÍTE — o gate que o agente invoca" (#3); ambos são ações do agente. "Nunca auto-aprova" é a tese central do Hodor (`verdict.ts:6` "revisão humana com decisão persistida") e o DoD #2 explicita — a tool só REPORTA, o humano DECIDE.

**Alternatives considered:** (a) `checkScenario` só no MCP (sem core) — REJEITADO (`architecture.md` §1; não-testável sem stdio). (b) uma só tool com flag `suite:bool` — REJEITADO (ISP: input shapes diferentes — um recebe Scenario, outro varre o catálogo; duas tools coesas > uma gorda). (c) `replay_suite` só como CLI (sem tool MCP) — possível, mas o DoD #3 diz "o gate que o AGENTE invoca" → o agente precisa da tool; CLI é enriquecimento. (d) tool que aprova o golden automaticamente quando `ok` — REJEITADO frontalmente (auto-aprovação viola DoD #2 e a tese do Hodor).

**Consequences:** core testável sem I/O; veredito estruturado para o agente; humano permanece o único aprovador; reuso do padrão de tool existente; exit code da suíte fica no adaptador (CLI), espelhando step-ci `exit(5)` (`index.ts:31`).

### D5 — `replaySuite` agrega `{allOk, total, ok, regression, noBaseline}` por cenário; `no_baseline` NÃO derruba o gate; PURO no core com deps injetadas

**Decision:** `replaySuite(deps): Promise<SuiteReport>` em `src/core/replaySuite.ts`: (1) `listDrafts` (D3); (2) por draft → `checkScenario` (D2) quando há golden, senão registra `no_baseline` sem executar; (3) `SuiteReport = { allOk: boolean, total: number, ok: number, regression: number, noBaseline: number, scenarios: Array<{ name, status, hasRegression, goldenRunId }> }` com `allOk = regression === 0`. Função pura: recebe `RunScenarioDeps` + dirs por parâmetro (DIP — testável com `executeRequest` fake). O adaptador decide o exit code (CLI: `exit(regression>0 ? 5 : 0)`).

**Rationale:** keploy agrega `Total/Success/Failure/Obsolete/Ignored` (`testrun.go:7-25`) com obsolete/ignored SEPARADOS de failed (`GetTestRunTotals` `status.go:39` devolve só total/passed/failed; obsolete não conta como fail). O Hodor espelha: `no_baseline` é como `NoTestsToRun`/obsolete — informativo, não falha (um cenário nunca aprovado não é uma regressão, é falta de baseline). `allOk = regression === 0` é o gate booleano (step-ci `result.passed` → `exit(5)` `index.ts:31`). Puro no core (`architecture.md` §2); deps injetadas porque re-executa contra serviço real (I/O não-determinístico — `testing.md` §6 injeta clock/RNG; aqui injeta o executor).

**Alternatives considered:** (a) `no_baseline` conta como fail — REJEITADO (puniria cenários novos/legítimos; o agente não conseguiria introduzir um cenário sem antes ter um golden — galinha-e-ovo). (b) executar cenários sem golden e reportar o run cru — REJEITADO (sem oráculo, o diff não existe; executar só gasta I/O). (c) `replaySuite` impuro (lê dirs e executa diretamente) — REJEITADO (`architecture.md` §2; não-testável). (d) paralelizar execução dos cenários — adiado (YAGNI; correção > velocidade no MVP; sequencial é determinístico e mais simples — keploy roda testcases em sequência no loop `replay.go:1592`).

**Consequences:** relatório agregado consumível (DoD #3); gate booleano para o agente; cenários novos não bloqueiam; core testável; exit code no adaptador.

### D6 — Mapeamento de status 3-way derivado de `RunDiff.hasRegression` + ausência de golden; teto sem-auth declarado honestamente (dependência M7)

**Decision:** o status de `checkScenario` é: `findGoldenRun === null → "no_baseline"`; senão `diffRuns(golden, curr).hasRegression === true → "regression"`, senão `"ok"`. O `outputSchema` da tool e o `SuiteReport` DECLARAM explicitamente, na documentação da tool e no report, o teto: "M6 cobre endpoints SEM autenticação; endpoints autenticados produzem falso `regression` (request sem credencial → 401/403) até o M7 injetar env/secrets (`ROADMAP.md:226-236`)". Sem técnica de mitigação no MVP além da declaração (a solução É o M7).

**Rationale:** `RunDiff.hasRegression` (`diffRuns.ts:23,88`) já é o booleano pronto — mapear é um switch trivial (KISS). 3 estados espelham keploy (`Passed`/`Failed` `replay.go:1918-1928` + `NoTestsToRun` ortogonal `replay.go:947`). O teto sem-auth é uma LIMITAÇÃO REAL (re-executa via `runScenario` → `executeRequest` sem injeção de secrets — M7); ocultá-la seria desonesto (`CLAUDE.md` §3) e geraria falsa confiança no gate. O ROADMAP já trata M7 como "desbloqueia o teto do M6" (`ROADMAP.md:236`) — então a dependência é reconhecida; o M6 entrega o gate COM o teto declarado, não um gate quebrado silenciosamente.

**Alternatives considered:** (a) detectar auth e marcar `skipped_auth` em vez de `regression` — adiado (heurística de "isto é 401 por falta de auth vs 401 legítimo" é frágil; YAGNI até M7 dar a injeção certa). (b) não declarar o teto — REJEITADO (desonestidade; `CLAUDE.md` §3 + `public-copy.md` §3). (c) bloquear `check_scenario` em endpoints com header `Authorization` — REJEITADO (o cenário pode legitimamente não precisar de auth; bloquear é prematuro). (d) status `regression` com nota "possível falso-positivo por falta de auth" — possível enriquecimento da `note`, mas o teto geral fica na doc da tool (não inflar cada resultado).

**Consequences:** status trivial e testável; gate honesto sobre seu alcance; M7 remove o teto sem mudar a assinatura de `checkScenario`; o agente sabe que endpoints autenticados não são cobertos ainda.

### D7 — Web: `GET /runs/:id/diff?vs=golden` (e listagem marca regressões vs baseline) reusando a rota e o `renderDiff` do M5

**Decision:** estender `src/web/server.ts` `GET /runs/:id/diff` (`:101-112`) com um parâmetro opcional `?vs=golden` (default mantém o comportamento M5 = vs anterior): quando `vs=golden`, localiza `findGoldenRun(scenarioKey(curr))` (D1) em vez de `findPreviousRun`, e chama `diffRuns(golden, curr)` (já reusa noise dos envelopes). `renderDiff` (`render.ts`, M5) ganha um rótulo "vs golden aprovado" vs "vs run anterior". A listagem (`GET /`) marca um cenário como "regressão vs baseline" quando o run mais recente diverge do seu golden (badge). Sem golden → "sem baseline para esta versão do cenário" (risco #1, mesma mensagem do `no_baseline`). `scenarioKey` vem SEMPRE do run carregado, nunca da URL (`:109` — anti-traversal preservado).

**Rationale:** DoD #4 (`ROADMAP.md:218`) pede "diff vs golden aprovado (além de vs anterior)" + "listagem marca regressões vs baseline". keploy separa cálculo (`CompareHTTPResp` `replay.go:2948`) de apresentação; o Hodor segue: `diffRuns`/`findGoldenRun` (core) vs `renderDiff` (web). Reusa a rota EXISTENTE (`server.ts:101`), o `diffRuns` (M5) e o `renderDiff` (M5) — só troca o lado esquerdo (anterior → golden) via query param e adiciona um rótulo. `architecture.md` §1: web é adaptador. SSR zero-framework mantido (decisão M2, `ROADMAP.md:130`).

**Alternatives considered:** (a) rota nova `/runs/:id/diff-golden` — REJEITADO (DRY; um query param `?vs=golden` reusa toda a rota). (b) diff no cliente — REJEITADO (SSR M2). (c) listagem recomputa diff de TODOS os runs no `GET /` — avaliar performance: marcar regressão exige, por cenário, achar o golden e o último run e diffar; aceitável para `runs/` local/pequeno (limite N=10 por cenário, M5 D5); se crescer, cachear no futuro (YAGNI agora). (d) mostrar o golden inteiro lado-a-lado — o `renderDiff` já mostra os dois lados (M5); só o rótulo muda.

**Consequences:** o humano vê "mudou vs o último estado aprovado" (o valor central do M6) reusando a infra do M5; listagem sinaliza regressões; anti-traversal preservado; SSR mantido; sem rota nova.

## Recommendations

1. **(D1)** `src/core/runHistory.ts`: adicionar `findGoldenRun(scenarioKey, runsDir?, verdictsDir?): Promise<RunEnvelope|null>` reusando `loadAllRuns`/`compareRuns` + `loadVerdict` (filtro `verdict==="approved"`, NÃO `hasVerdict`). Exportar por `core/index.ts` ao lado de `findPreviousRun`. Testes: aprovado-mais-recente; só-rejeitados → null; key órfã → null.
2. **(D2)** `src/core/checkScenario.ts`: `checkScenario(scenario, deps?): Promise<CheckResult>` = `findGoldenRun` → (sem golden) `no_baseline` | (com golden) `runScenario` + `diffRuns(golden, curr)` + mapeamento de status. NUNCA grava verdict. `CheckResultSchema` zod (`{status, diff, goldenRunId}`). Testes IT do Corner 1 (ok/regression/no_baseline/edited-scenario/never-writes-verdict).
3. **(D3)** Catálogo = `listDrafts` (M4) ∩ `findGoldenRun` — sem índice novo. Documentar que `drafts/` é a fonte dos asserts/captures specs (o run não os guarda).
4. **(D4)** `src/mcp/server.ts`: tool `check_scenario` (input `ScenarioSchema.shape`, output `CheckResultSchema.shape`) + tool `replay_suite` (output `SuiteReportSchema.shape`), delegando ao core, runtime metric em stderr; NENHUMA grava verdict. Caller de produção (wiring triad pillar a).
5. **(D5)** `src/core/replaySuite.ts`: `replaySuite(deps): Promise<SuiteReport>` puro (deps injetadas) = `listDrafts` → `checkScenario` por cenário com golden → agrega `{allOk, total, ok, regression, noBaseline, scenarios[]}`; `no_baseline` não derruba o gate. `SuiteReportSchema` zod. Testes IT: agregação; `allOk=false` numa regressão; cenário sem golden conta como `noBaseline`.
6. **(D6)** Mapeamento 3-way trivial sobre `RunDiff.hasRegression`; DECLARAR o teto sem-auth na doc da tool e no `SuiteReport` (dependência M7, `ROADMAP.md:236`). Métrica `checkScenarioCount`/`suiteReplayCount` em stderr (pillar c).
7. **(D7)** `src/web/server.ts`: `GET /runs/:id/diff?vs=golden` reusando `diffRuns`+`findGoldenRun`; `src/web/render.ts`: rótulo "vs golden aprovado"; listagem marca "regressão vs baseline"; sem golden → "sem baseline para esta versão do cenário". `scenarioKey` do run carregado (anti-traversal `:109`).
8. **(escopo — FORA do M6 / M7)** injeção de env/secrets para endpoints autenticados — **M7** (remove o teto do risco #2, `ROADMAP.md:226-236`); pure-replay reconstruindo o request do golden (à la keploy `SimulateRequest`) — REJEITADO (captures inter-step + ausência de mocks, ver D2); record/replay de dependências com mocks — produto inteiro, fora de escopo; classificação regression/fix/obsolete granular (keploy `TestStatus` 3-way `testrun.go:333`) — o MVP entrega ok/regression/no_baseline; paralelizar o replay de suíte — YAGNI (sequencial determinístico); auto-promover golden quando `ok` — REJEITADO frontalmente (viola DoD #2 — só o humano aprova); índice/manifesto de cenários — YAGNI (catálogo derivável de `drafts/`+`runs/`); detecção heurística de "401 por falta de auth" — adiado até M7 dar a injeção correta.

## Blocked questions (if any)

Nenhuma — as 6 perguntas do escopo respondidas com citações verificadas em ≥2 referências independentes (keploy `pkg/service/replay/replay.go` + `pkg/service/replay/hooks.go` + `pkg/models/testrun.go`; step-ci `src/index.ts` agregação/exit; mcp-typescript-sdk `examples/server/src/mcpServerOutputSchema.ts` outputSchema; baseline Hodor M0-M5). Negativas relevantes registradas: schemathesis NÃO tem modelo golden/baseline citável (só coverage de operações OpenAPI — `src/schemathesis/specs/openapi/coverage/_operation.py`; sem `baseline`/`regression`/`golden` no domínio de execução) — suprida por keploy `replay.go`. A descoberta DECISIVA do M6 (replay reconstruindo request vs re-rodar Scenario) foi resolvida por evidência: keploy faz pure replay com mocks (`hooks.go:40` re-emite `tc.HTTPReq`), mas o Hodor tem captures inter-step com valores resolvidos no golden (`runScenario.ts:30,37-39`) e NÃO tem mocks → re-rodar o `Scenario` (que `check_scenario` recebe com os specs) é o único caminho que não gera falsos-positivos (D2). O `pruneRunHistory` do M5 (`runHistory.ts:90` reusando `hasVerdict`/`verdicts/`) já tinha 80% da query do golden pronta — `findGoldenRun` é uma generalização mínima (D1).
