# Blueprint: M8 — API REST sobre o core + SPA React (paridade de revisão)

**Date:** 2026-06-20
**Question:** Como expor o core puro do Hodor via uma API REST fina e construir uma SPA React (Vite + shadcn/ui + Tailwind) com paridade de revisão, preservando a fronteira DIP e sem perder o SSR nativo?
**Verdict:** SHIPPABLE
**Peers studied:** bruno (React 19, react-json-view, CodeMirror, diff custom), hoppscotch (Vue3+Vite+Tailwind, sistema de "lenses" por content-type, status meta sticky), o próprio `src/web` (SSR atual = baseline de paridade), `src/mcp` (adaptador-modelo).

## Estado atual (baseline de paridade — o que a SPA DEVE replicar)

O SSR nativo (`src/web/server.ts`, `src/web/render.ts`) entrega, delegando 100% ao core:

| Rota SSR | O que mostra | Endpoint REST equivalente (M8) |
|---|---|---|
| `GET /` | Listagem de runs: nome, data, nº steps, pass/fail, verdict, badge origin (🤖 agente), badge regressão ⚠, selo golden 🏆 | `GET /api/runs` → `ListingItem[]` (JSON) |
| `GET /runs/:id` | Detalhe: req/resp/headers por step, asserts verde/vermelho, verdict atual | `GET /api/runs/:id` → `{ run, verdict }` |
| `GET /runs/:id/diff?vs=golden\|previous` | Diff vs baseline | `GET /api/runs/:id/diff?vs=…` → `{ curr, baseline, diff, mode }` |
| `POST /runs/:id/verdict` | Grava verdict + review artifact | `POST /api/runs/:id/verdict` → 201 + artifact |

A lógica de montagem do `ListingItem` (golden/regressão por item, O(N) com `loadAllRunsIn`) vive HOJE em `src/web/server.ts::listRuns`. Duplicá-la na API violaria DRY → **extrair para o core** (`buildListing`), web SSR e API REST passam a consumir a mesma fonte.

Superfície do core já exporta tudo o que a API precisa: `loadRun, loadVerdict, saveVerdict, buildReviewArtifact, saveReviewArtifact, ReviewArtifactSchema, diffRuns, findPreviousRun, findGoldenRun, findGoldenRunIn, scenarioKey, loadAllRunsIn` (`src/core/index.ts`).

## ADRs (decisões de design)

### ADR-1 — API REST é mais um adaptador sobre o core (não um novo "backend")
A API vive em `src/api/server.ts`, espelhando `src/web` e `src/mcp`: servidor `http` nativo, ZERO lógica de domínio, delega ao core. Endpoints sob `/api/*` retornam JSON. **Alternativa rejeitada:** framework web (Express/Fastify) — KISS + o projeto já prova que `http` nativo basta (M0–M7); trazer framework é dep redundante (Regra 9 rung 4). **Alternativa rejeitada:** estender o SSR `src/web/server.ts` com rotas JSON — mistura duas responsabilidades (HTML vs JSON) no mesmo módulo (SRP).

### ADR-2 — SPA React isolada em `web/`, build com Vite
App React 18 + TS em `web/` (raiz Vite), separada de `src/` (backend). Stack: **Vite + React + Tailwind + shadcn/ui** (decisão do produto). Roteamento client-side com `react-router-dom`. **Alternativa rejeitada:** Next.js — SSR/full-stack reescreveria a camada server e traz peso desnecessário para uma SPA de review (decisão do produto: "SPA Vite + REST sobre o core"). **Alternativa rejeitada:** ilhas React no SSR atual — DX híbrida, não entrega a "SPA moderna" pedida.

### ADR-3 — Servir: dev via Vite proxy; prod via estáticos servidos pelo Node
- **Dev:** `vite` dev server (`web/`) com proxy `/api` → API Node (porta separada). HMR para DX.
- **Prod:** `vite build` → `web/dist`; a API Node serve os estáticos + SPA fallback (`index.html` para rotas não-`/api`). Um só processo em prod.
**Alternativa rejeitada:** servir o front de um CDN/processo separado em prod — overkill para uso local single-user (Constraint: runtime local). 

### ADR-4 — Tipos compartilhados via `import type` do core (fonte única, zero runtime)
A SPA importa `import type { RunEnvelope, Verdict, RunDiff, ... }` do core — apagado no build (não traz código Node ao browser). Evita divergência de contrato entre API e SPA (lição do Hoppscotch: model TS puro separado da UI). **Alternativa rejeitada:** redeclarar tipos na SPA — divergência inevitável (DRY). **Alternativa rejeitada:** gerar OpenAPI + codegen — YAGNI para 4 endpoints.

### ADR-5 — Viewer de response replica o dispatch por content-type do SSR (paridade)
A SPA reusa a lógica `pickRenderer` (json/text/binary) + `truncate` do SSR (`render.ts`) — paridade = mesma informação visível. JSON renderizado em `<pre>` com escape (M8) — syntax-highlight/folding via lib é melhoria de UX deixada para o **M13** (polish), não bloqueia paridade (YAGNI no M8). Tabs body/headers via shadcn `Tabs` (lição Bruno/Hoppscotch). **Alternativa rejeitada:** trazer CodeMirror/react-json-view já no M8 — fora do escopo de paridade; M13 cuida do polish.

### ADR-6 — Status com cor semântica + tabela Name/Value de headers (lição dos peers)
Status code colorido por classe (2xx verde, 3xx amarelo, 4xx/5xx vermelho) — padrão unânime Bruno+Hoppscotch. Headers como tabela. Asserts verde/vermelho (paridade com SSR).

### ADR-7 — SSR nativo permanece vivo (paridade antes de aposentar)
`npm run web` continua funcionando em paralelo. A SPA não substitui o SSR no M8 — coexiste. Aposentar o SSR é decisão pós-paridade (não no M8). Garante rollback trivial.

## Coverage Corner 1 — Integration Tests

- **API REST contra `http.Server` efêmero** (padrão já usado no core/web): subir `buildApiServer(tmpDirs)`, `fetch` real contra `/api/runs`, `/api/runs/:id`, `/api/runs/:id/diff`, `POST /api/runs/:id/verdict`; asserts sobre JSON + status codes (200/201/400/404/405/413). Reusa fixtures de run dos testes existentes.
- **Componentes React** com `@testing-library/react` + `jsdom`: render de `<RunList>`, `<RunDetail>`, `<DiffView>`, `<VerdictForm>` com dados mockados; asserts sobre texto/roles/badges (status color, golden, regressão).
- **E2E paridade** (DoD #3): testing-library dirige o fluxo lista→detalhe→registrar verdict contra um fetch mockado que bate na API REST real (ou MSW). Prova o loop de revisão inteiro na SPA.

## Coverage Corner 2 — Dependencies (todas via /deps-audit antes do código)

| Dep | Ecossistema | Papel | Rule 9 (rejeitadas) |
|---|---|---|---|
| `react`, `react-dom` (^18) | npm | SPA (decisão do produto) | — |
| `vite`, `@vitejs/plugin-react` | npm (dev) | bundler + HMR | webpack (mais config), Parcel (menos adoção) |
| `tailwindcss` (+ `postcss`/`autoprefixer` ou `@tailwindcss/vite`) | npm (dev) | estilo (decisão) | CSS modules (mais verboso para design system) |
| shadcn/ui deps: `class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/react-*` (tabs, slot), `lucide-react` | npm | componentes acessíveis copy-paste (decisão) | MUI (runtime pesado), Mantine (alternativa válida; produto escolheu shadcn) |
| `react-router-dom` (^6) | npm | rotas client-side | TanStack Router (YAGNI p/ 3 rotas) |
| `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` | npm (dev) | testes de componente | Enzyme (deprecado), Cypress (E2E pesado p/ M8) |

shadcn/ui NÃO é uma dependência de pacote — são componentes copiados para `web/src/components/ui/`; as deps acima são as que esses componentes importam.

## Coverage Corner 3 — Tools

- **Vite** — `npm run dev:web` (dev + proxy), `npm run build:web` (estáticos). 
- **vitest** — já no projeto; configurar um segundo projeto/ambiente `jsdom` para os testes da SPA (vitest workspaces ou `environmentMatchGlobs`), mantendo `node` para o backend.
- **tsc** — segundo `web/tsconfig.json` (`jsx: react-jsx`, `moduleResolution: bundler`) separado do `tsconfig.json` Node (NodeNext). `npm run typecheck` cobre ambos.
- **Tailwind CLI/plugin** — `tailwind.config` escaneando `web/src/**`.

## Coverage Corner 4 — Techniques

- **Adaptador fino** (já provado M0–M7): API delega ao core, sem regra de negócio. Wiring triad: caller (rota) + integration test (fetch) + métrica (log estruturado por request, como o web já faz no 500).
- **Extração para DRY:** `listRuns` → `buildListing` no core, consumido por web SSR + API.
- **Dispatch por content-type ("lenses" simplificado do Hoppscotch):** reusa `pickRenderer`/`truncate`.
- **Cor semântica por status HTTP** (Bruno `StatusCode` + Hoppscotch `findStatusGroup`).
- **Proxy dev + estáticos prod** (padrão Vite canônico) para preservar a fronteira (front nunca importa código Node de runtime; só `import type`).
- **Validação de fronteira reusada:** `RUN_ID_RE` (anti path-traversal), cap de body (413), 405 com `Allow` — copiados do SSR para a API (mesmo modelo de ameaça local).

## Riscos

1. **Escopo inflar para autoria/ambientes (M9–M11)** — mitigar: M8 é SÓ paridade de leitura + verdict. Autoria começa no M9.
2. **Duplicar lógica de domínio na API** — mitigar: ADR-1 (delega ao core) + extração `buildListing`.
3. **Front importar runtime do core (quebra browser)** — mitigar: ADR-4 (`import type` apenas); lint/tsc pega import de valor.
4. **Muitas deps novas de uma vez** — mitigar: `/deps-audit` antes do código; todas são libs SOTA mantidas; shadcn é copy-paste (sem lock-in).
5. **Perder feature do SSR na migração** — mitigar: ADR-7 (SSR vivo) + E2E de paridade explícito.

## Referências
- `src/web/server.ts`, `src/web/render.ts` (baseline de paridade)
- `src/core/index.ts` (superfície a consumir)
- `knowledge-base/references/bruno/packages/bruno-app/src/components/ResponsePane/` (StatusCode, ResponseHeaders, QueryResult)
- `knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/components/lenses/` + `helpers/findStatusGroup.ts`
