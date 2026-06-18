# Blueprint: M2 — Web app de review (listagem + req/resp/headers + verdict humano)

> Discovery executada sobre `hoppscotch` (UI de inspeção) para decidir, antes de codar: framework vs server-rendered nativo (risco #1), render por content-type (risco #2), modelo do verdict humano, e listagem de execuções. Verdict de `/discover-confidence`: **SHIPPABLE** (score 100, 0 hard caps — 2026-06-18). Plano: `.claude/knowledge-base/discoveries/plans/m2-review-webapp-plan.md` (v1.1).

## Context

M2 (`ROADMAP.md` §M2, depende de M1 v0.2.0) pede: (1) web app **lista cenários e execuções** + por step req/resp/headers + asserts/resultado; (2) humano registra **verdict** (aprovado/rejeitado + nota) **persistido**; (3) pass/fail **visualmente evidente**. Riscos: (#1) não inflar para cliente Insomnia (foco em revisão, não autoria); (#2) payloads grandes/binários travarem a UI. O ROADMAP defere a decisão de framework para o M2. O M0/M1 já têm `src/web/server.ts` (HTTP nativo, GET-only) + `src/web/render.ts` (render de steps + asserts/captures). Restrições: `architecture.md` §1–§2 (verdict store no core; web é adaptador), `parsimony-ladder.md` (rung 2/3 native primeiro).

## Objective

Decidir a stack da UI + render por content-type + modelo do verdict de modo que a review app fique focada em revisão (risco #1), trate não-texto sem travar (risco #2), e persista o verdict (alinhado a M3).

## Coverage Corner 1 — Integration Tests

**Pergunta (Q4):** Como o hoppscotch testa a seleção de lens por content-type?

hoppscotch testa `getSuitableLenses` em `.claude/knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/helpers/lenses/__tests__/lenses.sample` (um spec vitest com extensão `.sample`): `describe("getSuitableLenses")` com casos como *"returns raw lens if no content type reported (null/undefined)"*. Ou seja, o dispatch é coberto por testes de mapeamento content-type→lens + o fallback raw.

**Constatação honesta (EC-1):** o arquivo tem sufixo `.sample` (não `.spec.ts`) — possivelmente excluído do runner padrão; o conteúdo de teste existe mas a cobertura é frouxa. **Aplicação ao Hodor (oposto, mais rigoroso):** adicionar um unit test PRÓPRIO de `pickRenderer(contentType)` cobrindo: JSON → json renderer; sem content-type → raw fallback; binário (image/pdf) → omitido; texto grande → truncado. (testing.md §2: a lógica de dispatch é regra de negócio testável.)

## Coverage Corner 2 — Dependencies

**Pergunta (Q5):** Footprint de framework do hoppscotch vs necessidade do Hodor-review.

`.claude/knowledge-base/references/hoppscotch/packages/hoppscotch-common/package.json` declara **102 dependencies**, incluindo `vue@3.5.34` (runtime) e `vite@7.3.2` (dev/bundler), além de libs de estado/i18n/editor. Esse footprint serve uma app de **autoria interativa + real-time** (editores de request, ambientes, colaboração) — NÃO uma UI de **revisão read-only + um POST de verdict**.

**Decisão para o Hodor (Rule 9 / parsimony rung 2-3):** a review app do M2 NÃO adota framework. O server `http` nativo (M0/M1) + HTML server-rendered + um handler POST cobrem 100% do DoD (listar, exibir, registrar verdict). Adotar Vue/React introduziria 100+ deps, um bundler e um modelo de estado client-side que o DoD não exige — exatamente o risco #1 (inflar para cliente Insomnia). Dep nova de runtime no M2: **zero**.

## Coverage Corner 3 — Tools

**Pergunta (Q6):** Build/dev do hoppscotch (Vite/Vue) vs Hodor (tsc/tsx).

`.claude/knowledge-base/references/hoppscotch/packages/hoppscotch-common/package.json` scripts: `test: "vitest --run"`, `dev: "pnpm exec npm-run-all -p -l dev:*"` (orquestra múltiplos watchers), build via Vite (bundler). Adotar esse modelo traria um **pipeline de bundling** (Vite) + watchers — custo de tooling desproporcional para servir HTML de revisão.

**Decisão para o Hodor:** manter a stack atual — `tsc --noEmit` (typecheck) + `tsx` (rodar TS direto) + `vitest` (testes). O web server nativo serve HTML server-rendered sem bundler. Sem novo pipeline. CSS inline no HTML (como o `render.ts` do M0/M1 já faz). Dev local: `npm run web`.

## Coverage Corner 4 — Techniques

### T1 — Render por content-type (padrão lens) + fallback (Q1, risco #2)

hoppscotch seleciona o renderer por content-type em `.claude/knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/helpers/lenses/lenses.ts:30` (`getSuitableLenses`): lê o header `content-type` **case-insensitive** (`h.key.toLowerCase() === "content-type"`, `lenses.ts:42`); **sem content-type → `rawLens` fallback** (`lenses.ts:47`); cada lens declara `isSupportedContentType` (`jsonLens.ts:32` = `isJSONContentType`; `rawLens.ts:6` = `() => true`, o catch-all). Ordem: `[jsonLens, imageLens, htmlLens, xmlLens, pdfLens, audioLens, videoLens, rawLens]` (`lenses.ts:19`).

**Aplicação M1→M2 (Hodor):** uma função `pickRenderer(contentType): "json"|"text"|"binary"` no `render.ts`: JSON content-type → pretty JSON; texto (text/*, xml, javascript) → `<pre>` escapado; senão (image/pdf/audio/video/octet-stream) → **omitido** com nota `(binary — content-type: X)`. O M0/M1 já tem o esqueleto disso (`TEXTUAL` regex + `bodyBlock`); M2 o formaliza como dispatch nomeado + adiciona truncamento.

### T2 — Payload grande/binário (Q2, risco #2 parte 2)

hoppscotch tem um lens por tipo não-texto, cada um declarando seu `isSupportedContentType`: `.claude/knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/helpers/lenses/imageLens.ts`, `.claude/knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/helpers/lenses/pdfLens.ts`, `.claude/knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/helpers/lenses/htmlLens.ts`, `.claude/knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/helpers/lenses/xmlLens.ts`, e `.claude/knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/helpers/lenses/rawLens.ts` como catch-all. Para uma review app server-rendered (sem player de mídia), a estratégia é mais simples: **não embutir binário** no HTML. 

**Aplicação Hodor:** (a) content-type não-texto → exibir metadados (tipo + tamanho), NÃO o conteúdo; (b) corpo de texto acima de um limite (ex. 64 KB) → **truncar** com aviso `(truncado — N bytes; ver arquivo de run)`. Isso impede travar o browser (risco #2) sem lazy-load complexo (YAGNI no M2).

### T3 — Listagem de execuções (Q3)

`.claude/knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/components/history/rest/Card.vue` mostra, por item de history: `entry.request.method` (`:15`), `entry.request.endpoint` (URL, `:29`) e `duration` (`responseMeta.duration`, `:116-123`). Um card de listagem = método + url + tempo (+ status).

**Aplicação Hodor:** a listagem (GET `/`) lista os **runs** em `runs/` ordenados por `createdAt` desc; por item: nome do cenário (quando presente), `runId`, `createdAt`, nº de steps, **resumo pass/fail** (✓ se todos asserts passaram, ✗ caso contrário) e o **verdict** (aprovado/rejeitado/pendente). Link para `/runs/:id`.

## Cross-cutting Comparison

| Dimensão | hoppscotch | Decisão M2 (Hodor) |
|---|---|---|
| Stack UI | Vue 3.5 + Vite (102 deps) — autoria/real-time | **HTTP nativo + HTML server-rendered** (0 deps novas) — revisão (risco #1) |
| Render de body | lens por content-type (8 renderers Vue) | `pickRenderer`: json/text/binary; binário omitido (metadados) |
| Payload grande/binário | renderers dedicados (image/pdf/...) | omitir binário + truncar texto > limite (risco #2) |
| Listagem | history Card (method/url/duration) | listing de runs (cenário/runId/data/steps/pass-fail/verdict) |
| Verdict | (não existe) | `{runId, verdict, note?, decidedAt}` em `verdicts/{runId}.json` (POST) |
| Build | Vite bundler + watchers | tsc/tsx, sem bundler |
| Teste | `lenses.sample` (frouxo) | unit test próprio de `pickRenderer` + integração do POST verdict |

## ADRs

### D1 — Review app server-rendered nativa, SEM framework (risco #1)

**Decision:** a web app de review do M2 continua sobre `http` nativo + HTML server-rendered (extensão do `src/web/` do M0/M1). NENHUM framework (Vue/React/Svelte) e NENHUM bundler.

**Rationale:** o footprint do hoppscotch (102 deps, Vue+Vite — `package.json`) serve autoria interativa/real-time, não uma UI read-only + 1 POST. O DoD (listar, exibir, registrar verdict) é 100% coberto por server-rendering. `parsimony-ladder` rung 2-3 (native primeiro) + risco #1 (não inflar para cliente Insomnia). Autoria é do agente via MCP, não da web app.

**Alternatives considered:** Vue/Vite como hoppscotch (rejeitado — 100+ deps + bundler + estado client p/ uma UI de revisão = risco #1); HTMX/Alpine leve (rejeitado M2 — server-rendering puro já basta; reavaliar só se M2+ exigir interatividade real).

**Consequences:** zero dep de runtime nova; sem pipeline de build; a UI é HTML+CSS inline. Interatividade rica (se algum dia necessária) seria decisão futura com ADR próprio.

### D2 — `pickRenderer` por content-type + truncamento (risco #2)

**Decision:** `render.ts` ganha `pickRenderer(contentType): "json"|"text"|"binary"`. JSON → pretty; texto → `<pre>` escapado; binário → metadados (tipo/tamanho), conteúdo NÃO embutido. Corpo de texto > 64 KB → truncado com aviso.

**Rationale:** espelha o `getSuitableLenses` do hoppscotch (`lenses.ts` — content-type case-insensitive, raw fallback) mas server-side e mínimo. Mitiga o risco #2 (binário/grande travar) sem lazy-load (YAGNI).

**Alternatives considered:** renderers de mídia dedicados como hoppscotch (rejeitado — review não precisa tocar áudio/vídeo; omitir basta); sem truncamento (rejeitado — risco #2).

**Consequences:** binário não é inspecionável no M2 (metadados só) — aceitável p/ revisão de API (corpos são tipicamente JSON/texto); inspeção de mídia é YAGNI.

### D3 — Verdict: `{runId, verdict, note?, decidedAt}` persistido; POST + validação no core

**Decision:** verdict = `{ runId, verdict: "approved"|"rejected", note?: string, decidedAt: ISO }`, validado por zod (schema no core), persistido em `verdicts/{runId}.json`. Registrado via `POST /runs/:id/verdict` (form). O core expõe `saveVerdict`/`loadVerdict`. Verdict é por **run** (a execução é o que existe em disco; "verdict por cenário" = verdict sobre uma execução do cenário).

**Rationale:** verdict é a tese central do produto (revisão humana) — não há referência (ADR D3 do plano; design próprio). Persistência separada do run (não muta o run bruto) prepara M3 (versionável). `architecture.md` §2: validação na fronteira (zod), store no core.

**Alternatives considered:** embutir o verdict no arquivo de run (rejeitado — mutar o run bruto polui o artefato de execução; separar facilita o "run normalizado p/ revisão" de M3); verdict por nome de cenário (rejeitado M2 — runs é o que tem id estável; agrupar por nome é da listagem, não do verdict).

**Consequences:** `verdicts/` é um novo diretório de artefatos (gitignored como `runs/` no M2; M3 decide o versionamento). O POST exige parse de form no web server (hoje GET-only).

### D4 — Envelope de run ganha `name` (nome do cenário) OPCIONAL — aditivo

**Decision:** `buildRunEnvelope` passa a aceitar um `name?` opcional e `runScenario` o repassa (= `scenario.name`); o `RunEnvelopeSchema` ganha `name: z.string().optional()`. `schemaVersion` mantido `1` (aditivo).

**Rationale:** M2 lista "cenários e suas execuções" — precisa do nome do cenário no run para agrupar/rotular. Hoje o envelope não o guarda (baseline). Aditivo-opcional = backward-compatible (runs M0/M1 sem `name` seguem válidos), mesmo padrão do RunStep no M1 (D4 do M1).

**Alternatives considered:** `schemaVersion:2` + migração (rejeitado — aditivo-opcional basta, KISS); arquivo de índice separado cenário→runs (rejeitado M2 — derivável da listagem por mtime + name; YAGNI).

**Consequences:** `run_request` (M0, sem cenário) produz run sem `name` → listado como "(sem cenário)". `run_scenario` passa o `name`.

### D5 — Listagem em `GET /`; verdict via `POST`; pass/fail evidente

**Decision:** `GET /` lista os runs (mais recente primeiro) com nome/runId/data/steps/resumo-pass-fail/verdict; `GET /runs/:id` (existente) exibe os steps + asserts/captures + form de verdict; `POST /runs/:id/verdict` grava o verdict e redireciona. Pass/fail por assert usa as cores já existentes (verde/vermelho) + um selo de resumo por run.

**Rationale:** fecha os 3 DoDs. O web server hoje é GET-only — M2 adiciona o roteamento POST (com parse de `application/x-www-form-urlencoded`). Mantém o adaptador fino (delega verdict ao core).

**Alternatives considered:** API JSON + SPA (rejeitado — risco #1); verdict via MCP tool (rejeitado — o verdict é ato do HUMANO na web app, não do agente).

**Consequences:** o web server deixa de ser GET-only (aceita POST no path de verdict); validação anti-CSRF é YAGNI no M2 (local single-user; documentar).

## Recommendations

1. **(Q1/T1/D2)** `pickRenderer(contentType)` em `render.ts`: json/text/binary; content-type case-insensitive; binário → metadados; reusar `escapeHtml`/`bodyBlock` do M0/M1.
2. **(Q2/T2/D2)** truncar corpo de texto > 64 KB com aviso; binário nunca embutido.
3. **(Q3/T3/D5)** `GET /` lista runs (`readdir runs/` + `loadRun` + `loadVerdict`), ordenado por `createdAt` desc; item = nome/runId/data/steps/✓✗/verdict.
4. **(Q4)** unit test próprio de `pickRenderer` (json/sem-content-type→raw/binário/truncado) — o Hodor cobre o que o hoppscotch deixou frouxo.
5. **(Q5/Q6/D1)** ZERO framework/bundler novo; `http`+`render.ts` nativos; `tsc`/`tsx`/`vitest`.
6. **(D3)** `src/core/verdict.ts`: `VerdictSchema` (zod) + `saveVerdict`/`loadVerdict` (`verdicts/{runId}.json`); `POST /runs/:id/verdict` no web server (parse de form url-encoded); validação na fronteira.
7. **(D4)** `buildRunEnvelope(steps, deps, name?)` + `RunEnvelopeSchema.name?` (aditivo); `runScenario` repassa `scenario.name`.
8. **(D5)** form de verdict em `/runs/:id` (radio aprovado/rejeitado + textarea nota + submit POST); selo de verdict + resumo pass/fail por run na listagem.

## Blocked questions (if any)

Nenhuma — as 6 perguntas respondidas com citações verificadas; o modelo de verdict é design de plan-phase (sem referência, ADR D3 do plano), declarado honestamente.
