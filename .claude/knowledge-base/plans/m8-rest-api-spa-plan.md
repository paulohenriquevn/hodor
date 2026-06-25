---
slug: m8-rest-api-spa
milestone_id: M8
created_at: 2026-06-20
goal: Expor o core via uma API REST fina e entregar uma SPA React (Vite + shadcn/ui + Tailwind) com paridade de revisão, provado por um E2E verde do loop lista→detalhe→verdict na SPA contra a API.
---

# Plan: M8 — Fundação V3: API REST sobre o core + SPA React (paridade de revisão)

> Baseado no blueprint SHIPPABLE `knowledge-base/discoveries/blueprints/m8-rest-api-spa-blueprint.md`. Abre o V3 (UX/DX SOTA, híbrido agente-first). M8 entrega SÓ a FUNDAÇÃO: a API REST (novo adaptador fino sobre o core, espelhando `src/mcp`/`src/web`) + a SPA React com **paridade de LEITURA** da web SSR atual + o loop de verdict. Autoria visual começa no M9 — M8 não tem autoria (YAGNI). O SSR nativo permanece vivo em paralelo (ADR-7). Princípio transversal: **não reinventar** (Regra 9) — Vite/React/shadcn/Tailwind são libs SOTA; a API usa `http` nativo (sem framework web).

## Goal

> Entregar a API REST (`/api/runs`, `/api/runs/:id`, `/api/runs/:id/diff`, `POST /api/runs/:id/verdict`, `/api/drafts`, `/api/reviews/:id`) e a SPA React com paridade de leitura da web SSR, measured by o E2E `e2e_m8_review_loop_parity_in_spa` (lista→detalhe→registrar verdict) retornando verde com a API REST real.

## Context

`ROADMAP.md` §M8 (V3; depende de M2/M3/M5/M6, todos `[x]`) pede: (1) API REST fina sobre o core expõe listar/obter runs, diff (vs golden/previous), registrar verdict, listar/obter drafts e reviews — ZERO lógica de domínio nova; (2) SPA React (Vite+TS+shadcn/ui+Tailwind) com paridade de leitura da web SSR (lista, detalhe req/resp/headers, asserts verde/vermelho, selo golden, badge regressão); (3) E2E: loop de revisão completo na SPA contra a API; SSR nativo permanece funcional.

O blueprint fixou (ADR-1..7): API = adaptador `http` nativo delegando ao core (ADR-1, sem framework — Regra 9); SPA isolada em `web/` com Vite (ADR-2); dev via proxy Vite, prod via estáticos servidos pelo Node + SPA fallback (ADR-3); tipos compartilhados via `import type` do core, fonte única, zero runtime no browser (ADR-4); viewer replica `pickRenderer`/`truncate` do SSR — syntax-highlight é polish do M13 (ADR-5); status com cor semântica + tabela Name/Value de headers (ADR-6, lição Bruno+Hoppscotch); SSR nativo permanece vivo (ADR-7).

## Baseline Context (deep review of current state)

> Estado real pós-M7 (v0.7.0). `runs/`+`verdicts/` gitignored; `reviews/`+`drafts/` commitáveis. Single `package.json`, ESM NodeNext, vitest, 245 testes verdes.

### Files that will be touched

| File | LoC hoje | Last commit | Por que existe | Invariante a preservar |
|---|---|---|---|---|
| `src/web/server.ts` | 315 | `f9b06f4` | adaptador web SSR (M2) | refatorado p/ consumir `buildListing` do core (comportamento idêntico — testes web verdes); permanece vivo (ADR-7) |
| `src/web/render.ts` | 384 | `bb06e1f` | render HTML + `pickRenderer`/`truncate` (M2) | `pickRenderer`/`truncate` exportados p/ reuso pela SPA (paridade ADR-5); `ListingItem` type movido p/ core |
| `src/core/listing.ts` (NEW) | 0 | — | (a criar) `buildListing(dir, verdictsDir)` → `ListingItem[]` | extrai a lógica de `web/server.ts::listRuns` (golden/regressão/origin/pass-fail/sort mtime) — DRY |
| `src/core/index.ts` | 98 | `f9b06f4` | superfície pública (DIP) | add `buildListing`/`ListingItem`; preserva exports |
| `src/api/server.ts` (NEW) | 0 | — | (a criar) adaptador REST `http` nativo sobre o core | ZERO lógica de domínio; reusa validação de fronteira (RUN_ID_RE, body→413, 405+Allow, 404) |
| `web/` (NEW dir) | 0 | — | (a criar) SPA React/Vite | front nunca importa runtime do core (só `import type`) |
| `package.json` | — | `f9b06f4` | manifesto | add deps front + scripts `api`/`dev:web`/`build:web`; `web`/`mcp`/`test` intactos |
| `CHANGELOG.md` | — | (release) | contrato público | entrada em `[Unreleased] § Added` |

### Current callers / dependents

- **`listRuns`** (`web/server.ts:240`): caller único `route` (`GET /`). Após extrair `buildListing`, `web/server.ts` chama `buildListing`; a API REST também. Comportamento preservado → testes `web/server.test.ts` permanecem verdes (regressão).
- **`pickRenderer`/`truncate`** (`web/render.ts:51,59`): callers internos do render SSR. Exportados → a SPA importa a MESMA lógica de dispatch (paridade ADR-5).
- **core surface** (`core/index.ts`): `loadRun, loadVerdict, saveVerdict, buildReviewArtifact, saveReviewArtifact, ReviewArtifactSchema, diffRuns, findPreviousRun, findGoldenRun, scenarioKey, loadAllRunsIn, listDrafts, loadDraft, loadReviewArtifact` — tudo já exportado; a API só delega.

### Domain glossary

- **adaptador** — camada que traduz um protocolo (MCP/HTTP-SSR/HTTP-REST) para chamadas ao core; nunca contém regra de negócio (DIP, `rules/architecture.md`).
- **paridade de leitura** — a SPA mostra a MESMA informação que a web SSR para lista + detalhe + diff (não menos).
- **SPA fallback** — em prod, qualquer rota não-`/api/*` e não-asset serve `index.html` (client-side routing).

## Prior Art & Related Work

- **Interno:** `src/mcp/server.ts` e `src/web/server.ts` são os adaptadores-modelo (mesmo padrão de delegação ao core). `knowledge-base/discoveries/blueprints/m8-rest-api-spa-blueprint.md`.
- **Peers:** `knowledge-base/references/bruno` (React 19; `ResponsePane/StatusCode` cor por classe, `ResponseHeaders` tabela Name/Value, `QueryResult` dispatch por content-type); `knowledge-base/references/hoppscotch` (Vite+Tailwind; sistema de "lenses" por content-type, `findStatusGroup` cor semântica, status meta sticky, tabs body/headers).
- **Externo:** Vite + React + Tailwind + shadcn/ui é o caminho canônico SOTA para SPA; padrão proxy-dev/estáticos-prod é doc oficial Vite.

## ADRs

### ADR-1 — API REST é adaptador `http` nativo sobre o core (sem framework)
Decisão: `src/api/server.ts` espelha `src/web`/`src/mcp`; delega ao core; sem Express/Fastify. Rationale: KISS + Regra 9 (M0–M7 provam que `http` nativo basta; framework é dep redundante). **Alternativas rejeitadas:** Express/Fastify (dep redundante para 6 rotas); estender `src/web/server.ts` com rotas JSON (mistura HTML+JSON, viola SRP).

### ADR-2 — SPA React isolada em `web/`, build Vite
Decisão: app React 18 + TS em `web/`, separada de `src/`. Rationale: decisão de produto ("SPA Vite + REST sobre o core" + shadcn/ui). **Alternativas rejeitadas:** Next.js (reescreve a camada server, peso de SSR desnecessário); ilhas React no SSR (DX híbrida, não é a "SPA moderna" pedida).

### ADR-3 — Servir: dev via proxy Vite; prod via estáticos no Node
Decisão: dev = Vite dev server + proxy `/api`→Node; prod = `vite build`→`web/dist`, Node serve estáticos + SPA fallback. Rationale: um processo em prod, DX com HMR em dev. **Alternativas rejeitadas:** CDN/processo separado (overkill para uso local single-user).

### ADR-4 — Tipos compartilhados via `import type` do core
Decisão: a SPA faz `import type` dos tipos do core; nenhum import de valor. Rationale: fonte única evita divergência de contrato; `import type` é apagado no build (browser-safe). **Alternativas rejeitadas:** redeclarar tipos na SPA (divergência, viola DRY); OpenAPI+codegen (YAGNI p/ 6 endpoints).

### ADR-5 — Viewer replica `pickRenderer`/`truncate` do SSR (paridade; polish no M13)
Decisão: a SPA reusa o dispatch por content-type (json/text/binary) + truncamento do SSR; JSON em `<pre>` escapado. Rationale: paridade = mesma informação; syntax-highlight/folding é polish do M13 (YAGNI no M8). **Alternativas rejeitadas:** CodeMirror/react-json-view já no M8 (fora do escopo de paridade).

### ADR-6 — Status com cor semântica + tabela de headers
Decisão: status code colorido por classe (2xx verde, 3xx amarelo, 4xx/5xx vermelho); headers como tabela Name/Value; asserts verde/vermelho. Rationale: padrão unânime Bruno+Hoppscotch; paridade com o SSR.

### ADR-7 — SSR nativo permanece vivo
Decisão: `npm run web` continua funcional; a SPA coexiste no M8 (não substitui). Rationale: paridade antes de aposentar; rollback trivial.

## Dependencies

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| `react` (NEW) | `^18.3.1` | npm | — (decisão de produto) | SPA pedida |
| `react-dom` (NEW) | `^18.3.1` | npm | — | render DOM |
| `react-router-dom` (NEW) | `^6.28.0` | npm | TanStack Router (YAGNI p/ 3 rotas) | rotas client-side maduras |
| `class-variance-authority` (NEW) | `^0.7.1` | npm | (dep dos componentes shadcn) | variantes de estilo |
| `clsx` (NEW) | `^2.1.1` | npm | (dep shadcn) | merge de classNames |
| `tailwind-merge` (NEW) | `^2.6.0` | npm | (dep shadcn) | dedup de classes Tailwind |
| `lucide-react` (NEW) | `^0.469.0` | npm | (ícones shadcn) | ícones SVG (badges) |
| `@radix-ui/react-tabs` (NEW) | `^1.1.2` | npm | (primitivo shadcn Tabs) | tabs acessíveis body/headers |
| `@radix-ui/react-slot` (NEW) | `^1.1.1` | npm | (primitivo shadcn Button) | composição de componentes |
| `vite` (NEW, dev) | `^6.0.0` | npm | webpack (mais config), Parcel (menos adoção) | bundler SOTA + HMR |
| `@vitejs/plugin-react` (NEW, dev) | `^4.3.4` | npm | — | JSX/Fast Refresh |
| `tailwindcss` (NEW, dev) | `^3.4.17` | npm | CSS modules (verboso p/ design system) | estilo (decisão) |
| `postcss` (NEW, dev) | `^8.4.49` | npm | (pipeline tailwind) | processa Tailwind |
| `autoprefixer` (NEW, dev) | `^10.4.20` | npm | (pipeline tailwind) | prefixos CSS |
| `@testing-library/react` (NEW, dev) | `^16.1.0` | npm | Enzyme (deprecado) | testes de componente |
| `@testing-library/jest-dom` (NEW, dev) | `^6.6.3` | npm | — | matchers DOM |
| `jsdom` (NEW, dev) | `^25.0.1` | npm | happy-dom (menos fiel) | ambiente DOM p/ vitest |
| `@types/react` (NEW, dev) | `^18.3.18` | npm | — | tipos |
| `@types/react-dom` (NEW, dev) | `^18.3.5` | npm | — | tipos |

> shadcn/ui NÃO é um pacote — os componentes (`button.tsx`, `tabs.tsx`, `badge.tsx`, `card.tsx`, `table.tsx`) são copiados para `web/src/components/ui/`. As deps acima são o que esses arquivos importam. Verificação CVE: `/deps-audit m8-rest-api-spa` antes de qualquer código.

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Dependency Graph (fases)

```
F1 (API REST + buildListing)  ──┐
                                 ├─→ F3 (SPA leitura) ─→ F4 (diff + verdict) ─→ F5 (E2E + integ. validation)
F2 (scaffold Vite/React/serve) ─┘
```

F1 e F2 podem paralelizar (backend vs scaffold). F3 depende de F1 (API) + F2 (scaffold). F4 depende de F3. F5 fecha.

## Phase 1 — API REST (adaptador) + extração `buildListing` (DRY)

### T1.1 — Extrair `buildListing` para o core

#### Why this step
**Ação:** mover a lógica de montagem de `ListingItem[]` (golden/regressão/origin/pass-fail/sort por mtime) de `web/server.ts::listRuns` para `src/core/listing.ts`, exportar no index, e fazer o SSR consumir. **Raciocínio:** a API REST precisa da MESMA listagem; duplicar a lógica não-trivial de golden/regressão violaria DRY (CLAUDE.md §12). Extrair primeiro (refactor com comportamento preservado) mantém os testes web verdes e dá uma fonte única (ADR-1, Baseline Context "Current callers").

#### Files to edit
- `src/core/listing.ts` (NEW), `src/core/index.ts`, `src/web/server.ts` (passa a chamar `buildListing`), `src/web/render.ts` (move `ListingItem` type para o core; re-exporta ou importa).

#### Deep file dependency analysis
`listRuns` usa `loadAllRunsIn`/`findGoldenRunIn`/`diffRuns`/`scenarioKey`/`loadVerdict` (todos no core) + `readdir`/`stat` (fs). `ListingItem` hoje vive em `render.ts`. Mover o type para o core não quebra o render (importa de volta).

#### TDD
- RED: `src/core/listing.test.ts` → `build_listing_returns_items_sorted_by_mtime_newest_first`, `build_listing_marks_golden_and_regression`, `build_listing_skips_corrupted_run` (porta os casos do `web/server.test.ts`). Assert sobre `ListingItem[]`.
- GREEN: implementar `buildListing(dir, verdictsDir): Promise<ListingItem[]>` movendo a lógica.
- REFACTOR: `web/server.ts::listRuns` vira `return buildListing(dir, verdictsDir)`.

#### Concurrency tests
(none — single-threaded; fs sequencial como hoje).

#### Acceptance criteria
- `buildListing` retorna itens ordenados mtime-desc, com `regression`/`isGolden`/`origin`/`allAssertsPass`/`verdict` corretos.
- `web/server.test.ts` (listagem) permanece verde sem alteração (comportamento preservado).

#### DoD
- `npx vitest run src/core/listing.test.ts src/web/server.test.ts` verde; `tsc` limpo.

### T1.2 — `src/api/server.ts` (rotas REST)

#### Why this step
**Ação:** criar `buildApiServer(runsDir, verdictsDir, reviewsDir, draftsDir)` com `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/diff?vs=`, `POST /api/runs/:id/verdict`, `GET /api/drafts`, `GET /api/drafts/:id`, `GET /api/reviews/:id`, retornando JSON. **Raciocínio:** é o adaptador que a SPA consome (DoD #1). Delega 100% ao core (ADR-1); reusa a validação de fronteira do SSR (RUN_ID_RE anti path-traversal, body cap→413, 405+Allow, 404) — mesmo modelo de ameaça local.

#### Files to edit
- `src/api/server.ts` (NEW).

#### Deep file dependency analysis
Espelha `web/server.ts` trocando render HTML por `JSON.stringify`. `POST verdict` reusa a sequência EC-1 do M3 (build artifact em memória → ZodError→400 → saveVerdict+saveReviewArtifact → 201). Drafts via `listDrafts`/`loadDraft`; review via `loadReviewArtifact`.

#### TDD
- RED: `src/api/server.test.ts` (integration, fetch contra `http.Server` efêmero):
  - `api_lists_runs_as_json`, `api_get_run_returns_run_and_verdict`, `api_get_run_404_when_missing`, `api_diff_vs_golden`, `api_post_verdict_creates_artifact_201`, `api_post_verdict_invalid_400`, `api_bad_id_400`, `api_method_not_allowed_405_with_allow`, `api_body_too_large_413`, `api_lists_drafts`, `api_get_review_artifact`.
- GREEN: implementar as rotas delegando ao core.
- REFACTOR: extrair helpers de reply JSON.

#### Failure scenarios (external I/O — fs)
- run inexistente (`ENOENT`) → 404 (não 500). Reproduzido lendo id válido sem arquivo.
- verdict inválido no body → 400 antes de qualquer escrita (sem verdict órfão — EC-1 M3).
- body > 1MB → 413 (drena socket).

#### Acceptance criteria
- Todos os endpoints retornam o JSON esperado + status correto; nenhuma regra de negócio na API (só delegação).
- `POST verdict` grava verdict + review artifact (paridade com SSR).

#### DoD
- `npx vitest run src/api/server.test.ts` verde; `tsc` limpo.

### T1.3 — Script `npm run api` + métrica de request (wiring)

#### Why this step
**Ação:** `main()` em `src/api/server.ts` (bind loopback, porta `HODOR_API_PORT` default 4100) + log estruturado por request (método, path, status) em stderr. Script `"api": "tsx src/api/server.ts"`. **Raciocínio:** wiring triad — caller (script) + métrica (log observável). Bind loopback alinha ao modelo de ameaça local.

#### Files to edit
- `src/api/server.ts`, `package.json`.

#### TDD
- RED: teste que o handler loga `{event:"api_request", method, path, status}` (captura console.error).
- GREEN: middleware de log.

#### Acceptance criteria
- `npm run api` sobe em 127.0.0.1:4100; cada request loga uma linha estruturada.

#### DoD
- log estruturado presente; bind loopback verificado em teste.

## Phase 2 — Scaffold Vite + React + Tailwind + shadcn + servir estáticos

### T2.1 — Scaffold `web/` (Vite + React + TS + Tailwind + shadcn base)

#### Why this step
**Ação:** criar `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/vite.config.ts` (plugin-react + proxy `/api`→127.0.0.1:4100), `web/tsconfig.json` (`jsx: react-jsx`, `moduleResolution: bundler`, `import type` do core via path), `tailwind.config.js` + `postcss.config.js` + `web/src/index.css` (diretivas Tailwind), `web/src/lib/utils.ts` (`cn`), `web/src/components/ui/{button,badge,card,table,tabs}.tsx` (shadcn copiados). **Raciocínio:** fundação da SPA (ADR-2/3). O proxy preserva a fronteira (front fala só HTTP com a API).

#### Files to edit
- `web/**` (NEW), `package.json` (deps + scripts `dev:web`/`build:web`), `vitest` config (projeto jsdom para `web/`).

#### Deep file dependency analysis
Segundo tsconfig isolado evita conflito com o NodeNext do backend. vitest workspace: `node` para `src/**`, `jsdom` para `web/**`.

#### TDD
- RED: `web/src/App.test.tsx` (testing-library + jsdom) → `app_renders_title_hodor` (smoke: renderiza o cabeçalho "Hodor").
- GREEN: `App.tsx` mínimo com o título + `<RouterProvider>`.
- REFACTOR: extrair layout.

#### Acceptance criteria
- `npm run build:web` gera `web/dist/index.html`; `App.test.tsx` verde no ambiente jsdom; `tsc` (web/tsconfig) limpo.

#### DoD
- build OK; smoke test verde; backend `tsc` Node intacto.

### T2.2 — API serve estáticos `web/dist` + SPA fallback (prod)

#### Why this step
**Ação:** em `src/api/server.ts`, quando `web/dist` existe, servir assets estáticos e fazer fallback de rotas não-`/api` para `index.html`. **Raciocínio:** ADR-3 (um processo em prod). `/api/*` continua JSON; o resto serve a SPA.

#### Files to edit
- `src/api/server.ts`.

#### Deep file dependency analysis
Servir estáticos com `http` nativo: ler arquivo de `web/dist`, content-type por extensão, fallback index.html. Validar path (anti path-traversal: resolver e checar prefixo `web/dist`).

#### TDD
- RED: `src/api/server.test.ts` → `serves_index_html_fallback_for_non_api_route` (com `web/dist` fixture), `serves_static_asset_with_content_type`, `path_traversal_blocked_returns_404` (`/../../etc/passwd`), `api_route_still_json_when_dist_present`.
- GREEN: handler de estáticos + fallback.

#### Failure scenarios
- asset inexistente → fallback index.html (rota SPA), não 500.
- path traversal (`..`) → 404 (resolve+prefix check).

#### Acceptance criteria
- `/` serve index.html; `/assets/x.js` serve com content-type correto; `/../` bloqueado; `/api/runs` continua JSON.

#### DoD
- testes de estáticos verdes; path-traversal bloqueado.

## Phase 3 — SPA leitura (paridade lista/detalhe)

### T3.1 — api-client tipado (`web/src/api.ts`)

#### Why this step
**Ação:** módulo com `fetchRuns()`, `fetchRun(id)`, `fetchDiff(id, vs)`, `postVerdict(id, body)`, `fetchDrafts()`, `fetchReview(id)` usando `fetch` + `import type` do core. **Raciocínio:** ADR-4 (contrato tipado, fonte única). Centraliza chamadas (DRY).

#### Files to edit
- `web/src/api.ts` (NEW), `web/src/api.test.ts` (NEW).

#### TDD
- RED: `api_client_parses_runs`, `api_client_throws_on_404` com `fetch` mockado (vi.fn).
- GREEN: implementar.

#### Acceptance criteria
- Cada função retorna o tipo do core (`import type`); erro HTTP vira exceção tipada.

#### DoD
- `web/src/api.test.ts` verde.

### T3.2 — `<RunList>` (paridade da listagem)

#### Why this step
**Ação:** componente que consome `fetchRuns()` e renderiza tabela: nome, data, nº steps, pass/fail, verdict, badges (origin 🤖 agente, regressão ⚠, golden 🏆). **Raciocínio:** DoD #2 (paridade de leitura da listagem SSR). ADR-6 (badges/cores).

#### Files to edit
- `web/src/components/RunList.tsx` (NEW) + test.

#### TDD
- RED: `run_list_renders_rows_with_badges` (golden 🏆, regressão ⚠, origin 🤖 conforme dados), `run_list_links_to_detail`.
- GREEN: implementar com shadcn Table/Badge.

#### Acceptance criteria
- Mostra os MESMOS campos da listagem SSR; badges corretos; cada linha linka `/runs/:id`.

#### DoD
- testes do componente verdes.

### T3.3 — `<RunDetail>` (paridade do detalhe)

#### Why this step
**Ação:** componente que consome `fetchRun(id)` e renderiza, por step: request (method/url/headers/body) + response (status colorido por classe, headers tabela, body por content-type via `pickRenderer`/`truncate`) + asserts verde/vermelho. Tabs body/headers (shadcn Tabs). **Raciocínio:** DoD #2 (paridade do detalhe). ADR-5 (viewer)/ADR-6 (cores).

#### Files to edit
- `web/src/components/RunDetail.tsx` + `web/src/components/ResponseView.tsx` + `web/src/lib/render.ts` (porta `pickRenderer`/`truncate` ou importa via type+reimpl mínima) + tests.

#### Deep file dependency analysis
`pickRenderer`/`truncate` são funções puras sem I/O Node — podem ser importadas pela SPA via `import type`? Não, são valores. Decisão: extrair `pickRenderer`/`truncate` para um módulo puro browser-safe `src/core/contentType.ts` (sem imports Node) e importar como valor na SPA (é core puro, browser-safe). Re-exportar no index; `render.ts` SSR passa a importar de lá (DRY, paridade real — mesma função nos dois).

#### TDD
- RED: `run_detail_renders_steps_request_response`, `run_detail_status_color_by_class` (2xx verde/4xx vermelho), `run_detail_assert_pass_fail_colors`, `run_detail_json_body_rendered`, `run_detail_binary_body_omitted`.
- GREEN: implementar.

#### Acceptance criteria
- Detalhe mostra req/resp/headers/asserts idêntico em informação ao SSR; status colorido; body por content-type com truncamento.

#### DoD
- testes verdes; `pickRenderer`/`truncate` compartilhados (1 fonte).

### T3.4 — `<DraftList>` + link de review artifact (DoD #1: drafts/reviews)

#### Why this step
**Ação:** página read-only `/drafts` consumindo `fetchDrafts()` (lista cenários gerados pendentes — M4) + no `<RunDetail>`, quando há verdict, um link/seção "artefato versionado" via `fetchReview(id)`. **Raciocínio:** dá CALLER de produção aos endpoints de drafts/reviews da API (DoD #1 do ROADMAP exige expor drafts/reviews; sem caller seria dead export — FAIL_HARD no code-quality).

#### Files to edit
- `web/src/components/DraftList.tsx` + `web/src/components/ReviewArtifactLink.tsx` + tests.

#### TDD
- RED: `draft_list_renders_pending_drafts`, `review_link_shown_when_verdict_present`.
- GREEN: implementar.

#### Acceptance criteria
- `/drafts` lista drafts (read-only); detalhe com verdict mostra o artefato versionado. Nenhuma auto-aprovação (humano único aprovador — contrato M2).

#### DoD
- testes verdes; endpoints drafts/reviews têm caller de produção (wiring).

## Phase 4 — Diff + verdict (fecha o loop)

### T4.1 — `<DiffView>`

#### Why this step
**Ação:** componente que consome `fetchDiff(id, vs)` e mostra diff por step (status/headers/body), com toggle vs golden / vs previous. **Raciocínio:** DoD #2 (paridade do diff SSR M5/M6).

#### Files to edit
- `web/src/components/DiffView.tsx` + test.

#### TDD
- RED: `diff_view_shows_changed_fields`, `diff_view_toggle_golden_previous`, `diff_view_no_baseline_message`.
- GREEN: implementar (reusa `RunDiff` type do core).

#### Acceptance criteria
- Mostra o diff vs golden e vs previous; mensagem clara quando não há baseline.

#### DoD
- testes verdes.

### T4.2 — `<VerdictForm>` (registra verdict — nunca auto-aprova)

#### Why this step
**Ação:** form (approved/rejected + nota) que faz `postVerdict`; reflete o verdict atual; após sucesso, atualiza a UI. **Raciocínio:** DoD #3 (loop de verdict na SPA). Contrato M2: só o humano registra; nenhuma tool/feature auto-aprova.

#### Files to edit
- `web/src/components/VerdictForm.tsx` + test.

#### Failure scenarios (external I/O — POST /api)
- verdict inválido → API 400 → mensagem de erro na UI (não engole).
- run inexistente → 404 → mensagem.

#### TDD
- RED: `verdict_form_posts_and_reflects`, `verdict_form_shows_error_on_400`.
- GREEN: implementar.

#### Acceptance criteria
- Registrar verdict persiste (via API) e a UI reflete; erro de validação é mostrado, não engolido (CLAUDE.md §8).

#### DoD
- testes verdes.

### T4.3 — Rotas react-router

#### Why this step
**Ação:** `/` (RunList), `/runs/:id` (RunDetail + VerdictForm + link diff/review), `/runs/:id/diff` (DiffView), `/drafts` (DraftList). **Raciocínio:** navegação client-side (ADR-2).

#### Files to edit
- `web/src/App.tsx` (router), tests de roteamento.

#### TDD
- RED: `router_navigates_list_to_detail`, `router_detail_to_diff`.
- GREEN: configurar router.

#### Acceptance criteria
- Navegação entre as 4 telas funciona client-side.

#### DoD
- testes de roteamento verdes.

## Phase 5 — E2E paridade + Integration Validation

### T5.1 — E2E `e2e_m8_review_loop_parity_in_spa`

#### Why this step
**Ação:** teste que dirige o fluxo lista→abrir detalhe→registrar verdict na SPA, com a API REST real (`buildApiServer` sobre tmp dirs com fixtures de run) — o `fetch` da SPA bate na API de verdade (porta efêmera). **Raciocínio:** DoD #3 (E2E do loop na SPA). Prova paridade de leitura (DoD #2) + verdict.

#### Files to edit
- `web/src/m8-e2e.test.tsx` (NEW).

#### TDD
- RED: o E2E: monta API real com 1 run, renderiza `<App>` apontando o api-client para a porta da API, navega lista→detalhe, registra "approved", verifica que a API persistiu o verdict + review artifact e a UI reflete.
- GREEN: ajustes finais até verde.

#### Acceptance criteria
- O loop inteiro de revisão roda na SPA contra a API REST; verdict + artifact persistidos.

#### DoD
- `e2e_m8_review_loop_parity_in_spa` verde.

### T5.2 — Integration Validation (eat your own cooking)

#### Why this step
**Ação:** rodar a suíte inteira: `npm test` (backend + web), `npm run typecheck` (ambos tsconfig), `npm run build:web`, e confirmar o SSR nativo ainda sobe (`npm run web` smoke). CHANGELOG `[Unreleased] § Added`. **Raciocínio:** Regra de Completude — M8 não está pronto até a cadeia inteira passar e o SSR seguir vivo (ADR-7).

#### Files to edit
- `CHANGELOG.md`.

#### Acceptance criteria
- Toda a suíte verde; typecheck dos 2 tsconfig limpo; `web/dist` builda; SSR (`src/web`) e MCP (`src/mcp`) intactos (testes existentes verdes).

#### DoD
- `npm test` + `npm run typecheck` + `npm run build:web` verdes; 245 testes antigos + novos verdes; CHANGELOG atualizado.

## Failure scenarios (consolidado — external I/O)

- **fs (API lê runs/verdicts/drafts/reviews):** `ENOENT`→404; arquivo corrompido na listagem→pulado (não derruba); body grande no POST→413.
- **HTTP (SPA→API):** 400 (verdict inválido)→erro na UI; 404 (run sumiu)→erro na UI; rede caída→estado de erro (não tela branca).
- **static serving:** asset ausente→fallback index.html; path traversal→404.

## Coverage Matrix

| Requisito (ROADMAP §M8 DoD) | Task(s) |
|---|---|
| DoD #1 — API REST expõe runs/diff/verdict/drafts/reviews, delega ao core | T1.1, T1.2, T1.3, T3.4 (callers drafts/reviews) |
| DoD #2 — SPA paridade de leitura (lista, detalhe req/resp/headers, asserts, golden, regressão, diff) | T3.2, T3.3, T4.1 |
| DoD #3 — E2E loop de revisão na SPA; SSR vivo | T4.2, T4.3, T5.1, T5.2 |
| Fundação (Vite/React/Tailwind/shadcn + servir) | T2.1, T2.2 |
| Tipos compartilhados / api-client (ADR-4) | T3.1 |

## Drawbacks & Risks

| Risco | Sev. | Mitigação | Owner |
|---|---|---|---|
| Muitas deps novas de uma vez (React/Vite/shadcn) | MÉDIO | `/deps-audit` antes do código; libs SOTA mantidas; shadcn é copy-paste (sem lock-in) | impl |
| Front importar runtime do core (quebra browser) | ALTO | ADR-4 `import type`; `contentType.ts` é o ÚNICO valor importado (core puro browser-safe, zero Node); tsc pega import de valor indevido | impl |
| Duplicar lógica de domínio na API | MÉDIO | ADR-1 (delega) + extração `buildListing` (T1.1) | impl |
| Escopo inflar p/ autoria (M9) | MÉDIO | M8 é só leitura + verdict; autoria começa no M9 | plan |
| 2 tsconfig / 2 ambientes vitest aumentam complexidade de build | MÉDIO | vitest workspace declarativo; `typecheck` cobre ambos; documentar no README | impl |
| `pickRenderer`/`truncate` divergirem entre SSR e SPA | MÉDIO | extrair p/ `core/contentType.ts` (1 fonte, ambos importam) — T3.3 | impl |

## Unresolved Questions

- (none — todas as decisões resolvidas no blueprint. A escolha de NÃO trazer CodeMirror/react-json-view no M8 é consciente: polish do M13.)

## Global DoD

- [ ] Todas as tasks com TDD RED→GREEN→REFACTOR; testes verdes.
- [ ] `npm test` verde (backend node + web jsdom); 245 testes antigos preservados.
- [ ] `npm run typecheck` limpo (backend NodeNext + web bundler tsconfig).
- [ ] `npm run build:web` gera `web/dist`.
- [ ] SSR nativo (`src/web`) e MCP (`src/mcp`) intactos — testes existentes verdes (ADR-7).
- [ ] `npm audit` 0 vulnerabilidades (deps novas auditadas).
- [ ] Wiring triad por símbolo público novo: caller + integration test + métrica (API log).
- [ ] Nenhuma regra de negócio nos adaptadores (API/SPA) — só delegação (DIP, `rules/architecture.md`).
- [ ] Front nunca importa valor do core exceto `contentType.ts` (browser-safe).
- [ ] Humano único aprovador — nenhuma feature auto-aprova (contrato M2).
- [ ] CHANGELOG `[Unreleased] § Added` atualizado.
- [ ] Lint/complexidade: arquivos ≤ 500 LoC (`rules/architecture.md`); funções com responsabilidade única.

## Final Phase: Integration Validation

T5.2 é a fase de integração: a cadeia inteira (test + typecheck duplo + build:web + SSR/MCP intactos + E2E de paridade) DEVE passar. Se qualquer gate falhar, o plano falhou e volta ao `/implement` (não ao `/to-plan`, salvo defeito estrutural).
