---
slug: m2-review-webapp
milestone_id: M2
created_at: 2026-06-18
goal: Entregar a web app de review do Hodor — lista runs, exibe req/resp/headers + asserts por step com pass/fail evidente, e o humano registra um verdict (aprovado/rejeitado + nota) persistido — provado por um teste E2E verde.
---

# Plan: M2 — Web app de review (listagem + req/resp/headers + verdict humano)

> **Version 1.1** (absorveu EC-1 MUST-FIX escape da note XSS + EC-2 MUST-FIX listagem tolerante a run corrompido + EC-3 SHOULD-TEST + EC-4 DOCUMENT de `knowledge-base/reviews/m2-review-webapp-edge-cases-2026-06-18.md`) — Estende a web app server-rendered do M0/M1 (HTTP nativo + `render.ts`) com: (a) **listagem** de runs (`GET /`) com resumo pass/fail e verdict; (b) render robusto por content-type (`pickRenderer` + truncamento — risco #2); (c) **verdict humano** (`{runId, verdict, note?, decidedAt}`) validado por zod, persistido em `verdicts/{runId}.json`, registrado via `POST /runs/:id/verdict`; (d) o envelope de run ganha `name` opcional (nome do cenário) para rotular a listagem. SEM framework/bundler (risco #1 — a UI é revisão, não autoria). Baseado no blueprint SHIPPABLE_WITH_CAVEATS `knowledge-base/discoveries/blueprints/m2-review-webapp-blueprint.md`.

## Goal

> Enable um humano a revisar uma execução na web app — vendo req/resp/headers + asserts (pass/fail) por step — e registrar um verdict (aprovado/rejeitado + nota) que persiste, measured by o teste E2E `e2e_review_lists_renders_and_records_verdict` retornando verde.

## Context

O `ROADMAP.md` §M2 (depende de M1 v0.2.0) pede: (1) web app **lista cenários e execuções** + por step req/resp/headers + asserts/resultado; (2) humano registra **verdict** (aprovado/rejeitado + nota) **persistido**; (3) pass/fail **visualmente evidente**. Riscos: (#1) não inflar para cliente Insomnia; (#2) payloads grandes/binários travarem.

O blueprint da fase DISCOVER (`knowledge-base/discoveries/blueprints/m2-review-webapp-blueprint.md`, SHIPPABLE_WITH_CAVEATS) estudou hoppscotch e fixou: (D1) server-rendered nativo SEM framework (hoppscotch tem 102 deps Vue/Vite p/ autoria; review é read + 1 POST); (D2) `pickRenderer` por content-type + truncamento; (D3) verdict `{runId,verdict,note?,decidedAt}` em `verdicts/{runId}.json`; (D4) envelope ganha `name` aditivo; (D5) listagem em `GET /`, verdict via `POST`.

O M0/M1 entregaram `src/web/server.ts` (HTTP nativo, GET-only), `src/web/render.ts` (render de steps + asserts/captures), e o core (`buildRunEnvelope`, `loadRun`). M2 reusa e estende.

## Baseline Context (deep review of current state)

> Estado real pós-M1 (v0.2.0). Evidência: `git log -1` + `wc -l`. Arquivos existentes serão ESTENDIDOS.

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `src/web/server.ts` | 111 | `2f88936` (2026-06-18) | adaptador HTTP nativo (GET-only) — M0/M1 | rotas GET existentes preservadas; EC-1 anti path-traversal mantido; adiciona `GET /` listagem + `POST /runs/:id/verdict` |
| `src/web/render.ts` | 134 | `af982a4` (2026-06-18) | run → HTML puro (steps + asserts/captures) — M1 | render de step preservado; adiciona `pickRenderer` + truncamento + form de verdict + página de listagem |
| `src/core/runSchema.ts` | 62 | `213839a` (2026-06-18) | schema do envelope + RunStep (M0/M1) | `schemaVersion` literal `1`; adiciona `name?` opcional ao envelope (aditivo) |
| `src/core/runStore.ts` | 49 | `061638f` (2026-06-18) | buildRunEnvelope/persistRun/loadRun (M0) | `buildRunEnvelope` ganha param `name?` opcional; assinatura backward-compatible |
| `src/core/runScenario.ts` | 45 | `213839a` (2026-06-18) | engine de cenário (M1) | passa `scenario.name` ao `buildRunEnvelope`; sem outra mudança |
| `src/core/index.ts` | 37 | `0d1732d` (2026-06-18) | superfície pública do core | adiciona exports de verdict + pickRenderer; preserva os existentes |
| `src/core/verdict.ts` (NEW) | 0 | — | (a criar) VerdictSchema + saveVerdict + loadVerdict | validação zod; verdict ∈ approved/rejected; nunca muta o run |
| `src/core/verdict.test.ts` (NEW) | 0 | — | RED test do verdict store | — |
| `src/web/render.test.ts` | (M1) | `0d1732d` | RED test do render (M0/M1) | adiciona casos de pickRenderer/truncamento/listing/verdict-form |
| `src/web/server.test.ts` | (M1) | `2f88936` | testes do web server (M0/M1) | adiciona casos de listing + POST verdict + 404/400 |
| `src/web/pickRenderer.test.ts` (NEW) | 0 | — | RED test do dispatch por content-type | — |
| `src/review-e2e.test.ts` (NEW) | 0 | — | E2E: run → list → verdict → reload | — |
| `package.json` | ~32 | `dc1fb9f` (2026-06-18) | manifest | adicionar `verdicts/` ao gitignore; ZERO dep nova (D1) |
| `.gitignore` | (M0) | `dc1fb9f` | ignora runs/, node_modules etc. | adiciona `verdicts/` |
| `CHANGELOG.md` | (M1) | `7c7e76c` | contrato público | nunca editar versões released; entradas em `[Unreleased]` |

### Current callers / dependents

- **`RunEnvelopeSchema`/`RunEnvelope`** (`src/core/runSchema.ts`): callers em produção `runStore`, `web/render.ts`, `web/server.ts`. Adicionar `name?` opcional é backward-compatible (não quebra runs M0/M1 sem name). Tests: runSchema/render/scenario.
- **`buildRunEnvelope`** (`src/core/runStore.ts`): callers `mcp/server.ts` (run_request), `runScenario.ts`. Adicionar 3º param opcional `name?` não quebra os callers existentes.
- **`renderRun`** (`src/web/render.ts`): caller `web/server.ts`. Estensão aditiva.
- External (API pública de outro repo): **não**.

### Domain glossary

- **verdict** — decisão humana sobre uma execução (run): `approved` ou `rejected`, com nota opcional, registrada na web app.
- **listing** — página inicial (`GET /`) que lista os runs persistidos, com resumo pass/fail e verdict.
- **pickRenderer** — dispatch por content-type → como exibir o body (json/text/binary).
- **pass/fail summary** — selo por run: ✓ se todos os asserts passaram, ✗ caso contrário (ou "—" se não há asserts, ex. run do M0).

### Architecture boundaries affected

`rules/architecture.md` §1–§2: o **verdict store** (`src/core/verdict.ts`) é domínio (core, validação zod na fronteira); o web server é adaptador que delega `saveVerdict`/`loadVerdict` ao core. `pickRenderer` é função pura no `render.ts` (camada de interface, sem I/O). Direção: `web → core`; o core não importa web. NENHUMA dep de framework (D1).

## Prior Art & Related Work

- **Internal blueprint:** `knowledge-base/discoveries/blueprints/m2-review-webapp-blueprint.md` — ADRs D1–D5, Coverage Corners, Recommendations 1–8. Fonte primária.
- **Internal blueprints (M0/M1):** `knowledge-base/discoveries/blueprints/m0-walking-skeleton-blueprint.md` (envelope, web server), `knowledge-base/discoveries/blueprints/m1-scenario-model-blueprint.md` (asserts/captures no step).
- **Reference projects** (`knowledge-base/references/`):
  - `hoppscotch/packages/hoppscotch-common/src/helpers/lenses/lenses.ts` — dispatch por content-type (`getSuitableLenses`, raw fallback).
  - `hoppscotch/packages/hoppscotch-common/src/components/history/rest/Card.vue` — campos de um item de listagem.
- **Patterns skills** (`skills/*-patterns/`): nenhum registrado.

## Objective

- [ ] Sub-goal 1 — Envelope ganha `name?` (nome do cenário) aditivo; `runScenario` o popula; backward-compatible.
- [ ] Sub-goal 2 — Verdict store no core: `VerdictSchema` zod + `saveVerdict`/`loadVerdict` (`verdicts/{runId}.json`).
- [ ] Sub-goal 3 — `pickRenderer(contentType)` (json/text/binary) + truncamento de texto grande; binário não embutido (risco #2).
- [ ] Sub-goal 4 — `GET /` lista runs com nome/data/steps/resumo-pass-fail/verdict.
- [ ] Sub-goal 5 — `/runs/:id` exibe form de verdict; `POST /runs/:id/verdict` valida, persiste e redireciona; pass/fail evidente.
- [ ] Sub-goal 6 — E2E `e2e_review_lists_renders_and_records_verdict` verde.

## ADRs

### D1 — Web app server-rendered nativa, SEM framework (risco #1)

**Decision:** M2 estende `src/web/` (HTTP nativo + HTML server-rendered). NENHUM framework/bundler novo.

**Rationale:** hoppscotch usa 102 deps (Vue+Vite) p/ autoria/real-time; o DoD do M2 (listar/exibir/verdict) é 100% server-rendering. `parsimony-ladder` rung 2-3 + risco #1. Blueprint ADR D1.

**Alternatives considered:** Vue/Vite (rejeitado — inflar p/ cliente Insomnia, risco #1); SPA + API JSON (rejeitado — idem).

**Consequences:** zero dep nova; HTML+CSS inline; interatividade rica seria ADR futuro.

### D2 — `pickRenderer` por content-type + truncamento (risco #2)

**Decision:** `pickRenderer(contentType): "json"|"text"|"binary"` no `render.ts`. JSON → pretty; texto → `<pre>` escapado; binário → metadados (tipo), conteúdo NÃO embutido. Texto > 64 KB → truncado com aviso.

**Rationale:** espelha `getSuitableLenses` do hoppscotch (content-type case-insensitive, raw fallback) server-side e mínimo; mitiga risco #2 sem lazy-load (YAGNI). Blueprint ADR D2.

**Alternatives considered:** renderers de mídia dedicados (rejeitado — review não toca mídia); sem truncamento (rejeitado — risco #2).

**Consequences:** binário só por metadados no M2 (inspeção de mídia é YAGNI).

### D3 — Verdict `{runId, verdict, note?, decidedAt}` no core; POST + validação zod

**Decision:** `VerdictSchema = { runId, verdict: "approved"|"rejected", note?: string, decidedAt: string }`, validado por zod; `saveVerdict`/`loadVerdict` em `verdicts/{runId}.json` (dir via `HODOR_VERDICTS_DIR`, default `verdicts/`). Registrado via `POST /runs/:id/verdict` (form url-encoded). Verdict por **run**.

**Rationale:** verdict é a tese central (revisão humana) — design próprio (sem ref, blueprint ADR D3). Persistência separada do run (não muta o artefato bruto) prepara M3 versionável. `architecture.md` §2 (validação na fronteira, store no core).

**Alternatives considered:** embutir no run (rejeitado — polui o run bruto; M3 separa run normalizado); verdict por nome de cenário (rejeitado M2 — runId é o id estável).

**Consequences:** `verdicts/` novo dir (gitignored no M2; M3 versiona). O web server deixa de ser GET-only (POST no path de verdict).

### D4 — Envelope ganha `name` (nome do cenário) OPCIONAL — aditivo

**Decision:** `buildRunEnvelope(steps, deps, name?)` + `RunEnvelopeSchema.name: z.string().optional()`. `runScenario` passa `scenario.name`. `schemaVersion` mantido `1`.

**Rationale:** M2 rotula a listagem por cenário; o envelope não guarda o nome hoje (baseline). Aditivo-opcional = backward-compatible (runs M0/M1 sem name válidos), mesmo padrão do M1 D4. Blueprint ADR D4.

**Alternatives considered:** `schemaVersion:2` + migração (rejeitado — aditivo basta); índice cenário→runs separado (rejeitado — derivável; YAGNI).

**Consequences:** `run_request` (M0) gera run sem `name` → listado como "(sem cenário)".

### D5 — Listagem em `GET /`; verdict via `POST`; pass/fail evidente

**Decision:** `GET /` lista runs (mais recente primeiro): nome/runId/data/steps/resumo-pass-fail/verdict. `/runs/:id` exibe steps + form de verdict. `POST /runs/:id/verdict` grava e redireciona (303). Pass/fail por assert com cor verde/vermelha (já no M1) + selo de resumo por run.

**Rationale:** fecha os 3 DoDs; o web server ganha roteamento POST + parse de form. Adaptador fino (delega ao core). Blueprint ADR D5.

**Alternatives considered:** API JSON + SPA (rejeitado — risco #1); verdict via MCP (rejeitado — verdict é ato do humano na web, não do agente).

**Consequences:** POST aceito só no path de verdict; CSRF é YAGNI no M2 (local single-user; documentado em Drawbacks).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Verdict sem proteção CSRF (web server aceita POST) | Medium | Aceito M2: uso local single-user (ROADMAP Constraints); origem é o próprio operador no browser local. Hardening (token CSRF) é follow-up se exposto a rede | impl |
| Render de body grande trava o browser (risco #2) | Medium | `pickRenderer` trunca texto > 64 KB; binário nunca embutido (só metadados); testado | impl |
| Last-write-wins no verdict (sem lock) se duas abas submetem | Low | Aceito M2: single-user; `writeFile` atômico-o-suficiente p/ um arquivo pequeno; M3+ pode versionar | impl |
| POST com `verdict` inválido (nem approved nem rejected) | Low | `VerdictSchema` valida na fronteira → 400 com mensagem; testado | impl |

## Unresolved Questions

- Q1 — Onde guardar `verdicts/` em relação a `runs/`? Resolução proposta: dir irmão `verdicts/` (default), via `HODOR_VERDICTS_DIR`; M3 decide o versionamento conjunto — resolvido na T1.2.
- Q2 — O `POST /runs/:id/verdict` exige que o run exista? Resolução proposta: sim — valida que `runs/:id.json` existe (loadRun) antes de gravar o verdict; run inexistente → 404 — resolvido na T2.2.
- (demais decisões resolvidas via D1–D5.)

## Dependencies

ZERO dependência nova (D1 — server-rendered nativo). Reusa o que já existe.

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | `^1.20.0` | npm | (sem mudança no M2; tool MCP do M0/M1) |
| `zod` | `^3.25.1` | npm | validação do VerdictSchema + envelope (reuso) |
| `jsonpath-plus` | `^10.4.0` | npm | (sem mudança no M2; engine M1) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | — | — | Avaliado: Vue/React/Svelte (rejeitado — risco #1, footprint de autoria desnecessário p/ review read-only); template engine (ejs/handlebars) (rejeitado — template literals nativos já bastam); body-parser/express (rejeitado — `http` nativo + parse manual de form url-encoded basta) | nenhuma dep nova: `http`/`fs`/`URLSearchParams` nativos cobrem o M2 |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Dependency Graph

```
Phase 1 (core: envelope name → verdict store → pickRenderer)
   └──▶ Phase 2 (web: listing + verdict POST/form) ──▶ Phase 3 (E2E + validação)
```

Phase 1 internamente: T1.1 (envelope name) e T1.2 (verdict) e T1.3 (pickRenderer) são independentes entre si (paralelizáveis), mas todas precedem Phase 2. Phase 2 (T2.1 listing, T2.2 verdict) depende do core. Phase 3 depende de Phase 2.

---

## Phase 1: Core — envelope name, verdict store, pickRenderer

**Objective:** estender o domínio (nome no envelope + verdict store) e o render puro (pickRenderer), testável sem o web server.

### T1.1 — Envelope ganha `name?` + runScenario popula

#### Objective
Adicionar `name?` opcional ao `RunEnvelopeSchema`/`buildRunEnvelope`; `runScenario` passa `scenario.name`.

#### Why this step (action + reasoning)
1. **What:** `RunEnvelopeSchema.name: z.string().optional()`; `buildRunEnvelope(steps, deps, name?)`; `runScenario` chama `buildRunEnvelope(steps, deps, scenario.name)`.
2. **Why now:** a listagem (T2.1) precisa rotular runs por cenário; o envelope não guarda o nome hoje (baseline). Aditivo primeiro destrava a listagem (D4).

#### Evidence
Blueprint §"D4" + §"Context" (baseline: envelope sem name). `src/core/runStore.ts:23` (buildRunEnvelope), `src/core/runSchema.ts:51` (RunEnvelopeSchema).

#### Files to edit
```
src/core/runSchema.ts — RunEnvelopeSchema += name?: z.string().optional()
src/core/runStore.ts — buildRunEnvelope(steps, deps={}, name?) inclui name quando presente
src/core/runScenario.ts — passa scenario.name ao buildRunEnvelope
src/core/runStore.test.ts — caso: envelope com name; e backward-compat sem name
```

#### Deep file dependency analysis
`runSchema.ts`/`runStore.ts`/`runScenario.ts` (M0/M1). `name?` opcional não quebra callers (run_request do M0 não passa name). Downstream: listagem (T2.1) lê `env.name`.

#### Deep Dives
- `buildRunEnvelope`: incluir `...(name !== undefined ? { name } : {})` no objeto (ordem de chaves estável).
- Invariant: run M0/M1 sem name continua válido (`name` opcional); `schemaVersion` permanece `1`.

#### Tasks
1. `RunEnvelopeSchema.name?`.
2. `buildRunEnvelope` 3º param.
3. `runScenario` repassa `scenario.name`.

#### TDD
```
RED:     build_run_envelope_includes_name_when_provided() — buildRunEnvelope(steps, deps, "meu-cenário").name === "meu-cenário"
RED:     build_run_envelope_omits_name_when_absent() — sem name → envelope sem a chave; RunEnvelopeSchema valida (backward-compat M0)
GREEN:   implementar até passar
REFACTOR: None expected
VERIFY:  npx vitest run src/core/runStore.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 2 RED tests passam — `npx vitest run src/core/runStore.test.ts` verde
- [ ] Run sem name (M0/M1) continua válido — backward-compat provada por `npx vitest run src/core/runStore.test.ts` verde
- [ ] Pass: cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` reporta 0 erros

#### DoD
- [ ] `npx vitest run src/core/runStore.test.ts` verde; `npm run typecheck` 0 erros

### T1.2 — Verdict store (zod + save/load)

#### Objective
`VerdictSchema` + `saveVerdict`/`loadVerdict` em `verdicts/{runId}.json`.

#### Why this step (action + reasoning)
1. **What:** cria `src/core/verdict.ts` (`VerdictSchema`, `defaultVerdictsDir`, `saveVerdict`, `loadVerdict`).
2. **Why now:** o POST de verdict (T2.2) delega a este store; isolar no core (domínio) com validação zod (D3) torna testável sem o web server.

#### Evidence
Blueprint §"D3"/"Recommendations #6". `architecture.md` §2 (validação na fronteira). Padrão espelha `loadRun`/`persistRun` do M0 (`src/core/runStore.ts`).

#### Files to edit
```
src/core/verdict.ts (NEW) — VerdictSchema + saveVerdict + loadVerdict + defaultVerdictsDir
src/core/index.ts — exporta verdict API (aditivo)
src/core/verdict.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
NEW + index.ts. Importa zod + node fs. Downstream: `web/server.ts` (POST) chama `saveVerdict`; listagem (T2.1) e `/runs/:id` (T2.2) chamam `loadVerdict`.

#### Deep Dives
- `VerdictSchema = z.object({ runId: z.string().min(1), verdict: z.enum(["approved","rejected"]), note: z.string().optional(), decidedAt: z.string() })`.
- `defaultVerdictsDir()` = `process.env.HODOR_VERDICTS_DIR ?? "verdicts"`.
- `saveVerdict(v, dir?)`: `mkdir -p`; grava `${dir}/${v.runId}.json` (`JSON.stringify(...,2)`); valida com `VerdictSchema.parse(v)` ANTES de gravar (fronteira).
- `loadVerdict(runId, dir?): Promise<Verdict | null>`: lê `${dir}/${runId}.json`; ENOENT → `null` (verdict pendente); arquivo inválido → lança (fail-loud).
- Invariant: nunca muta o run; verdict é arquivo separado.

#### Pseudo-code / Signatures
```pseudocode
function saveVerdict(v, dir=default): VerdictSchema.parse(v); mkdir(dir); writeFile(dir/${v.runId}.json, json(v)); return path
function loadVerdict(runId, dir=default): try read+parse+VerdictSchema.parse catch ENOENT -> null
# Example
saveVerdict({runId:"r1", verdict:"approved", decidedAt:"..."}) -> "verdicts/r1.json"
loadVerdict("r1") -> {runId:"r1", verdict:"approved", ...}; loadVerdict("nope") -> null
```

#### Tasks
1. `VerdictSchema` + tipos.
2. `saveVerdict`/`loadVerdict`/`defaultVerdictsDir`.
3. Exportar em index.ts.

#### TDD
```
RED:     save_verdict_writes_file_named_by_run_id() — saveVerdict grava verdicts/{runId}.json em tmpdir
RED:     load_verdict_round_trips() — loadVerdict(runId) deep-equals o salvo
RED:     load_verdict_returns_null_when_absent() — runId sem arquivo → null (pendente)
RED:     save_verdict_rejects_invalid_verdict_value() — verdict:"maybe" → lança (zod, fronteira)
GREEN:   implementar até os 4 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/core/verdict.test.ts
```

#### Concurrency tests
(none — single-threaded)
Nota: verdict é last-write-wins por arquivo (single-user, M2); sem estado compartilhado concorrente.

#### Acceptance Criteria
- [ ] Os 4 RED tests passam — `npx vitest run src/core/verdict.test.ts` verde
- [ ] Verdict inválido → lança na fronteira; ausente → null — `npx vitest run src/core/verdict.test.ts` verde
- [ ] Pass: coverage ≥ 90% em `verdict.ts`; cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/core/verdict.test.ts` verde

### T1.3 — pickRenderer (content-type dispatch) + truncamento

#### Objective
Função pura `pickRenderer(contentType): "json"|"text"|"binary"` + truncamento de texto grande, no `render.ts`.

#### Why this step (action + reasoning)
1. **What:** adiciona `pickRenderer` + `truncate` em `src/web/render.ts` (puros); `bodyBlock` passa a usá-los.
2. **Why now:** mitiga o risco #2 (binário/grande travar) e é testável isoladamente. Formaliza o `TEXTUAL` regex já existente do M0 num dispatch nomeado.

#### Evidence
Blueprint §"T1"/"D2". `knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/helpers/lenses/lenses.ts:42` (content-type case-insensitive, raw fallback).

#### Files to edit
```
src/web/render.ts — pickRenderer + truncate; bodyBlock usa pickRenderer
src/web/pickRenderer.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
`render.ts` (M0/M1). `pickRenderer` exportado para teste. Downstream: `bodyBlock` (interno) e a listagem. `index.ts` pode exportar `pickRenderer` (ou fica em render). Mantido em render (camada interface).

#### Deep Dives
- `pickRenderer(contentType?: string): "json"|"text"|"binary"` — content-type lowercased; `application/json`/`+json` → "json"; `text/*`, `application/xml`/`+xml`, `javascript`, `x-www-form-urlencoded` → "text"; senão → "binary".
- `truncate(s, max=65536): {text, truncated, originalLength}` — corta em max com aviso.
- `bodyBlock`: "json" → pretty (try JSON.parse + stringify(2), escapado); "text" → `<pre>` truncado escapado; "binary" → `(binário omitido — content-type: X)`.
- Invariant: nunca embute binário; sempre escapa texto.

#### Pseudo-code / Signatures
```pseudocode
function pickRenderer(ct): ct?.toLowerCase() includes json -> "json"; text/xml/js/form -> "text"; else "binary"
function truncate(s, max=65536): s.length<=max ? {text:s,truncated:false} : {text:s.slice(0,max), truncated:true, originalLength:s.length}
# Example
pickRenderer("application/json") -> "json"; pickRenderer("image/png") -> "binary"; pickRenderer(undefined) -> "binary"
```

#### Tasks
1. `pickRenderer`.
2. `truncate`.
3. `bodyBlock` usa ambos.

#### TDD
```
RED:     pick_renderer_json_for_json_content_type() — "application/json" → "json"; "x/y+json" → "json"
RED:     pick_renderer_text_for_textual() — "text/html", "application/xml" → "text"
RED:     pick_renderer_binary_for_non_text_or_missing() — "image/png" → "binary"; undefined → "binary"
RED:     pick_renderer_case_insensitive() — "APPLICATION/JSON" → "json"
RED:     truncate_marks_large_text() — texto > max → truncated:true, text encurtado
GREEN:   implementar até os 5 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/web/pickRenderer.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 5 RED tests passam — `npx vitest run src/web/pickRenderer.test.ts` verde
- [ ] Binário nunca embutido; texto grande truncado; case-insensitive — `npx vitest run src/web/pickRenderer.test.ts` verde
- [ ] Pass: coverage ≥ 90% nos helpers; cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/web/pickRenderer.test.ts` verde

---

## Phase 2: Web — listagem + verdict (POST/form)

**Objective:** listar runs, exibir form de verdict e gravar o verdict via POST.

### T2.1 — Listagem em `GET /`

#### Objective
`GET /` lista os runs (mais recente primeiro): nome/runId/data/steps/resumo-pass-fail/verdict; link para `/runs/:id`.

#### Why this step (action + reasoning)
1. **What:** substitui o `GET /` atual (redirect ao mais recente) por uma página de listagem; adiciona `renderListing` em `render.ts`.
2. **Why now:** fecha o Sub-goal 4 (DoD "lista cenários e execuções"). Reusa `loadRun` + `loadVerdict` (core).

#### Evidence
Blueprint §"T3"/"D5". `knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/components/history/rest/Card.vue` (campos de listagem).

#### Files to edit
```
src/web/server.ts — GET / passa a listar (em vez de redirect)
src/web/render.ts — renderListing(items) (NEW função)
src/web/render.test.ts — caso de renderListing
src/web/server.test.ts — caso GET / lista runs
```

#### Deep file dependency analysis
`server.ts`/`render.ts` (M0/M1). `GET /` muda de 302→200 com HTML de listagem. Lê `runs/` (`readdir` + `loadRun`) + `loadVerdict` por run. Downstream: E2E.

#### Deep Dives
- `listRuns(dir)`: `readdir` filtrando `.json` com stem UUID (reusa o filtro do M0); por run **[EC-2]** `loadRun` em try/catch — arquivo corrompido é PULADO (ou listado como "(inválido)"), NÃO propaga (um run ruim não derruba a listagem toda); + `loadVerdict`; computa `passFail` (todos asserts pass?), ordena por `createdAt` desc.
- `renderListing(items)`: tabela com nome (ou "(sem cenário)"), runId (link), createdAt, nº steps, ✓/✗/—, verdict (approved/rejected/pendente).
- Edge: nenhum run → "no runs yet".
- Invariant: escapa tudo; não executa nada (só lê).

#### Tasks
1. `listRuns` helper (server ou core).
2. `renderListing`.
3. `GET /` → 200 listagem.

#### TDD
```
RED:     web_server_root_lists_runs() — (integração) com 2 runs persistidos, GET / retorna 200 com HTML contendo ambos os runIds e o resumo
RED:     render_listing_shows_name_and_verdict() — renderListing marca nome do cenário, "pendente"/"approved", e ✓/✗
RED:     listing_skips_corrupt_run_file() — [EC-2] com 1 run válido + 1 arquivo .json corrompido em runs/, GET / retorna 200 listando o válido (não 500)
GREEN:   implementar até passar
REFACTOR: None expected
VERIFY:  npx vitest run src/web/
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] GET / lista runs (200, HTML com runIds + resumo) — `npx vitest run src/web/` verde
- [ ] Run sem name → "(sem cenário)"; sem verdict → "pendente" — verificado por `npx vitest run src/web/` verde
- [ ] Pass: cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/web/` verde

### T2.2 — Form de verdict + `POST /runs/:id/verdict`

#### Objective
`/runs/:id` exibe form de verdict; `POST /runs/:id/verdict` valida, persiste via `saveVerdict` e redireciona (303).

#### Why this step (action + reasoning)
1. **What:** `render.ts` adiciona o form de verdict na página do run; `server.ts` adiciona o roteamento POST (parse de form url-encoded via `URLSearchParams`), chama `saveVerdict`, redireciona 303 para `/runs/:id`.
2. **Why now:** fecha o Sub-goal 5 + DoD #2 (humano registra verdict persistido). É o **caller de produção** do verdict store (wiring pillar a).

#### Evidence
Blueprint §"D3"/"D5". `architecture.md` §2 (validação na fronteira). M0: `src/web/server.ts` (EC-1 validação do `:id` reusada).

#### Files to edit
```
src/web/server.ts — POST /runs/:id/verdict (parse form, valida :id UUID, loadRun existe?, saveVerdict, 303); GET /runs/:id passa a exibir form + verdict atual
src/web/render.ts — verdictForm(runId, currentVerdict) + selo de verdict no topo do run
src/web/server.test.ts — POST grava verdict; verdict inválido → 400; run inexistente → 404; :id traversal → 400
```

#### Deep file dependency analysis
`server.ts`/`render.ts`. POST é novo método (server era GET-only — 405 antes). Reusa `RUN_ID_RE` (EC-1, anti path-traversal) no path do verdict. Caller de produção de `saveVerdict` (core). Downstream: E2E.

#### Deep Dives
- Rota `POST /runs/:id/verdict`: valida `:id` contra `RUN_ID_RE` (→ 400 se não-UUID); confirma `loadRun(runs/:id.json)` existe (→ 404 se ENOENT, Q2); lê o body (`req` data → string), `new URLSearchParams(body)`; extrai `verdict` + `note`; monta `{runId:id, verdict, note, decidedAt: new Date(now()).toISOString()}`; `saveVerdict` (zod valida → 400 em valor inválido); responde **303** `Location: /runs/:id`.
- `GET /runs/:id` (existente): adiciona `verdictForm` (radio approved/rejected + textarea note + submit) + selo do verdict atual (loadVerdict). **[EC-1]** o selo/listagem renderizam a `note` e o `verdict` SEMPRE via `escapeHtml` (note é input do humano → anti-XSS armazenado).
- Body parse: `http` não tem body parser nativo — ler `req` via `for await (const chunk of req)` ou `data`/`end` events; cap de tamanho do body (ex. 1 MB) p/ não abusar.
- Invariant: stdout/protocolo intactos; POST só no path de verdict (outros POST → 405).

#### Pseudo-code / Signatures
```pseudocode
POST /runs/:id/verdict:
  if !RUN_ID_RE.test(id): 400
  if !exists(runs/id.json): 404
  body = await readBody(req, maxBytes=1MB)
  params = new URLSearchParams(body)
  try: saveVerdict({runId:id, verdict:params.get("verdict"), note:params.get("note")||undefined, decidedAt: isoNow()})
  catch ZodError: 400
  303 Location: /runs/id
```

#### Tasks
1. `readBody(req, max)` helper.
2. Roteamento POST + validação + saveVerdict + 303.
3. `verdictForm` + selo no render do run.

#### TDD
```
RED:     post_verdict_persists_and_redirects() — POST approved → 303 Location /runs/:id; loadVerdict(id) == approved
RED:     post_verdict_invalid_value_is_400() — verdict=maybe → 400 (zod), nada gravado
RED:     post_verdict_missing_run_is_404() — POST p/ runId UUID inexistente → 404
RED:     post_verdict_traversal_id_is_400() — :id não-UUID → 400 (anti path-traversal)
RED:     post_verdict_missing_field_is_400() — [EC-3] body sem verdict= → 400 (zod), nada gravado
RED:     get_run_shows_verdict_form() — GET /runs/:id contém o form de verdict (radio + note)
RED:     render_verdict_escapes_note() — [EC-1] note "<script>" renderizada escapada (&lt;script&gt;), não crua
GREEN:   implementar até os 7 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/web/server.test.ts
```

#### Concurrency tests
(none — single-threaded)
Nota: `http.Server` atende requests assíncronos, mas o verdict é gravado por arquivo independente (last-write-wins, single-user M2); sem estado mutável compartilhado.

#### Acceptance Criteria
- [ ] Os 7 RED tests passam — `npx vitest run src/web/server.test.ts` verde
- [ ] verdict persistido + 303; inválido/ausente → 400; run ausente → 404; traversal → 400; note escapada (EC-1)
- [ ] run_request/run_scenario (M0/M1) e GET existentes seguem funcionando — `npm test` verde (suíte M0/M1+M2)
- [ ] Pass: cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/web/server.test.ts` verde; POST é caller de produção do verdict store (wiring a)

---

## Phase 3: E2E + Integration Validation

**Objective:** provar o loop de revisão ponta-a-ponta.

### T3.1 — E2E review + CHANGELOG

#### Objective
E2E: persiste um run → `GET /` lista → `POST` verdict → recarrega e o verdict aparece (na listagem e no run).

#### Why this step (action + reasoning)
1. **What:** cria `src/review-e2e.test.ts` (`e2e_review_lists_renders_and_records_verdict` — métrica do Goal) + CHANGELOG `[Unreleased]`.
2. **Why now:** prova do Sub-goal 6 e dos 3 DoDs (lista, exibe, registra verdict persistido). Depende de Phase 2.

#### Evidence
ROADMAP §M2 DoD; Blueprint §"D5".

#### Files to edit
```
src/review-e2e.test.ts (NEW) — loop completo de review
CHANGELOG.md — [Unreleased] § Added (M2)
```

#### Deep file dependency analysis
NEW. Importa `buildWebServer` (web), `buildRunEnvelope`/`persistRun`/`loadVerdict` (core). Sobe `buildWebServer` real + faz GET/POST via `fetch`.

#### Deep Dives
- Persiste 1 run (envelope com name + 1 step com asserts) em tmpdir; HODOR_RUNS_DIR + HODOR_VERDICTS_DIR no tmpdir.
- `buildWebServer.listen(0)`; `GET /` → 200, HTML contém o runId + "(pendente)".
- `POST /runs/:id/verdict` (body `verdict=approved&note=ok`) → 303; `loadVerdict(id)` == approved.
- `GET /runs/:id` → HTML contém "approved"/selo de verdict + os asserts.

#### Tasks
1. Escrever o E2E.
2. CHANGELOG.

#### TDD
```
RED:     e2e_review_lists_renders_and_records_verdict() — run persistido → GET / lista (pendente) → POST verdict approved (303) → loadVerdict==approved → GET /runs/:id mostra o verdict (métrica do Goal)
GREEN:   ajustar wiring até passar (sem alterar contratos anteriores)
REFACTOR: None expected
VERIFY:  npx vitest run src/review-e2e.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `e2e_review_lists_renders_and_records_verdict` verde (metric do Goal)
- [ ] CHANGELOG `[Unreleased] § Added` com o M2
- [ ] Pass: `npm test` (suíte inteira) verde; `npm run typecheck` 0 erros; cada arquivo ≤ 500 linhas (`wc -l`)

#### DoD
- [ ] `npm test` verde; CHANGELOG atualizado

---

## Coverage Matrix

| # | Gap / Requirement (ROADMAP §M2 DoD) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Web app lista cenários e execuções | T1.1, T2.1 | envelope `name` + `GET /` listagem |
| 2 | Por step exibe request/response/headers + asserts/resultado | T1.3 (+ M1) | `pickRenderer` + render de steps/asserts (reuso M1) |
| 3 | Humano registra verdict (aprovado/rejeitado + nota) persistido | T1.2, T2.2 | verdict store + `POST /runs/:id/verdict` |
| 4 | Pass/fail por assert visualmente evidente | T2.1, T2.2 (+ M1) | cores verde/vermelho (M1) + selo de resumo por run |
| 5 | Risco #1 (não inflar p/ cliente Insomnia) | T2.1, T2.2 | web UI (listagem + verdict) construída em `http`/HTML nativos, ZERO framework/dep nova |
| 6 | Risco #2 (payload grande/binário) | T1.3 | `pickRenderer` binário omitido + truncamento |
| 7 | Demonstração ponta-a-ponta | T3.1 | `e2e_review_lists_renders_and_records_verdict` |

**Coverage: 7/7 gaps cobertos (100%)**

## Global Definition of Done

- [ ] Todas as fases completas
- [ ] Todos os testes verdes — `npm test`
- [ ] Zero erros de tipo — `npm run typecheck`
- [ ] Zero warnings de lint — `npm run typecheck` (tsc --strict)
- [ ] Budget de tamanho respeitado (≤ 500 linhas/arquivo, `rules/architecture.md`)
- [ ] CHANGELOG.md atualizado em `[Unreleased]` (Unbreakable Rule 6)
- [ ] Compatibilidade: run_request/run_scenario (M0/M1) + GET /runs/:id continuam funcionando (envelope `name` aditivo; web amplia rotas sem quebrar as existentes)
- [ ] Plan-specific: ZERO dep nova (D1); verdict store no core (web não decide regra); pass/fail evidente; binário não embutido
- [ ] **Runtime-metric proof** — não há contador novo no M2; a métrica observável é o verdict persistido (`loadVerdict` != null após POST), exercitado no E2E
- [ ] **Plan archived** — mover para `knowledge-base/plans/completed/` após `/review` READY_TO_MERGE + merge do PR

## Failure scenarios

M2 toca I/O de arquivo (runs/verdicts) e atende requests HTTP (server). Modos de falha realistas:

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `verdicts/` (fs, escrita) | POST com `verdict` inválido (nem approved/rejected) | POST `verdict=maybe` (`post_verdict_invalid_value_is_400`) | `VerdictSchema` lança na fronteira → **400**, nada gravado |
| `runs/` (fs, leitura) | POST verdict para run inexistente | POST a runId UUID sem arquivo (`post_verdict_missing_run_is_404`) | **404** (Q2); nenhum verdict órfão gravado |
| `runs/:id` (input) | path-traversal no `:id` (POST e GET) | `:id` não-UUID (`post_verdict_traversal_id_is_400`) | **400** (EC-1 reusado); nenhum arquivo fora de runs/ tocado |
| response body grande/binário (render) | body de texto > 64 KB ou content-type binário | render com body grande / `image/png` (`truncate_marks_large_text`, `pick_renderer_binary_for_non_text_or_missing`) | texto truncado com aviso; binário omitido (metadados) — UI não trava (risco #2) |

## Final Phase: Integration Validation (MANDATORY)

> Roda DEPOIS de todas as fases.

**Objective:** validar o loop de review num workload real.

### Execution

```
npm test                  # unit + integração + e2e (vitest run)
npm run typecheck         # 0 erros (tsc --noEmit)
npx vitest run --coverage # coverage (≥ 90% no core novo: verdict, pickRenderer)
npm audit                 # 0 CRITICAL/HIGH
```

### Acceptance Criteria

- [ ] Todas as suítes verdes (unit + integração + e2e), incl. M0/M1 (backward-compat)
- [ ] Coverage ≥ 90% nos arquivos novos do core (`verdict.ts`) + helpers (`pickRenderer`)
- [ ] Zero erros de tipo
- [ ] Verdict-persistido proof — `loadVerdict()` != null após o POST no E2E
- [ ] Failure scenarios verdes — as 4 linhas exercitadas (verdict inválido 400; run ausente 404; traversal 400; truncamento/binário)
- [ ] `npm audit` 0 CRITICAL/HIGH

### If Validation Fails

1. Identificar falhas causadas por M2 vs M0/M1 (estes devem continuar verdes).
2. Corrigir todas antes de declarar completo.
3. Re-rodar a cadeia.
