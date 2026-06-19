---
slug: m5-regression-diff
milestone_id: M5
created_at: 2026-06-19
goal: Entregar o motor de regressão do Hodor — diff entre o run atual e o anterior do mesmo cenário, com normalização de campos voláteis (headers + body via jsonpath noise) e destaque na web app, provado por um teste E2E verde.
---

# Plan: M5 — Regressão: diff entre runs + anti-flaky

> **Version 1.1** (absorveu 4 MUST-FIX de `knowledge-base/reviews/m5-regression-diff-edge-cases-2026-06-19.md`: EC-1 retenção nunca apaga run com verdict/review aprovado — pinned, alinha `audit-trail-rotation.md`; EC-2 `limit` clamp `max(1,…)`; EC-3 ordem total `(createdAt, runId)`; EC-4 `scenarioKey` computado após `loadRun`, nunca da URL — `:id` permanece UUID validado). Baseado no blueprint SHIPPABLE `knowledge-base/discoveries/blueprints/m5-regression-diff-blueprint.md` (keploy: field-normalization "noise" + diff run-vs-run; bruno: deepEqual; jsonpath-plus: masking sem dep nova). Introduz o motor de regressão: regras de `noise` (jsonpaths) declaradas NO cenário (aditivo); `maskNoise` mascara paths voláteis do body com sentinela `"<noise>"` visível (reusa `evalJsonPath`); `diffRuns(prev, curr)` core puro normaliza ambos (`normalizeRun` p/ headers/timings + `maskNoise` p/ body) e compara por step (status/headers/body) via `stableStringify`; identidade de cenário `scenarioKey` permite achar o run anterior; retenção last-N por cenário (risco #2); web app destaca o diff. Fecha a limitação de body-noise deferida no M3. ZERO dependência nova (reusa `jsonpath-plus`, `normalizeRun`, `stableStringify`, `node:crypto`).

## Goal

> Entregar o diff de regressão entre o run atual e o anterior do mesmo cenário, normalizando campos voláteis (headers + body via jsonpath noise) com regras inspecionáveis, destacado na web app, measured by o teste E2E `e2e_m5_diff_detects_real_change_ignores_noise` retornando verde.

## Context

`ROADMAP.md` §M5 (depende de M3, `[x]`) pede: (1) execuções históricas de um cenário guardadas e comparáveis (anterior vs atual); (2) diff de comportamento (status/headers/body) computado e destacado na web app; (3) normalização de campos voláteis — INCLUSIVE no body (timestamps, IDs aleatórios) — reduzindo falsos positivos, com regras INSPECIONÁVEIS (field-normalization do keploy). Riscos: (#1) normalização agressiva esconder regressões reais — regras explícitas/versionadas/revisáveis; (#2) volume de runs históricos sem limite — retenção desde o início.

O blueprint fixou (D1-D6): noise mora no cenário como `noise?: string[]` (jsonpaths, aditivo); body mascarado via `jsonpath-plus` com sentinela visível; `diffRuns` core puro; `scenarioKey = name ?? sha256(...)`; retenção last-N por cenário; web diff view SSR. M0-M4 entregaram a base (`normalizeRun`, `stableStringify`, `evalJsonPath`, runs persistidos com `name`/`provenance`).

## Baseline Context (deep review of current state)

> Estado real pós-M4 (v0.5.0). Evidência: `git log` + `wc -l`. `runs/`+`verdicts/` gitignored; `reviews/`+`drafts/` commitáveis.

### Files that will be touched

| File | LoC hoje | Last commit | Por que existe | Invariante a preservar |
|---|---|---|---|---|
| `src/core/scenarioSchema.ts` | 72 | `4351af8` | `ScenarioSchema` (M1+M4) | add `noise?: string[]` OPCIONAL; `schemaVersion` permanece `1` (backward-compat) |
| `src/core/runSchema.ts` | 73 | `4351af8` | envelope (M0-M4) | add `noise?: string[]` OPCIONAL ao `RunEnvelopeSchema`; runs M0-M4 sem ele seguem válidos |
| `src/core/runStore.ts` | 44 | `4351af8` | `buildRunEnvelope` + persist/load | `buildRunEnvelope` ganha param `noise?` aditivo; `persistRun` inalterado (retenção é função à parte) |
| `src/core/runScenario.ts` | 46 | `4351af8` | engine multi-step → envelope | propaga `scenario.noise` ao envelope (como `provenance`); sem mudança de execução |
| `src/core/normalizeRun.ts` | 130 | `3a4bf36` | strip de voláteis (M3) | reusado por `diffRuns` p/ headers/timings; sem mudança |
| `src/core/evalCapture.ts` | 40 | `ec2928b` | `evalJsonPath` (único ponto de jsonpath-plus) | reusado/estendido p/ `maskNoise` (DRY — 1 vocabulário jsonpath) |
| `src/core/stableStringify.ts` | 24 | `1582c47` | JSON determinístico | reusado p/ comparar campos no diff |
| `src/core/maskNoise.ts` (NEW) | 0 | — | (a criar) mascara paths de noise no body JSON | nunca muta input; body não-JSON → inalterado; sentinela `"<noise>"` |
| `src/core/diffRuns.ts` (NEW) | 0 | — | (a criar) `diffRuns(prev, curr)` → `RunDiff` estruturado | core puro, sem I/O; normaliza ambos antes de comparar |
| `src/core/runHistory.ts` (NEW) | 0 | — | (a criar) `scenarioKey`, `findPreviousRun`, `pruneRunHistory` | identidade estável; retenção last-N por cenário |
| `src/core/index.ts` | 75 | `3a4bf36` | superfície pública (DIP) | add exports M5; preserva existentes |
| `src/mcp/server.ts` | 140 | `4b53dd5` | adaptador MCP | após `persistRun`, poda histórico (retenção); tools intactas |
| `src/web/server.ts` | 270 | `3a4bf36` | adaptador HTTP | nova rota `GET /runs/:id/diff`; rotas M2-M4 preservadas |
| `src/web/render.ts` | 270 | `326d4ee` | render HTML | `renderDiff` destaca status/headers/body; escape XSS mantido |
| `.gitignore` | 34 | `90e6e52` | ignora runs/, verdicts/ | inalterado (histórico vive em runs/, efêmero) |
| `CHANGELOG.md` | — | (release) | contrato público | entrada em `[Unreleased] § Added` |

### Current callers / dependents

- **`ScenarioSchema`**: caller `mcp/server.ts` (`run_scenario`/`save_scenario_draft` inputSchema). `noise?` aditivo — cenários M1-M4 seguem válidos.
- **`RunEnvelopeSchema`**: callers `runStore`/`reviewArtifact`/`web/render`/`mcp`. `noise?` opcional não quebra nenhum.
- **`buildRunEnvelope`**: callers `mcp/server.ts` (`run_request`), `runScenario.ts`. Novo param opcional ao final preserva ambos.
- **`evalJsonPath`** (`evalCapture.ts:10`): callers `evalCapture`, `evalAssert`. `maskNoise` reusa o mesmo módulo (não duplica jsonpath-plus).
- **`normalizeRun`** (`normalizeRun.ts`): caller `reviewArtifact.buildReviewArtifact`. `diffRuns` passa a ser segundo caller (reuso).

### Domain glossary

- **noise** — lista de jsonpaths (no cenário) que apontam campos voláteis do body a ignorar no diff (ex.: `$.timestamp`, `$.id`).
- **scenarioKey** — identidade estável de um cenário p/ agrupar histórico: `name` ou `sha256` dos `{method,url}` dos steps.
- **RunDiff** — resultado estruturado do diff: por step, o que mudou (status/headers/body) após normalização.
- **run anterior** — run do mesmo `scenarioKey` com `createdAt` imediatamente antes do atual.

### Architecture boundaries affected

Lógica no `src/core/` (domínio puro: maskNoise, diffRuns, runHistory). `src/mcp/` e `src/web/` são adaptadores que só importam de `src/core/index.js`. `core` não importa de mcp/web. DIP preservado.

## Prior Art & Related Work

- Interno: blueprint `knowledge-base/discoveries/blueprints/m5-regression-diff-blueprint.md` (6 ADRs); `normalizeRun` (headers/timings — M3); `evalJsonPath` (jsonpath encapsulado — M1); `stableStringify` (M3); `rules/audit-trail-rotation.md` (padrão last-N).
- Externo (citado no blueprint): keploy (field-normalization noise + diff run-vs-run em `pkg/matcher/` e `pkg/service/diff/`), bruno (deepEqual), jsonpath-plus (resultType pointer/all).

## ADRs

### D1 — Regras de noise no cenário: `noise?: string[]` (jsonpaths), aditivo

**Decisão:** add `noise: z.array(z.string()).optional()` ao `ScenarioSchema` (e propagado ao `RunEnvelopeSchema`), contendo jsonpaths dos campos voláteis do body. `schemaVersion` permanece `1`.

**Rationale:** keploy guarda noise inline no testcase (regra revisável junto do cenário — risco #1: explícita/versionada). Vocabulário jsonpath reusa `evalJsonPath` (DRY — 1 vocabulário em todo o domínio). Aditivo/opcional ⇒ backward-compat como `provenance`/`name`.

**Alternativas rejeitadas:** config de noise separada (perde a co-localização revisável; duplica fonte de verdade); noise por regex-de-valor (keploy tem, mas é M-futuro — YAGNI agora).

### D2 — Mascarar body via `jsonpath-plus` com sentinela visível `"<noise>"`

**Decisão:** `maskNoise(body, noisePaths)` parseia o body JSON, substitui cada path casado por `"<noise>"` e re-serializa; body não-JSON ou path sem match → inalterado. Reusa o módulo `evalCapture`/`jsonpath-plus` (sem dep nova).

**Rationale:** mascarar (não deletar) torna o diff auditável — o revisor vê que ali havia um campo normalizado (espelha a redação de headers do `normalizeRun`). `jsonpath-plus` já é dep e suporta localizar nós; `node:JSON` re-serializa. ZERO dep nova (Rule 9/parsimony).

**Alternativas rejeitadas:** deletar o path (perde auditabilidade do risco #1); lib de diff externa (dep desnecessária — comparação após máscara basta).

### D3 — `diffRuns(prev, curr)` função core pura

**Decisão:** `diffRuns(prev: RunEnvelope, curr: RunEnvelope): RunDiff` — normaliza ambos (`normalizeRun` p/ headers/timings + `maskNoise` p/ body usando o `noise` do cenário) e compara por step: `status`, `headers`, `body` → `RunDiff` estruturado (`{steps: [{stepIndex, statusChanged, headerDiffs, bodyChanged, ...}], hasRegression}`). Sem I/O.

**Rationale:** keploy separa normalização (matcher) de comparação (diff service); o core diz O QUE mudou, a web pinta (SRP). Reusa `normalizeRun`+`stableStringify` (DRY). Puro ⇒ testável e determinístico.

**Alternativas rejeitadas:** diff dentro do render (mistura domínio e UI — viola SRP); diff textual linha-a-linha (perde a semântica por-campo que a normalização exige).

### D4 — Identidade de cenário `scenarioKey` p/ histórico

**Decisão:** `scenarioKey(env) = env.name ?? sha256(stableStringify(env.steps.map(s => ({method, url}))))` via `node:crypto`. `findPreviousRun(curr, dir)` lista runs do mesmo `scenarioKey` e retorna o de `createdAt` imediatamente anterior.

**Rationale:** keploy identifica pelo conteúdo do cenário, não pelo id da execução. `name` é a identidade natural (M1+); fallback por hash dos requests cobre runs sem name (run_request M0). `node:crypto` é stdlib (parsimony rung 2).

**Alternativas rejeitadas:** comparar runs arbitrários por id (`?vs=`) — M-futuro (o MVP compara com o anterior automático); índice persistido de histórico (YAGNI — `listRuns` + filtro basta no volume local).

### D5 — Retenção last-N por cenário (risco #2)

**Decisão:** `pruneRunHistory(scenarioKey, dir, limit=10)` mantém os N runs mais recentes por `scenarioKey` (env `HODOR_RUN_HISTORY_LIMIT`), removendo os mais antigos. Chamado após `persistRun` no caminho das tools MCP.

**Rationale:** aplica o padrão "last 10 by mtime" que `rules/audit-trail-rotation.md` já usa em `.compaction-snapshots/`, mas POR CENÁRIO (não expulsa cenários raros). Poda no persist evita crescimento ilimitado desde o início (risco #2).

**Alternativas rejeitadas:** retenção por idade (cenários raros perderiam histórico); arquivar em `runs/archive/` (YAGNI — runs/ é efêmero/gitignored); sem retenção (risco #2 explícito do ROADMAP).

### D6 — Web diff view `GET /runs/:id/diff` (compara com o anterior)

**Decisão:** rota `GET /runs/:id/diff` acha o run anterior do mesmo `scenarioKey`, computa `diffRuns` e renderiza com `renderDiff` destacando status/headers/body mudados. Sem run anterior → mensagem "primeiro run deste cenário". SSR nativo (zero framework — decisão M2).

**Rationale:** o diff é para o humano revisar regressão; reusa a infra de render M2/M4 (escape XSS). Comparação automática com o anterior é o caso de uso central do M5.

**Alternativas rejeitadas:** diff entre runs arbitrários via query (`?vs=id`) — M-futuro; tool MCP `diff_runs` p/ o agente (o diff é para o humano no gate, não para o agente — YAGNI).

## Dependency Graph

```
P1 (core: noise schema + maskNoise + diffRuns) ──> P3 (web diff view)
P2 (history: scenarioKey + findPrevious + retenção) ──> P3
P1, P2 paralelizáveis após o schema (T1.1); P4 (E2E) depende de P1+P2+P3.
```

## Phases

### Phase 1 — Core: noise + maskNoise + diffRuns

#### T1.1 — `noise?` aditivo em Scenario + RunEnvelope + propagação

**Why this step:** o diff precisa saber quais paths do body ignorar; a regra mora no cenário (D1) e deve sobreviver no run persistido p/ o diff lê-la. Ação: add `noise?: string[]` opcional a `ScenarioSchema` e `RunEnvelopeSchema`; `buildRunEnvelope` ganha param `noise?`; `runScenario` propaga `scenario.noise`. Raciocínio: backward-compat como `provenance` no M4; espinha que alimenta `maskNoise`.

**Files to edit:** `src/core/scenarioSchema.ts`, `src/core/runSchema.ts`, `src/core/runStore.ts`, `src/core/runScenario.ts` + `*.test.ts`.

**Deep file dependency analysis:** `buildRunEnvelope` callers (`run_request` sem noise, `runScenario` com) — param opcional ao final preserva ambos. `RunEnvelopeSchema` callers tolerantes a campo opcional.

#### TDD
- RED `scenario_schema_accepts_optional_noise` — cenário com `noise:["$.ts"]` válido; cenário M1-M4 sem `noise` SEGUE válido.
- RED `run_envelope_accepts_optional_noise` — envelope com/sem noise válido.
- RED `run_scenario_propagates_noise_to_envelope` — `runScenario(scenarioComNoise)` → `env.noise` presente.

**Acceptance:** `noise?` aceito e propagado Scenario→Run; TODOS os testes M0-M4 seguem verdes.

**DoD:** `npx vitest run` verde; `tsc` limpo.

#### Concurrency tests
(none — single-threaded) — schemas puros.

#### T1.2 — `maskNoise(body, noisePaths)` (body normalization)

**Why this step:** falsos positivos no diff vêm de campos voláteis no body (DoD #3, risco #1). Ação: criar `src/core/maskNoise.ts` reusando `jsonpath-plus`/`evalCapture` p/ substituir paths casados por `"<noise>"`. Raciocínio: D2; fecha a limitação de body-noise do M3.

**Files to edit:** `src/core/maskNoise.ts` (NEW), `src/core/maskNoise.test.ts` (NEW), `src/core/index.ts`.

**Deep file dependency analysis:** reusa o ponto único de `jsonpath-plus` (evalCapture). Domínio puro. Não muta input.

#### TDD
- RED `mask_noise_replaces_matched_path` — `maskNoise('{"ts":1,"ok":true}', ["$.ts"])` → `{"ts":"<noise>","ok":true}`.
- RED `mask_noise_leaves_non_matching_paths` — path sem match → body inalterado.
- RED `mask_noise_non_json_body_unchanged` — body texto puro → inalterado (não lança).
- RED `mask_noise_nested_and_array_paths` — `$.data[*].id` mascara todos; `$.a.b.c` aninhado.
- RED `mask_noise_does_not_mutate_input` — string de entrada intacta.

**Acceptance:** `maskNoise(body, paths)` mascara só os paths casados com `"<noise>"`; body não-JSON/miss inalterado; nunca lança; determinístico.

**DoD:** `npx vitest run src/core/maskNoise.test.ts` verde.

#### Concurrency tests
(none — single-threaded).

#### T1.3 — `diffRuns(prev, curr)` → `RunDiff`

**Why this step:** o coração do M5 — comparar comportamento normalizado (DoD #2). Ação: criar `src/core/diffRuns.ts` que normaliza ambos (`normalizeRun` + `maskNoise` com o `noise` do run) e compara por step (status/headers/body) via `stableStringify`. Raciocínio: D3; core diz O QUE mudou.

**Files to edit:** `src/core/diffRuns.ts` (NEW), `src/core/diffRuns.test.ts` (NEW), `src/core/index.ts`.

**Deep file dependency analysis:** reusa `normalizeRun` (headers/timings), `maskNoise` (body), `stableStringify` (comparação estável). Puro.

#### TDD
- RED `diff_runs_flags_status_change` — runs idênticos exceto status 200→500 → `RunDiff` marca `statusChanged` no step.
- RED `diff_runs_flags_body_change` — body com campo real mudado → `bodyChanged`.
- RED `diff_runs_ignores_noise_body_field` — body difere SÓ num path de noise (`$.timestamp`) → `bodyChanged:false` (anti-flaky — DoD #3, risco #1).
- RED `diff_runs_ignores_volatile_headers` — diferença só em header volátil (`date`) → sem diff de header (reusa normalizeRun).
- RED `diff_runs_identical_runs_no_regression` — runs iguais → `hasRegression:false`, sem diffs.
- RED `diff_runs_detects_real_header_change` — header não-volátil mudado → `headerDiffs` não-vazio.

**Acceptance:** `diffRuns` retorna `RunDiff` por step com status/header/body changes APÓS normalização; noise e voláteis suprimidos; mudança real detectada.

**DoD:** `npx vitest run src/core/diffRuns.test.ts` verde; `tsc` limpo.

#### Concurrency tests
(none — single-threaded).

### Phase 2 — Histórico + retenção

#### T2.1 — `scenarioKey` + `findPreviousRun` + `pruneRunHistory`

**Why this step:** DoD #1 (histórico comparável) + risco #2 (retenção). Ação: criar `src/core/runHistory.ts` com `scenarioKey(env)` (name ?? sha256 dos {method,url}), `findPreviousRun(curr, dir)` (mesmo key, ordem total `(createdAt, runId)`) e `pruneRunHistory(scenarioKey, dir, limit, verdictsDir)` (last-N, clamp `max(1,…)`, PIN runs com verdict — EC-1/EC-2/EC-3). Wire `pruneRunHistory` após `persistRun` nas tools MCP (passando o verdictsDir). Raciocínio: D4+D5 + MUST-FIX da v1.1.

**Files to edit:** `src/core/runHistory.ts` (NEW), `src/core/runHistory.test.ts` (NEW), `src/core/index.ts`, `src/mcp/server.ts` (poda após persist).

**Deep file dependency analysis:** `scenarioKey` usa `node:crypto` (stdlib) + `stableStringify`. `findPreviousRun`/`pruneRunHistory` leem `runs/` (loadRun, tolera corrompido como `listRuns` do M2). MCP chama prune após persist (aditivo).

#### TDD
- RED `scenario_key_uses_name_when_present` — env com `name:"x"` → key `"x"`.
- RED `scenario_key_falls_back_to_request_hash` — env sem name → sha256 estável dos {method,url} (mesmo cenário → mesma key; cenário diferente → key diferente).
- RED `find_previous_run_returns_immediately_prior_same_scenario` — 3 runs do mesmo cenário em tempos t1<t2<t3 → previous(t3) === t2; run de OUTRO cenário no meio é ignorado.
- RED `find_previous_run_null_for_first_run` — único run do cenário → null.
- RED `find_previous_run_breaks_createdAt_tie_deterministically` (EC-3) — dois runs com `createdAt` idêntico → ordem total por `(createdAt, runId)`; resultado determinístico (não flaky).
- RED `prune_run_history_keeps_last_n_per_scenario` — N+2 runs do cenário A + 1 do B → prune(limit=N) mantém N de A e o 1 de B (não expulsa cenário raro).
- RED `prune_run_history_never_deletes_approved_run` (EC-1) — run com `verdicts/{id}.json` presente é PINNED: prune nunca o remove mesmo se for o mais antigo (alinha `audit-trail-rotation.md` "approved never rotates"); não orfana `reviews/`.
- RED `prune_run_history_clamps_nonpositive_limit` (EC-2) — `limit` 0/negativo/NaN → clamp `Math.max(1, …)` (default 10 p/ não-inteiro); nunca apaga o run recém-persistido.
- RED `prune_run_history_tolerates_corrupt_file` — arquivo corrompido não derruba a poda.

**Acceptance:** `scenarioKey` estável; `findPreviousRun` acha o anterior do mesmo cenário com ordem total determinística; `pruneRunHistory` mantém last-N por cenário, NUNCA apaga run aprovado (verdict presente), clampa limit; tolera corrompido.

**DoD:** `npx vitest run src/core/runHistory.test.ts` verde; tool MCP persiste e poda sem quebrar testes M0/M1.

#### Concurrency tests
(none — single-threaded; I/O de arquivo por id; last-write-wins aceito como M2/M3).

### Phase 3 — Web diff view

#### T3.1 — `GET /runs/:id/diff` + `renderDiff`

**Why this step:** DoD #2 — diff destacado na web app. Ação: rota `GET /runs/:id/diff` (acha o anterior via `findPreviousRun`, computa `diffRuns`, renderiza com `renderDiff`); sem anterior → mensagem clara. Raciocínio: D6; reusa infra de render M2/M4.

**Files to edit:** `src/web/server.ts`, `src/web/render.ts`, `src/web/server.test.ts`, `src/web/render.test.ts`.

**Deep file dependency analysis:** `renderDiff(diff, prevId, currId)` puro; escape XSS herdado. Rota valida id (RUN_ID_RE — M2). Link "ver diff" na página do run.

#### TDD
- RED `render_diff_highlights_status_change` — `RunDiff` com statusChanged → HTML destaca (classe/cor).
- RED `render_diff_shows_no_regression_when_identical` — diff vazio → "sem mudanças".
- RED `render_diff_escapes_body_content` — body com `<script>` → escapado (anti-XSS).
- RED `web_diff_route_404_for_missing_run` — id inexistente → 404.
- RED `web_diff_route_400_for_malformed_id` (EC-4) — id não-UUID (`../x`, hash) → 400; `:id` permanece validado por `RUN_ID_RE`; `scenarioKey` é computado APÓS `loadRun`, nunca derivado da URL (não reabre traversal fechado em M2/M4).
- RED `web_diff_route_shows_first_run_message_when_no_previous` — run sem anterior → 200 + "primeiro run deste cenário".
- RED `web_diff_route_renders_diff_vs_previous` — 2 runs do mesmo cenário → diff renderizado destacando a mudança.

**Acceptance:** rota computa e destaca o diff vs anterior; `:id` UUID-validado (scenarioKey vem do run carregado, não da URL); sem anterior → mensagem; XSS-safe; 404 p/ id inexistente, 400 p/ id malformado.

**DoD:** `npx vitest run src/web` verde.

#### Concurrency tests
(none — single-threaded).

### Phase 4 — Final Phase: Integration Validation (E2E M5)

#### T4.1 — E2E `e2e_m5_diff_detects_real_change_ignores_noise`

**Why this step:** prova o loop M5 e a métrica do Goal — anti-flaky real. Ação: criar `src/m5-e2e.test.ts`. Raciocínio: integra P1+P2+P3.

**Files to edit:** `src/m5-e2e.test.ts` (NEW), `CHANGELOG.md`.

#### TDD
- RED `e2e_m5_diff_detects_real_change_ignores_noise`:
  1. cenário com `noise:["$.timestamp"]`; executa 2x contra um servidor efêmero cujo body tem um `timestamp` volátil (muda entre runs) + um campo estável; persiste ambos os runs.
  2. `findPreviousRun(curr)` acha o run anterior do mesmo cenário.
  3. `diffRuns(prev, curr)` → `bodyChanged:false` quando só o `timestamp` mudou (noise suprimido — anti-flaky); `hasRegression:false`.
  4. muda o servidor p/ um campo ESTÁVEL diferente → 3º run → `diffRuns` marca `bodyChanged:true` (regressão real detectada).
  5. web `GET /runs/:id/diff` destaca a mudança real e ignora o noise.
  6. retenção: após N+1 runs do cenário, `runs/` mantém ≤ N+ (poda funcionou).

**Acceptance:** E2E verde; os 3 DoDs do ROADMAP §M5 demonstrados (histórico comparável; diff destacado; normalização de body reduz falso positivo).

**DoD (Final Phase):** `npx vitest run` (suíte completa) verde; `tsc --noEmit` 0 erros; `npm audit` 0 vulns (ZERO dep nova); coverage core dos arquivos novos ≥ 90%; backward-compat M0-M4 verde; CHANGELOG `[Unreleased] § Added` atualizado.

#### Concurrency tests
(none — single-threaded).

#### Failure scenarios
- **Run corrompido no histórico** (`findPreviousRun`/`pruneRunHistory`): JSON inválido em `runs/` → pulado (não derruba diff/poda). Reproduzido em T2.1.
- **Body não-JSON no diff** (`maskNoise`/`diffRuns`): body texto puro com noise paths → body inalterado, diff textual direto (não lança). Reproduzido em T1.2/T1.3.
- **Diff sem run anterior**: primeiro run do cenário → rota responde 200 com mensagem (não 500). Reproduzido em T3.1.
- (A execução HTTP real continua sendo `runScenario`/`executeRequest` do M0/M1, já com Failure scenarios cobertos.)

## Coverage Matrix

| # | Gap / Requirement (ROADMAP §M5 DoD) | Task(s) | Resolution |
|---|---|---|---|
| 1 | DoD #1 — execuções históricas guardadas e comparáveis (anterior vs atual) | T2.1, T1.1 | `scenarioKey` + `findPreviousRun` sobre `runs/`; `noise` propagado ao run |
| 2 | DoD #2 — diff (status/headers/body) computado e destacado na web app | T1.3, T3.1, T4.1 | `diffRuns` core + `renderDiff` + rota `/runs/:id/diff` |
| 3 | DoD #3 — normalização de voláteis (incl. body) reduz falsos positivos, regras inspecionáveis | T1.1, T1.2, T1.3 | `noise` jsonpath no cenário + `maskNoise` body + `normalizeRun` headers |
| 4 | Risco #1 — normalização agressiva esconder regressão real | T1.2, T4.1 | sentinela visível `"<noise>"`; regras explícitas no cenário; E2E prova mudança real detectada |
| 5 | Risco #2 — volume de runs históricos sem limite | T2.1 | `pruneRunHistory` last-N por cenário (env-configurável) |
| 6 | Backward-compat M0-M4 | T1.1 | `noise?` opcional; suíte existente verde |
| 7 | ZERO dep nova | T1.2 | reusa `jsonpath-plus`/`normalizeRun`/`stableStringify`/`node:crypto` |

**Coverage: 7/7 gaps cobertos (100%)**

## Global DoD

- Todos os testes verdes (`npx vitest run`); `tsc --noEmit` 0 erros; `npm audit` 0 vulns.
- ZERO dependência nova (`git diff package.json` vazio).
- Coverage dos arquivos core novos (`maskNoise.ts`, `diffRuns.ts`, `runHistory.ts`) ≥ 90%.
- Arquivos ≤ 500 LoC; funções coesas (SRP).
- DIP preservado: `grep -rn 'from "../web"\|from "../mcp"' src/core/` vazio.
- CHANGELOG `[Unreleased] § Added` com a entrada do M5.
- Os 3 DoDs do ROADMAP §M5 validados empiricamente pelo E2E.

## Drawbacks & Risks

| Risco | Severidade | Mitigação | Owner |
|---|---|---|---|
| Normalização agressiva esconder regressão real (risco #1 ROADMAP) | Alta | sentinela visível; noise explícito/versionado no cenário; E2E prova que mudança real é detectada | dev |
| Volume de runs históricos sem limite (risco #2 ROADMAP) | Média | `pruneRunHistory` last-N por cenário desde o início | dev |
| `scenarioKey` por hash colidir/divergir entre runs do "mesmo" cenário | Média | hash sobre `{method,url}` ordenados via stableStringify; `name` é a identidade preferida | dev |
| Diff de body grande inflar a página de diff | Baixa | reusa truncamento de body do render M2 | dev |

## Unresolved Questions

(none — every decision is resolved at plan time; design fixado no blueprint D1-D6 e escopo de parsimônia neste plano.)
