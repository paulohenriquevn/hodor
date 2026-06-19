# Blueprint: M5 — Regressão: diff entre runs + anti-flaky

> Discovery executada sobre `keploy` (o CORAÇÃO do M5 — field-normalization "noise" em `pkg/matcher/` + camada de comparação run-vs-run em `pkg/service/diff/`), `bruno` (`deepEqual` estrutural como fallback de comparação) e `jsonpath-plus`/`hurl` (resolução de jsonpath → localização para mascarar), para decidir ANTES de codar: onde moram as regras de noise, o algoritmo de diff, a identidade de cenário para achar o "anterior", a retenção de runs históricos, e o reuso de `jsonpath-plus`/`normalizeRun`/`stableStringify`. Mínimo 2 referências independentes (keploy + bruno + jsonpath-plus/hurl). Plano sugerido: `.claude/knowledge-base/discoveries/plans/m5-regression-diff-plan.md` (a criar via `/discover-plan`).

## Context

M5 (`ROADMAP.md:183`, depende de M3) pede: (1) execuções históricas de um cenário guardadas e **comparáveis** (run anterior vs run atual); (2) **diff** de comportamento (status/headers/body) entre dois runs computado e destacado na web app; (3) **normalização de campos voláteis — INCLUSIVE NO BODY** (timestamps, IDs aleatórios) reduzindo falsos positivos, com regras **inspecionáveis** (técnica de field-normalization do keploy). Riscos declarados (`ROADMAP.md:196-198`): (#1) normalização agressiva esconder regressões reais → regras explícitas/versionadas/revisáveis; (#2) volume de runs históricos sem limite → política de retenção desde o início.

**Baseline (o que já existe, M0-M4):**

- `src/core/runSchema.ts:52` — `RunEnvelopeSchema = {schemaVersion: z.literal(1), runId, createdAt, name?, provenance?, steps[].min(1)}`; `RunStepSchema:44` = `{request, response:{status,statusText,headers,body,timings}, asserts?, captures?}`; `CapturedResponseSchema:20` tem `body: z.string()` (corpo é STRING crua — não objeto).
- `src/core/normalizeRun.ts:118` — `normalizeRun(env): NormalizedRun` remove `response.timings`, filtra headers voláteis (`VOLATILE_HEADERS` set `:9` + prefixos `VOLATILE_HEADER_PREFIXES` `:38` `["x-amz-","x-amzn-","cf-"]` via `isVolatileHeader:60`) e redige headers de request sensíveis (`redactRequestHeaders:68`). **`normalizeStep:101` NÃO toca em `response.body`** (`body: step.response.body` copiado verbatim `:110`) — limitação consciente deferida ao M5 (comentário `reviewArtifact.ts:14` "NÃO muta o run bruto").
- `src/core/stableStringify.ts:22` — `stableStringify(v)` = JSON com chaves ordenadas recursivamente (`sortKeys:7`), arrays preservados, `+ "\n"`. Bytes idênticos ⇒ diff-amigável.
- `src/core/evalCapture.ts:10` — `evalJsonPath(path, body)` é o **ÚNICO** ponto de uso de `jsonpath-plus` no domínio (`import { JSONPath } from "jsonpath-plus"` `:1`); usa só path queries (`wrap:true`, sem eval/script). Body não-JSON / miss → `null`.
- `src/core/runStore.ts:45` — `persistRun(env, dir)` grava `runs/{runId}.json` (efêmero, `defaultRunsDir:15` via `HODOR_RUNS_DIR`); `loadRun:56` valida na fronteira (zod, fail-loud).
- `src/core/reviewArtifact.ts:50` — `buildReviewArtifact(env, verdict)` chama `normalizeRun` e grava `reviews/{runId}.json` commitável; `assertSafeRunId:71` (`SAFE_RUN_ID_RE:69`) anti path-traversal.
- `src/web/server.ts:99` — `GET /runs/:id` chama `loadRun`+`renderRun`; `:87` `GET /` chama `listRuns:211` (lê `runs/`, ordena por mtime desc `:244`, expõe `name`/`origin`/`stepCount`/`allAssertsPass`). `RUN_ID_RE` allowlist UUID `:27`.
- `src/web/render.ts:176` — `renderRun(env, verdict)`; `ListingItem:11` (`runId,name?,createdAt,stepCount,allAssertsPass,verdict,origin?`); `stepSection:135`, `headersTable:59`, `bodyBlock:67`, `MAX_BODY:31` (64 KB truncamento).

Restrições: `architecture.md` §1-§2 (lógica no core, MCP/web são adaptadores); `parsimony-ladder.md` (rung 2 stdlib / rung 4 dep-já-instalada antes de dep nova); `audit-trail-rotation.md` (modelo de retenção/arquivamento existente, mas voltado a artefatos de `agents/`/`knowledge-base/`, não a `runs/`).

## Objective

Decidir, ANTES de codar: (a) **onde moram as regras de noise** (parte do cenário, aditivo, vs config separada) e **em que vocabulário** (jsonpath para body, nome para header); (b) o **algoritmo de diff** run-vs-run (normalizar ambos os lados — headers via `normalizeRun` + body via mascaramento de jsonpath — e comparar); (c) a **identidade de cenário** para localizar o "run anterior do mesmo cenário"; (d) a **política de retenção** de runs históricos; (e) o **reuso** de `jsonpath-plus`/`normalizeRun`/`stableStringify` (zero dep nova); (f) a **web diff view**. Tudo de modo que o diff seja inspecionável (risco #1) e o histórico não cresça sem limite (risco #2).

## Coverage Corner 1 — Integration Tests

**Pergunta (Q-IT):** Como as referências testam a fronteira "dois runs → diff sob noise" e o que isso prescreve para os testes de integração do M5?

- **keploy** separa o teste em DUAS camadas que o Hodor herda: (i) o **match sob noise** por testcase (`pkg/matcher/http/match.go:30` `Match(...) (bool, *models.Result)`), onde `pass = jsonComparisonResult.IsExact()` (`match.go:127`) só roda no ramo JSON (`match.go:118`); (ii) a **comparação run-vs-run agregada** (`pkg/service/diff/diff.go:44` `ComputeDiff(report1, report2) *DiffResult`), que classifica cada par anterior→atual por `TestCaseID` (`diff.go:80-98`) em `Regressions`/`Fixes`/`StatusTransitions`/`Unchanged` (`DiffResult` `:29`). **Lição:** o diff de COMPORTAMENTO é distinto do diff de STATUS — keploy compara `TestStatus` por id (`diff.go:90` `before == Passed && after == Failed → Regression`); o Hodor precisa do diff de status/headers/body em si, mais rico, mas a estrutura "anterior vs atual, indexado por identidade estável" é a mesma.
- **bruno** mostra o fallback de comparação estrutural pura: `deepEqual(a, b)` (`bruno/packages/bruno-js/src/sandbox/quickjs/shims/test.js:206`) — recursivo, `keysA.length !== keysB.length → false` (`:211`), compara por chave (`:214`). É o que sobra quando NÃO há noise: igualdade profunda após parse.

**Aplicação ao Hodor (testing.md §2/§6 — integração na fronteira):**

- `diff_two_identical_runs_under_no_noise_yields_empty_diff` — dois runs byte-idênticos (após `normalizeRun`) → `DiffResult` sem mudanças. Prova o piso (espelha `Unchanged` do keploy `diff.go:88`).
- `diff_flags_status_change_as_regression` — run anterior status 200, atual 500 → diff marca mudança de status destacada (espelha `Regressions` `diff.go:90`).
- `noise_jsonpath_masks_volatile_body_field_so_diff_is_empty` — dois runs cujo body difere SÓ em `$.data.timestamp`, com `noise:["$.data.timestamp"]` no cenário → diff vazio. Prova a normalização de body (DoD #3) e o risco #1 (regra explícita).
- `noise_does_not_mask_a_real_regression_in_sibling_field` — mesmo noise em `$.data.timestamp`, mas `$.data.total` mudou 100→200 → diff DESTACA `$.data.total`. Prova que noise não esconde regressão real (risco #1 — o teste-guarda).
- `header_volatile_already_normalized_does_not_appear_in_diff` — `date`/`x-request-id` diferem entre runs → ausentes do diff (já removidos por `normalizeRun`). Reuso provado.
- `previous_run_of_same_scenario_is_located_by_identity` — dado N runs, `findPrevious(current)` retorna o run anterior MAIS RECENTE com a mesma identidade de cenário (espelha `getLatestTestRunID` `report.go:615` — ordena e pega o topo).
- `retention_keeps_last_N_runs_per_scenario` — após gravar N+1 runs do mesmo cenário, a poda mantém os N mais recentes (risco #2).

## Coverage Corner 2 — Dependencies

**Pergunta (Q-DEP):** Precisamos de lib nova (diff de JSON, json-pointer, mascaramento)? O que as referências usam e o que o Hodor reusa?

- **keploy** NÃO usa lib de diff externa para o body — escreve seu próprio walker recursivo (`matchJSONWithNoiseHandlingIndexed`, `pkg/matcher/utils.go:131`) sobre os dois `interface{}` parseados, e seu próprio índice de noise (`buildNoiseIndex:82` → `noiseIndex{entries:[]noiseEntry{keyLower, regexps}}` `:74-80`). Para regex de noise usa só a `regexp` stdlib (`getCompiled:39`).
- **bruno** usa `deepEqual` artesanal (`test.js:206`) — sem dep de diff.
- **`jsonpath-plus` (JÁ dep, `package.json` `jsonpath-plus@^10.4.0`)** suporta `resultType` ∈ `"value"|"path"|"pointer"|"parent"|"parentProperty"|"all"` (`node_modules/jsonpath-plus/src/jsonpath.js:108`, `:161` `this.resultType = opts.resultType || 'value'`). **Isto é a chave de parsimônia:** dá para resolver um jsonpath de noise a **localizações concretas** no objeto parseado (`resultType:"pointer"` ou `"all"`) e então MASCARAR aquelas posições — sem escrever um motor de jsonpath e sem dep nova.

**Decisão Hodor (Rule 9 / parsimony rungs 1-4):**

- **ZERO dep nova.** O diff é uma função core pura sobre dois objetos parseados; comparação por `stableStringify` (já existe) após mascaramento. Mascaramento de body via `jsonpath-plus` já instalado (rung 4 — reusar dep declarada). Regex stdlib (`RegExp`, já usado em `evalCapture.ts:32`) se um dia precisarmos de noise-por-regex (YAGNI no MVP — ver D2).
- **NÃO escrever um JSON-diff genérico tipo `jsondiffpatch`** (rung 1/2) — o Hodor só precisa de "iguais sob noise? se não, QUAIS paths divergem?". `stableStringify(maskedA) === stableStringify(maskedB)` resolve o "iguais?"; o "quais paths?" é um walker recursivo curto (conceito keploy `utils.go:131`, sem regex no MVP) OU, mais KISS, um diff textual linha-a-linha sobre o `stableStringify` de cada lado (ver D3 trade-off).
- **zod** (já dep) valida o campo `noise?` na fronteira do cenário; nenhuma dep de validação nova.

## Coverage Corner 3 — Tools

**Pergunta (Q-TOOL):** Onde moram as regras de noise — no cenário ou em config separada? Em que vocabulário? Há nova tool MCP?

- **keploy:** o noise mora DENTRO do testcase — `pkg/models/testcase.go:57` `Noise map[string][]string` (`json:"noise"`), shape `dotted-path → []regex`. Três escopos com precedência (`pkg/models/testrun.go:344-346`): `Noise` (por-teste) / `GlobalNoise` (global) / `TestsetNoise` (por testset). O vocabulário é **path dotado** (`body.user.id`) ou **chave global sem ponto** (`timestamp` = ignore em qualquer profundidade) — `JSONDiffWithNoiseControl` separa os dois (`utils.go:116-124`: sem ponto → `globalKeys`; com ponto → `pathNoise`). Header noise reusa o mesmo mapa, re-bucketizado por prefixo `header.`/`body.` (`match.go:104-112`).
- **schemathesis/bruno/hurl:** noise não é primeira-classe; o Hodor segue o modelo keploy (noise é dado do cenário).

**Decisão Hodor (KISS — noise no cenário, vocabulário jsonpath; 0 nova tool MCP no MVP):**

- **Regras de noise = parte do CENÁRIO, aditivas** (não config separada). Mesma escolha do keploy (noise inline no testcase, `testcase.go:57`), e alinhada ao precedente do Hodor de campos aditivos opcionais (`provenance` entrou aditivo no M4, `name` no M2). Config separada é YAGNI e desacopla a regra do artefato que ela protege (perde revisabilidade no mesmo arquivo — risco #1 pede regra revisável JUNTO do cenário).
- **Vocabulário = jsonpath para body, nome de header para header** — o Hodor JÁ fala jsonpath (`evalCapture.ts`/`AssertSpec source:"jsonpath:..."`); reusar (Rule 9). Diferente do keploy (path dotado), porque o Hodor já tem `jsonpath-plus` e já expressa asserts/captures em jsonpath — manter UM vocabulário (DRY) > introduzir dotted-path. Header noise: já coberto por `VOLATILE_HEADERS`/prefixos em `normalizeRun` (zero trabalho); noise de header POR CENÁRIO é extensão opcional (D2).
- **NENHUMA tool MCP nova no MVP.** O diff e a normalização de body são funções CORE consumidas pela web app (`GET /runs/:id/diff`). O agente não precisa de tool para "ver o diff" — quem vê o diff é o humano-revisor na web. (Uma tool MCP `diff_runs` para o agente comparar é YAGNI até haver demanda — rung 1.)

## Coverage Corner 4 — Techniques

### T1 — Field-normalization de body por noise jsonpath (Q-noise, DoD #3, risco #1)

keploy mascara o body sob noise caminhando os dois JSONs parseados em paralelo, consultando um índice de noise pré-compilado e lowercased a CADA nó (`matchJSONWithNoiseHandlingIndexed`, `utils.go:131`; índice `buildNoiseIndex:82`; lookup por **substring** `noiseIndex.match:100` `strings.Contains(keyLower, e.keyLower)`). Semântica de três níveis: chave sem ponto = ignore em qualquer profundidade (`globalKeys`, `utils.go:118`); path com lista de regex VAZIA = ignore a subárvore (`noiseEntry.regexps` vazio = "ignore subtree" `:76`); path com regex = noise SÓ quando o valor casa o regex (string-leaf `utils.go:141-156`). Headers idem (`CompareHeaders:1330`, regex via `MatchesAnyRegex`).

**Aplicação ao Hodor (versão KISS, sem regex no MVP):** `core/normalizeBody.ts` — `maskNoise(body: string, noise: string[]): string`:
1. `JSON.parse(body)` (se não-JSON → retorna body verbatim; mesma defesa de `evalJsonPath` `:11-17`).
2. Para cada jsonpath em `noise`, usar `JSONPath({path, json, resultType:"all"})` (já dá `pointer`/`parent`/`parentProperty` — `jsonpath.js:108`) para LOCALIZAR e substituir o valor por um sentinela estável `"<noise>"` (não deletar — preservar a forma, como keploy preserva a chave em headers redigidos `normalizeRun.ts:72`).
3. Re-serializar via `stableStringify` (já determinístico).

A LISTA de jsonpaths é explícita, no cenário, versionada e revisável (risco #1: o revisor vê exatamente o que foi mascarado no PR). O sentinela `"<noise>"` torna a máscara VISÍVEL no artefato (não silenciosa) — diferente de deletar, que esconderia que houve mascaramento. Sem regex-noise no MVP (YAGNI — `[]string` de jsonpaths cobre "timestamps/IDs aleatórios" do DoD; regex-por-valor é extensão futura, conceito keploy `utils.go:147` pronto para herdar).

### T2 — Diff run-vs-run: normalizar ambos os lados, comparar, destacar (Q-diff, DoD #2)

keploy: o diff agregado (`ComputeDiff`, `diff.go:44`) indexa cada teste por `TestCaseID` em dois mapas (`left`/`right`, `diff.go:55-72`), itera os IDs COMUNS (`commonIDs`, `diff.go:74-80`) e classifica a transição (`diff.go:88-97`). bruno: `deepEqual` (`test.js:206`) é o "iguais?" estrutural.

**Aplicação ao Hodor:** `core/diffRuns.ts` — função PURA `diffRuns(prev: RunEnvelope, curr: RunEnvelope, noise: string[]): RunDiff`:
1. Normaliza ambos: `normalizeRun(prev)` + `normalizeRun(curr)` (headers voláteis fora, timings fora — REUSO total).
2. Para cada step (par-a-par, por índice — runs do mesmo cenário têm os mesmos steps na mesma ordem), aplica `maskNoise(step.response.body, noise)` aos DOIS lados (T1).
3. Compara campo a campo: `status` (número), `statusText`, `headers` (objeto já filtrado), `body` (já mascarado+`stableStringify`). Um campo é "changed" se `stableStringify(maskedPrevField) !== stableStringify(maskedCurrField)`.
4. Retorna `RunDiff = { stepDiffs: Array<{ stepIndex, statusChange?:{before,after}, headerChanges?:[...], bodyChanged?:boolean, bodyDiff?:string }>, hasChanges: boolean }`.

O "destaque" (DoD #2) é responsabilidade do render (web), não do core. O core diz O QUE mudou; a web pinta. Classificação tipo keploy (regression vs fix) só faz sentido se houver pass/fail — o Hodor já tem `allAssertsPass` (`server.ts:250`); o diff pode anotar "asserts antes vs depois" como sinal de regressão, mas o diff PRIMÁRIO é status/headers/body cru (o DoD pede comportamento, não veredito).

### T3 — Identidade de cenário p/ achar o "anterior" (Q-identidade, DoD #1)

keploy: identidade é o `TestCaseID` (estável, `diff.go:60`) dentro de um `testSetID`; o "run anterior" é o `getLatestTestRunID` (`report.go:615`) — pega TODOS os run-ids (`GetAllTestRunIDs`, `report.go:616`), ordena pelo sufixo numérico de `test-run-N` (`report.go:626-638` `strconv.Atoi(TrimPrefix(...,"test-run-"))`) e devolve o último. O testcase carrega `Name` (`testcase.go:45`) e `Curl` (`testcase.go:60`) — a identidade NÃO é o run-id (que é único por execução), é o nome/conteúdo do cenário.

**Aplicação ao Hodor:** o `RunEnvelope` já tem `name?` (`runSchema.ts:58`, nome do cenário) — porém é OPCIONAL e pode colidir/faltar. **Identidade recomendada: `scenarioKey = name` quando presente, senão um hash determinístico do "esqueleto" do cenário** (`method+url` de cada step, via `stableStringify` dos `steps[].request.{method,url}` → SHA via `node:crypto` stdlib). Isto espelha keploy (identidade = conteúdo do cenário, não o id da execução) e usa `node:crypto` (já usado em `runStore.ts:2` `randomUUID`) — zero dep. O "run anterior" = o run com o mesmo `scenarioKey` e o `createdAt` imediatamente anterior ao atual (a web já lê todos os runs e ordena por mtime, `server.ts:244` — basta filtrar por `scenarioKey`). Persistir `scenarioKey` no envelope (campo aditivo opcional) evita recomputar e torna a listagem agrupável.

### T4 — Retenção de runs históricos (Q-retenção, risco #2)

keploy mantém TODOS os test-runs no report DB e oferece poda/seleção como operação (`getLatestTestRunID` para "o último"; `tools/normalise.go` para selecionar). Não há retenção automática agressiva — a unidade é `test-run-N` incremental. O Hodor hoje tem `runs/` EFÊMERO/gitignored (`runStore.ts:14`), o que por si já limita o crescimento commitado; mas o histórico COMPARÁVEL precisa SOBREVIVER entre execuções (DoD #1), então `runs/` deixa de ser puramente efêmero para o histórico do M5.

**Aplicação ao Hodor:** `audit-trail-rotation.md` é o modelo certo de política, mas seu escopo são artefatos de `agents/`/`knowledge-base/` (não menciona `runs/`). M5 ESTENDE o conceito a `runs/`: **reter os últimos N runs POR `scenarioKey`** (default `N=10`, env `HODOR_RUN_HISTORY_LIMIT`), podando os mais antigos do mesmo cenário ao gravar um novo (`core/runHistory.ts`: `pruneHistory(scenarioKey, dir, limit)`). Política explícita, configurável, aplicada no `persistRun` (ou num wrapper `persistRunWithHistory`). Espelha o "last 10 by mtime" que `audit-trail-rotation.md:18` já aplica a `.compaction-snapshots/`. Reter POR CENÁRIO (não global) garante que cenários raros não sejam expulsos por cenários frequentes. (Retenção por idade é alternativa rejeitada — ver D5.)

## Cross-cutting Comparison

| Dimensão | keploy | bruno | jsonpath-plus / hurl | Decisão M5 (Hodor) |
|---|---|---|---|---|
| Onde mora o noise | inline no testcase (`testcase.go:57` `Noise map[string][]string`) | n/a | n/a | **inline no cenário**, campo `noise?: string[]` aditivo |
| Vocabulário de noise | dotted-path + global key + regex (`utils.go:116-124`) | n/a | jsonpath (`jsonpath.js:161`) | **jsonpath** (reusa `evalCapture`; 1 vocabulário, DRY); regex-noise é YAGNI |
| Mascarar body | walker paralelo com índice noise (`utils.go:131`) | `deepEqual` (`test.js:206`) | `resultType:"pointer"/"all"` localiza nós (`jsonpath.js:108`) | localizar via `jsonpath-plus` `resultType:"all"`, substituir por `"<noise>"`, `stableStringify` |
| Algoritmo de diff | status por id (`ComputeDiff` `diff.go:44`) | igualdade estrutural | n/a | normalizar ambos (reuso `normalizeRun`) + mascarar body + comparar campo-a-campo via `stableStringify` |
| Identidade p/ "anterior" | `TestCaseID` + `getLatestTestRunID` (`report.go:615`) | n/a | n/a | `scenarioKey = name ?? hash(steps[].{method,url})` (`node:crypto`) |
| Retenção | todos os test-runs no DB; seleção manual | n/a | n/a | **últimos N por `scenarioKey`** (default 10, env), poda no persist |
| Diff visível? | regression/fix/transition (`DiffResult` `diff.go:29`) | n/a | n/a | core retorna `RunDiff`; web pinta (status/header/body destacados) |

## ADRs

### D1 — Regras de noise moram NO CENÁRIO como `noise?: string[]` de jsonpaths (aditivo), não em config separada

**Decision:** adicionar ao `ScenarioSchema` (`src/core/scenarioSchema.ts:51`) um campo OPCIONAL `noise: z.array(z.string()).optional()` — uma lista de jsonpaths (`$.data.timestamp`, `$.id`) que marcam campos voláteis do BODY a mascarar antes do diff. Propaga aditivamente ao `RunEnvelope` (como `provenance`/`name` fizeram). `schemaVersion` permanece `z.literal(1)`. Noise de HEADER por cenário fica fora do MVP (os voláteis comuns já são cobertos por `normalizeRun`).

**Rationale:** keploy guarda o noise INLINE no testcase (`pkg/models/testcase.go:57`), não em arquivo separado — mantém a regra JUNTO do artefato que ela protege, o que é exatamente o que o risco #1 ("regras explícitas, versionadas e revisáveis") pede: o revisor vê o noise e o cenário no mesmo PR. Vocabulário jsonpath (não dotted-path do keploy) porque o Hodor JÁ fala jsonpath em asserts/captures (`evalCapture.ts:10`, `AssertSpec source:"jsonpath:..."`) — UM vocabulário (DRY/Rule 9). Campo opcional ⇒ cenários M1-M4 seguem válidos (backward-compat provada 3x: `name`/`provenance`/`asserts`).

**Alternatives considered:** (a) config separada `noise.config.json` — rejeitado (desacopla a regra do cenário, perde revisabilidade no mesmo diff; YAGNI). (b) dotted-path como keploy — rejeitado (segundo vocabulário; o Hodor já tem jsonpath). (c) noise por regex-de-valor (keploy `utils.go:147`) — rejeitado no MVP (YAGNI; `[]string` de paths cobre "timestamps/IDs" do DoD; o conceito keploy fica pronto para herdar se surgir demanda). (d) noise global do projeto — coberto por `normalizeRun` (headers); body-global é YAGNI.

**Consequences:** cenários carregam suas regras de noise; o diff é reprodutível e auditável; sem dep nova; sem migração de schema.

### D2 — Mascaramento de body via `jsonpath-plus` (dep já instalada), substituindo por sentinela `"<noise>"` VISÍVEL — não deletar

**Decision:** `src/core/normalizeBody.ts` exporta `maskNoise(body: string, noise: string[]): string`. Tenta `JSON.parse(body)`; se falhar (não-JSON), retorna o body verbatim (mesma defesa de `evalJsonPath` `:11-17`). Para cada jsonpath, usa `JSONPath({path, json, resultType:"all"})` (`jsonpath-plus`, já dep) para localizar os nós e substitui cada valor encontrado por a string `"<noise>"`. Re-serializa com `stableStringify`. NÃO deleta os campos.

**Rationale:** `jsonpath-plus@10.4.0` já está no `package.json` e já é usado no domínio (`evalCapture.ts:1`); reusar (parsimony rung 4 — dep já instalada; Rule 9). `resultType:"all"` expõe `pointer`/`parentProperty` (`node_modules/jsonpath-plus/src/jsonpath.js:108`), suficiente para localizar e substituir sem escrever um motor de jsonpath. Substituir por sentinela (em vez de deletar) espelha a redação VISÍVEL do keploy/Hodor em headers (`normalizeRun.ts:71-72` preserva a chave, redige o valor) — torna o mascaramento auditável no artefato (o revisor vê `"<noise>"` e sabe que ali foi mascarado), atacando o risco #1 diretamente. Body crú é STRING (`runSchema.ts:23`), então parse→mask→re-stringify é o caminho natural.

**Alternatives considered:** (a) deletar os campos noise — rejeitado (mascaramento silencioso esconde que houve normalização; viola risco #1). (b) dep de JSON-mask/jsondiffpatch — rejeitado (Rule 9; `jsonpath-plus`+`stableStringify` já resolvem). (c) walker recursivo próprio à la keploy (`utils.go:131`) — rejeitado no MVP (mais código que reusar `jsonpath-plus`; KISS). (d) regex sobre o texto cru do body — rejeitado (frágil; o body é JSON estruturado, jsonpath é o casamento correto).

**Consequences:** body volátil mascarado de forma determinística, visível e revisável; zero dep nova; `evalJsonPath`/`stableStringify`/`normalizeRun` reusados; bodies não-JSON passam intactos (diff textual sobre eles, ver D3).

### D3 — `diffRuns(prev, curr, noise)` é função CORE pura: normaliza ambos (`normalizeRun` + `maskNoise`), compara campo-a-campo via `stableStringify`; o core diz O QUE mudou, a web pinta

**Decision:** `src/core/diffRuns.ts` exporta `diffRuns(prev: RunEnvelope, curr: RunEnvelope, noise: string[]): RunDiff`. Passos: (1) `normalizeRun` em ambos (headers voláteis + timings fora — REUSO); (2) `maskNoise` no body de cada step dos dois lados (D2); (3) por step (par-a-par por índice), comparar `status`/`statusText`/`headers`/`body` — campo "changed" sse `stableStringify(prevField) !== stableStringify(currField)`; (4) retornar `RunDiff = {stepDiffs: [{stepIndex, statusChange?, headerChanges?, bodyChanged, bodyDiffText?}], hasChanges}`. O destaque visual é do `render.ts`, não do core.

**Rationale:** a comparação keploy é por id estável com classificação (`ComputeDiff` `diff.go:44-101`); o Hodor adapta para "mesmo cenário, mesmos steps em ordem" → comparação posicional por step (mais simples que matching, KISS — os steps de um cenário são determinísticos e ordenados, `scenarioSchema.ts:57`). Reusar `normalizeRun` (já remove headers voláteis + timings) significa que o diff JÁ é anti-flaky para tudo que M3 cobriu; M5 só adiciona a camada de body. `stableStringify` como oráculo de igualdade (já determinístico) é mais KISS que um `deepEqual` novo, e dá de graça o "bodyDiffText" (diff textual linha-a-linha sobre os dois `stableStringify`, renderizável). Core puro = testável sem I/O (`architecture.md` §2; `testing.md` §2).

**Alternatives considered:** (a) matching de steps por nome (à la `TestCaseID`) — rejeitado no MVP (steps são ordenados e determinísticos; índice basta; se um step for inserido no meio o diff acusa desalinhamento, que é informação útil). (b) classificar regression/fix como keploy — adiado (o Hodor pode anotar `assertsBefore/After` como sinal, mas o DoD #2 pede diff de comportamento status/headers/body, não veredito binário; classificação é enriquecimento futuro). (c) diff no web layer — rejeitado (viola `architecture.md` §1: lógica no core). (d) lib de diff textual (`diff`/`diff-match-patch`) para o `bodyDiffText` — avaliar via `/deps-audit`; default é NÃO adicionar (o render pode mostrar os dois `stableStringify` lado a lado e deixar o browser/olho humano ver — KISS; lib de diff só se o UX exigir).

**Consequences:** uma função core testável; reuso máximo (`normalizeRun`+`maskNoise`+`stableStringify`); diff anti-flaky por construção (headers/timings/body voláteis já fora); web consome e pinta.

### D4 — Identidade de cenário `scenarioKey = name ?? sha256(stableStringify(steps[].request.{method,url}))`, persistida no envelope (aditivo)

**Decision:** definir `scenarioKey` para um run: se `env.name` presente, usar `name`; senão, computar `sha256` (via `node:crypto`, já importado em `runStore.ts:2`) de `stableStringify` da projeção `steps.map(s => ({method: s.request.method, url: s.request.url}))`. Persistir como campo OPCIONAL aditivo `scenarioKey?` no `RunEnvelope` para não recomputar e permitir agrupamento. O "run anterior" = run com mesmo `scenarioKey` e maior `createdAt` < `createdAt` do atual.

**Rationale:** keploy identifica o cenário pelo CONTEÚDO/nome do testcase (`testcase.go:45` `Name`, `:60` `Curl`), nunca pelo id da execução (que é único por run); o "anterior" é o último run-id ordenado (`getLatestTestRunID` `report.go:615-638`). O Hodor herda: `name` é o identificador humano (já existe, `runSchema.ts:58`), mas pode faltar (run_request do M0) ou colidir — o hash do esqueleto (method+url por step) é o fallback determinístico que dá identidade a QUALQUER run. `node:crypto` é stdlib (rung 2). A web já lê e ordena todos os runs (`server.ts:211-245`) — filtrar por `scenarioKey` é trivial.

**Alternatives considered:** (a) só `name` — rejeitado (opcional, pode faltar/colidir). (b) só hash do esqueleto — rejeitado (ignora o `name` humano que já existe e é mais legível para agrupar na UI). (c) hash incluindo body/headers do request — rejeitado (body/headers podem variar legitimamente entre execuções do "mesmo" cenário; method+url é a espinha estável, como keploy usa o testcase como unidade). (d) id incremental `run-N` como keploy — rejeitado (o Hodor usa `randomUUID`, `runStore.ts:31`; `createdAt` ISO já dá ordenação temporal).

**Consequences:** todo run tem identidade de cenário estável; "anterior vs atual" é uma query por `scenarioKey`+`createdAt`; agrupamento na listagem fica natural; campo aditivo (sem quebra).

### D5 — Retenção: manter os últimos N runs POR `scenarioKey` (default N=10, env `HODOR_RUN_HISTORY_LIMIT`), podando no persist

**Decision:** `src/core/runHistory.ts` exporta `pruneHistory(scenarioKey: string, dir: string, limit: number): Promise<string[]>` (remove os runs mais ANTIGOS do mesmo `scenarioKey` além do limite, retorna os removidos) e um `persistRunWithHistory(env, dir, limit)` que grava e então poda. Default `limit = 10`, override por `HODOR_RUN_HISTORY_LIMIT`. `runs/` passa a reter histórico (deixa de ser puramente efêmero para o que M5 compara), mas permanece gitignored por default (commitável é o `reviews/` pós-verdict).

**Rationale:** risco #2 ("volume sem limite") pede política DESDE O INÍCIO. `audit-trail-rotation.md:18` já estabelece o padrão "last 10 by mtime" para `.compaction-snapshots/` — M5 aplica o MESMO padrão a `runs/`, agora POR CENÁRIO (cenários raros não são expulsos por frequentes — o que uma poda global causaria). keploy retém todos os runs no DB sem poda agressiva, mas o Hodor é local/single-user (`ROADMAP.md:42`) e não tem um DB — arquivos crescem sem teto se não podarmos. Poda no persist (não num cron) é KISS: a política se aplica no único ponto de escrita.

**Alternatives considered:** (a) retenção por IDADE (>30 dias) — rejeitado como primário (um cenário não-executado há 31 dias perderia seu único baseline; "últimos N" garante sempre um anterior para comparar). Pode coexistir como teto secundário no futuro (YAGNI agora). (b) sem poda, `runs/` cresce — rejeitado (risco #2 explícito). (c) poda global (últimos N no total) — rejeitado (expulsa cenários raros). (d) mover antigos para `runs/archive/` como `audit-trail-rotation.md:23` faz com `agents/` — adiado (arquivar > deletar é mais seguro, mas YAGNI no MVP local; `pruneHistory` pode evoluir para mover em vez de deletar sem mudar a assinatura).

**Consequences:** histórico limitado e previsível por cenário; sempre há ≥1 anterior para comparar (até o limite); política explícita e configurável (risco #2); reusa o padrão de retenção já no projeto.

### D6 — Web diff view: rota `GET /runs/:id/diff` que compara o run com o ANTERIOR do mesmo `scenarioKey`; render destaca status/headers/body

**Decision:** adicionar ao `src/web/server.ts` a rota `GET /runs/:id/diff` (mesma allowlist `RUN_ID_RE` `:27`): carrega o run atual, localiza o anterior por `scenarioKey` (D4), chama `diffRuns(prev, curr, noise)` (D3, com `noise` do cenário do run — D1) e renderiza via novo `renderDiff(runDiff, prev, curr)` em `render.ts`. A view destaca: status mudado (badge vermelho/verde), headers adicionados/removidos/alterados, body com as linhas divergentes realçadas (sobre os dois `stableStringify`). A listagem (`GET /`) ganha um link "diff vs anterior" quando há um anterior. Sem anterior → mensagem "primeiro run deste cenário (sem baseline)".

**Rationale:** DoD #2 pede o diff "destacado na web app". keploy separa o cálculo (`ComputeDiff` `diff.go:44`) da apresentação (`printDiff` `diff.go:203` formata para stdout) — o Hodor segue: `diffRuns` (core, O QUE mudou) vs `renderDiff` (web, COMO mostrar). Reusa o padrão de rota existente (`GET /runs/:id` `server.ts:99` + `renderRun` `render.ts:176`), o escape anti-XSS (`escapeHtml` `render.ts:32`) e o truncamento (`MAX_BODY` `:31`). `architecture.md` §1: web é adaptador, não decide regra.

**Alternatives considered:** (a) diff entre dois runs ARBITRÁRIOS escolhidos pelo humano (`/diff?a=X&b=Y`) — útil, mas o DoD foca "anterior vs atual"; o picker arbitrário é enriquecimento (pode-se aceitar `?vs=<runId>` opcional, default = anterior automático). (b) diff no cliente (JS no browser) — rejeitado (a web é server-rendered ZERO-framework por decisão do M2, `ROADMAP.md:130`; manter SSR). (c) lib de diff visual — ver D3 trade-off (default sem dep).

**Consequences:** o humano vê, em segundos, o que mudou entre execuções (o valor central do M5); reuso do render/rota/escape existentes; SSR mantido; noise aplicado de forma visível.

## Recommendations

1. **(D1)** `src/core/scenarioSchema.ts`: adicionar `noise: z.array(z.string()).optional()` ao `ScenarioSchema` (manter `schemaVersion: z.literal(1)`); propagar aditivo a `RunEnvelopeSchema` (`runSchema.ts`) como `noise?` e `scenarioKey?`. Exportar por `core/index.ts`.
2. **(D2)** `src/core/normalizeBody.ts`: `maskNoise(body, noise)` reusando `jsonpath-plus` (`JSONPath` com `resultType:"all"`) + `stableStringify`; não-JSON → verbatim; sentinela `"<noise>"`. Testes: mascara `$.data.timestamp`; preserva irmãos; não-JSON intacto.
3. **(D3)** `src/core/diffRuns.ts`: `diffRuns(prev, curr, noise): RunDiff` reusando `normalizeRun` + `maskNoise` + `stableStringify`; comparação posicional por step; `RunDiff` tipado e exportado. Testes IT do Corner 1 (incl. o teste-guarda "noise não esconde regressão em campo irmão").
4. **(D4)** `src/core/scenarioKey.ts`: `scenarioKey(env): string` = `name ?? sha256(stableStringify(steps[].request.{method,url}))` via `node:crypto`; persistir no envelope no `buildRunEnvelope` (`runStore.ts:24`). `findPreviousRun(scenarioKey, currentCreatedAt, dir)` (core, lê `runs/`, valida com `loadRun`).
5. **(D5)** `src/core/runHistory.ts`: `pruneHistory(scenarioKey, dir, limit)` + `persistRunWithHistory`; default 10, env `HODOR_RUN_HISTORY_LIMIT`; aplicar no caller que grava runs (MCP `run_scenario`/`run_request`). Métrica `runsPrunedCount` em stderr (wiring triad pillar c).
6. **(D6)** `src/web/server.ts`: rota `GET /runs/:id/diff` (caller de produção do diff) + link na listagem; `src/web/render.ts`: `renderDiff(runDiff, prev, curr)` com destaque status/headers/body, reusando `escapeHtml`/`MAX_BODY`. Sem anterior → "sem baseline".
7. **(testes IT)** os 7 do Corner 1, com ênfase no guarda de risco #1 (`noise_does_not_mask_a_real_regression_in_sibling_field`) e na retenção (risco #2).
8. **(escopo — FORA do M5)** noise por REGEX-de-valor (keploy `utils.go:147`) — herdar só sob demanda; noise de HEADER por cenário (os voláteis comuns já estão em `normalizeRun`); classificação regression/fix tipo keploy (`DiffResult` `diff.go:29`) — enriquecimento futuro, o MVP entrega diff de comportamento cru; diff entre runs ARBITRÁRIOS (`?vs=`) — opcional além do "anterior automático"; lib de diff textual visual — só se `/deps-audit` + UX justificarem; arquivar (vs deletar) runs antigos em `runs/archive/` — evolução de `pruneHistory` sem mudar assinatura; tool MCP `diff_runs` para o agente — YAGNI (o diff é para o humano-revisor na web).

## Blocked questions (if any)

Nenhuma — as 5 perguntas do escopo respondidas com citações verificadas em ≥2 referências independentes (keploy `pkg/matcher/` + `pkg/service/diff/` + `pkg/models/`; bruno `deepEqual`; `jsonpath-plus` `resultType`; baseline Hodor). Negativas relevantes registradas: step-ci NÃO tem camada de diff/baseline citável neste clone (`grep` em `step-ci/src` só achou string de constants, sem `compare`/`baseline`/`regression`) — suprida por keploy `diff.go`; hurl tem `JsonPath` no AST (`hurl_core/src/ast/core.rs:303`) mas seu jsonpath é para asserts, não para mascarar noise — o vocabulário jsonpath é citável, o mascaramento não, suprido por `jsonpath-plus` `resultType` direto. keploy usa `node`-equivalente (Go) sem dep de diff externa, confirmando que diff próprio + stdlib é o caminho (Rule 9).
