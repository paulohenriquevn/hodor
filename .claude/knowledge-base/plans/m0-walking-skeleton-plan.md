---
slug: m0-walking-skeleton
milestone_id: M0
created_at: 2026-06-18
goal: Entregar o walking skeleton do Hodor — tool MCP run_request executa um HTTP request, persiste o run em arquivo e a web app o renderiza — provado por um teste E2E verde.
---

# Plan: M0 Walking Skeleton — MCP `run_request` + persistência de run + web app de review mínima

> **Version 1.1** (absorveu EC-1 MUST-FIX path-traversal + EC-2/EC-3 SHOULD-TEST + EC-4 SSRF DOCUMENT de `knowledge-base/reviews/m0-walking-skeleton-edge-cases-2026-06-18.md`) — Prova a arquitetura inteira do Hodor na fatia mais fina: um MCP server TS (stdio) expõe a tool `run_request`, que delega a um **core puro** (execução HTTP via `fetch` nativo + captura de request/response/headers), persiste o resultado num envelope versionado `{schemaVersion, steps[]}` sob `runs/`, e uma web app mínima (módulo `http` nativo) lê esse arquivo e renderiza request/response/headers. Baseado no blueprint SHIPPABLE `knowledge-base/discoveries/blueprints/m0-walking-skeleton-blueprint.md`. A fronteira DIP core↔adaptadores e o envelope N-step desde já mitigam os dois riscos declarados do `ROADMAP.md` §M0.

## Goal

> Enable um agente de código a executar um HTTP request via a tool MCP `run_request` e um humano a inspecioná-lo numa web app, de modo que o loop agente→execução→arquivo→render funcione ponta-a-ponta, measured by o teste E2E `e2e_run_request_persists_and_renders` retornando verde.

## Context

O `ROADMAP.md` §M0 ("Walking skeleton") pede a fatia mais fina ponta-a-ponta antes de qualquer feature: uma tool MCP que executa um request, persiste o resultado e o exibe numa web app. É a fundação (sem dependências) sobre a qual M1–M3 fecham o V1.

O blueprint da fase DISCOVER (`knowledge-base/discoveries/blueprints/m0-walking-skeleton-blueprint.md`, verdict SHIPPABLE) fixou cinco decisões que este plano implementa: (D1) alvo SDK `@modelcontextprotocol/sdk` **v1.x estável** — não o v2-alpha do clone de referência; (D2) fronteira DIP isolando o core de execução/captura dos adaptadores MCP/web (risco #2 do ROADMAP); (D3) envelope de run **N-step desde o M0** para que M1 seja aditivo (risco #1); (D4) `fetch`/`http` nativos, sem framework (decisão de framework adiada ao M2); (D5) logs em stderr + métrica de runtime.

Não há código de produto ainda — o repositório está em greenfield (só tooling `.claude/` + ROADMAP + bootstrap). Este é o primeiro plano de implementação do projeto.

## Baseline Context (deep review of current state)

> Greenfield: nenhum arquivo de produto existe ainda. A tabela lista os arquivos que SERÃO criados. Evidência: `git ls-files src/ 2>/dev/null` retorna vazio; `git log --oneline -3` mostra apenas bootstrap (`69c2675`), discover plan (`dc0c61a`), blueprint (`8d29ddf`).

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `package.json` (NEW) | 0 | — | (a criar) manifest npm ESM + scripts + deps | `"type":"module"`; deps runtime = sdk + zod apenas |
| `tsconfig.json` (NEW) | 0 | — | (a criar) config TS estrita ESM | `strict: true`; `module: NodeNext` |
| `vitest.config.ts` (NEW) | 0 | — | (a criar) config de testes | inclui `src/**/*.test.ts` |
| `src/core/runSchema.ts` (NEW) | 0 | — | (a criar) schema zod do envelope de run + tipos | `schemaVersion` literal `1`; `steps: RunStep[]` |
| `src/core/executeRequest.ts` (NEW) | 0 | — | (a criar) execução HTTP via fetch + captura | erro de rede → `RequestExecutionError` tipado; 4xx/5xx são respostas válidas |
| `src/core/runStore.ts` (NEW) | 0 | — | (a criar) `buildRunEnvelope` + `persistRun` + `loadRun` | `loadRun` valida com zod; nenhum import de mcp/http |
| `src/core/errors.ts` (NEW) | 0 | — | (a criar) erros de domínio tipados | `RequestExecutionError extends Error` |
| `src/core/index.ts` (NEW) | 0 | — | (a criar) API pública do core | só re-exporta; sem lógica |
| `src/mcp/server.ts` (NEW) | 0 | — | (a criar) adaptador MCP stdio + tool run_request | stdout = protocolo; logs em stderr; delega 100% ao core |
| `src/web/server.ts` (NEW) | 0 | — | (a criar) adaptador http que renderiza um run | só lê via `loadRun`; nenhuma execução HTTP aqui |
| `src/web/render.ts` (NEW) | 0 | — | (a criar) run → HTML (puro, testável) | escapa HTML; itera `steps` |
| `src/core/runSchema.test.ts` (NEW) | 0 | — | (a criar) RED test do schema | — |
| `src/core/executeRequest.test.ts` (NEW) | 0 | — | (a criar) RED test execução/captura | — |
| `src/core/runStore.test.ts` (NEW) | 0 | — | (a criar) RED test persist/load | — |
| `src/mcp/server.test.ts` (NEW) | 0 | — | (a criar) integração da tool via InMemoryTransport | — |
| `src/web/render.test.ts` (NEW) | 0 | — | (a criar) RED test do render | — |
| `src/e2e.test.ts` (NEW) | 0 | — | (a criar) E2E agente→run→arquivo→render | — |
| `CHANGELOG.md` | 12 | `8d29ddf` (2026-06-18) | contrato público de mudanças | nunca editar versões já released |
| `README.md` (NEW) | 0 | — | (a criar) como rodar o skeleton | hero outcome-shaped (`public-copy.md`) |

### Current callers / dependents

Greenfield — nenhum símbolo público existe ainda; não há callers a preservar. Os símbolos novos (`executeRequest`, `buildRunEnvelope`, `persistRun`, `loadRun`, `renderRun`) terão seus callers criados neste mesmo plano (wiring triad por task). External API consumida por outros repos: **não**.

### Domain glossary

- **run** — uma execução capturada: um ou mais steps, cada um com o request enviado e o response recebido (request+response+headers completos).
- **step** — par `{request, response}` de uma única chamada HTTP dentro de um run. No M0 há exatamente 1 step; M1 terá N.
- **envelope** — o objeto de topo do run persistido: `{schemaVersion, runId, createdAt, steps[]}`.
- **core** — o módulo de domínio puro (execução/captura/persistência), sem dependência de MCP nem de HTTP server (DIP).
- **adaptador** — MCP server (stdio) e web server (http) que dependem do core; o core não os conhece.

### Architecture boundaries affected

Cria as fronteiras de `rules/architecture.md` §1–§2 do zero, package-by-layer (§5): `src/core/` é o domínio (depende de nada além de stdlib + zod); `src/mcp/` e `src/web/` são adaptadores (interface) que dependem **só** do core via `src/core/index.ts`. Direção de import permitida: `mcp → core`, `web → core`. Proibido: `core → mcp`, `core → web`, `mcp ↔ web`. Validação de input nas fronteiras (`loadRun` valida o arquivo; a tool valida o inputSchema via zod).

## Prior Art & Related Work

- **Internal blueprint:** `knowledge-base/discoveries/blueprints/m0-walking-skeleton-blueprint.md` — ADRs D1–D5, Coverage Corners 1–4, Recommendations 1–7. Fonte primária deste plano.
- **Reference projects** (`knowledge-base/references/`):
  - `mcp-typescript-sdk/examples/server/src/mcpServerOutputSchema.ts` — padrão `registerTool` com input/output schema + `structuredContent` + `StdioServerTransport`.
  - `mcp-typescript-sdk/packages/core/test/inMemory.test.ts` — padrão `InMemoryTransport` para testar tool sem stdio real.
  - `bruno/packages/bruno-cli/src/runner/run-single-request.js` — shape `{request, response}` por item; `results:[]` valida o envelope N-step.
  - `hoppscotch/packages/hoppscotch-data/src/rest/v/0.ts` — campo de versão de schema (`v`), que vira `schemaVersion`.
- **Patterns skills** (`skills/*-patterns/`): nenhum registrado ainda (projeto novo) — não há pattern a citar nem a sobrepor.

## Objective

- [ ] Sub-goal 1 — Core puro: `executeRequest` executa um HTTP request via `fetch` e captura request+response+headers+timings; erro de rede vira `RequestExecutionError`.
- [ ] Sub-goal 2 — Persistência: `buildRunEnvelope` produz `{schemaVersion:1, runId, createdAt, steps[]}` e `persistRun` grava `runs/{runId}.json`; `loadRun` lê e valida via zod.
- [ ] Sub-goal 3 — Adaptador MCP: server stdio expõe `run_request` (method/url/headers/body) que delega ao core, persiste e retorna `structuredContent` = envelope; logs em stderr.
- [ ] Sub-goal 4 — Adaptador web: server `http` nativo lê um run e renderiza request/response/headers de cada step.
- [ ] Sub-goal 5 — E2E: teste `e2e_run_request_persists_and_renders` exercita o loop tool→arquivo→render verde.

## ADRs

### D1 — SDK `@modelcontextprotocol/sdk` v1.x estável; imports `/server/mcp.js` e `/server/stdio.js`

**Decision:** depender de `@modelcontextprotocol/sdk` na dist-tag `latest` (v1.x) e importar `McpServer` de `@modelcontextprotocol/sdk/server/mcp.js` e `StdioServerTransport` de `@modelcontextprotocol/sdk/server/stdio.js`; `InMemoryTransport`/`Client` para teste.

**Rationale:** o README do próprio SDK recomenda v1.x para produção até v2 estável (Q3/2026) — Blueprint ADR D1. Don't-Reinvent (`parsimony-ladder.md` rung 4) + KISS (versão estável evita re-trabalho).

**Alternatives considered:** usar o v2-alpha do clone (rejeitado — pré-release, imports de workspace não instaláveis, quebraria `npm install`); implementar o protocolo MCP à mão (rejeitado — Unbreakable Rule 9, reinventar a roda).

**Consequences:** `inputSchema` em v1.x é um ZodRawShape (objeto de zod fields), não `z.object(...)`. Migração futura para v2 é aditiva (API conceitualmente idêntica).

### D2 — Fronteira DIP: core puro, MCP/web como adaptadores

**Decision:** `src/core/` não importa nada de `src/mcp/` nem `src/web/` nem do SDK; expõe sua API por `src/core/index.ts`. Adaptadores dependem do core.

**Rationale:** `rules/architecture.md` §1–§2 (domínio define, adaptadores satisfazem); mitiga o risco #2 do ROADMAP; permite testar o core sem stdio nem browser — Blueprint ADR D2.

**Alternatives considered:** colocar a execução HTTP dentro do handler MCP (rejeitado — acopla execução ao transporte, impede reuso pela web e teste isolado, viola SRP/DIP).

**Consequences:** o core é a única fonte do schema de run; trocar transporte (M4) ou UI (M2) não toca o core.

### D3 — Envelope de run N-step desde o M0

**Decision:** o run persistido é `{schemaVersion:1, runId, createdAt, steps:[{request, response}]}`. M0 grava 1 step; M1 dá `push` em `steps`.

**Rationale:** validado pelo `results:[]` do bruno (`run-single-request.js`); M1 é dependência declarada de M0, logo a segunda forma concreta já é conhecida e datada — não é abstração especulativa (YAGNI satisfeito) — Blueprint ADR D3.

**Alternatives considered:** envelope plano `{request, response}` (rejeitado — exigiria refactor do schema, da persistência e do render em M1, contrariando "sem re-trabalho").

**Consequences:** render e asserts de M1 iteram `steps`; o campo `schemaVersion` permite migração futura sem ambiguidade.

### D4 — `fetch`/`http` nativos; injeção de clock+id; sem framework

**Decision:** execução HTTP via `fetch` global (Node 18+); web via módulo `http` nativo. `buildRunEnvelope` recebe `now()` e `newId()` injetados (default: `Date.now`/`crypto.randomUUID`) para testes determinísticos.

**Rationale:** `parsimony-ladder.md` rungs 2–3 (stdlib/native primeiro); framework web é decisão do M2 — Blueprint ADR D4. Injeção de clock/RNG = `rules/testing.md` §6 (determinismo).

**Alternatives considered:** axios (rejeitado para M0 — YAGNI até interceptors de auth, M4); Express (rejeitado — framework antecipado, decisão do M2).

**Consequences:** captura de headers usa a API `Headers`; corpos binários/grandes ficam como TODO explícito do M2 (render). Sem deps de runtime além de sdk+zod.

### D5 — Logs em stderr + métrica de runs

**Decision:** no server stdio, diagnóstico vai para `console.error` (stderr); stdout é exclusivo do protocolo MCP. Métrica de runtime = log estruturado por execução (`{event:'run_request', status, durationMs}`) + contador em memória de runs executados, exposto por `getRunCount()`.

**Rationale:** o exemplo do SDK loga em stderr; `cycle-implement.md` exige runtime metric observável — Blueprint ADR D5.

**Alternatives considered:** `console.log` (rejeitado — corromperia o protocolo stdio); stack de métricas (Prometheus) (rejeitado — YAGNI para CLI local).

**Consequences:** observabilidade mínima presente desde o M0; o contador é a prova de wiring exercitada no teste de integração.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Dependência da API v1.x do SDK assumida de memória pode divergir do shape real instalado | Medium | Phase 0 instala o SDK e o teste de integração da tool (InMemoryTransport) é a prova de que a API casa; se divergir, ajustar imports na T0.1 antes de prosseguir | impl |
| `fetch` nativo não tem timeout por padrão → request pendurado trava o run | Medium | `executeRequest` usa `AbortController` com timeout configurável (default 30s) → `RequestExecutionError('timeout')`; coberto em Failure scenarios | impl |
| Render de corpos binários/grandes não tratado no M0 pode quebrar a UI | Low | M0 trata só text; content-type não-texto é marcado "(binary omitted)"; tratamento completo é escopo M2 (documentado) | impl |
| Persistência sem ordenação determinística geraria diffs ruidosos (relevante a M3) | Low | `persistRun` constrói o objeto em ordem fixa de chaves + `JSON.stringify(...,2)`; normalização completa é M3/M5 | impl |
| [EC-4] SSRF: `run_request` executa qualquer URL (inclusive interna) | Medium | Risco aceito no M0: é a função do produto (testar APIs) em uso local single-user (ROADMAP: auth/multi-tenant out of scope no V1); controles de egress são pós-V1 | impl |

## Unresolved Questions

- Q1 — Qual diretório de runs por padrão (`runs/` na raiz vs `.hodor/runs/`)? Resolução proposta: `runs/` na raiz, configurável por env `HODOR_RUNS_DIR` (resolvido na T1.3; default `runs/`).
- Q2 — A web app no M0 mostra o último run ou aceita `runId` na URL? Resolução proposta: `GET /` redireciona ao run mais recente; `GET /runs/:id` mostra um específico (resolvido na T3.2).
- (demais decisões resolvidas em plan time via ADRs D1–D5.)

## Dependencies

Projeto greenfield: todas as dependências são novas. Versões pinadas (faixa-alvo; final no `package-lock.json` após T0.1). Nenhuma dependência de runtime além de sdk+zod (D4 — `fetch`/`http` nativos).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none) | — | — | repositório greenfield, sem manifest npm prévio |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| `@modelcontextprotocol/sdk` (NEW) | `^1.20.0` (dist-tag `latest` v1.x — NÃO `2.0.0-alpha`) | npm | Avaliado: implementar o protocolo MCP à mão (rejeitado — Rule 9, inseguro e enorme); `@modelcontextprotocol/server` v2-alpha (rejeitado — pré-release, README recomenda v1.x p/ produção) | SDK oficial do protocolo MCP, estável (D1) |
| `zod` (NEW) | `^3.25.1` (satisfaz o peer do SDK `^3.25 \|\| ^4.0`) | npm | Avaliado: validação manual com type guards (rejeitado — verboso, sem inferência de tipo, reinventa parser); `ajv`/`yup` (rejeitado — o SDK MCP v1.x já integra zod p/ inputSchema, evita 2ª lib) | validação battle-tested + inferência de tipo (T1.1) |
| `typescript` (NEW) | `^5.6.0` | npm | Avaliado: JS puro + JSDoc (rejeitado — sem checagem estrita de tipos exigida pelo `strict` da fronteira DIP) | compilador/typechecker padrão |
| `vitest` (NEW) | `^4.1.0` (≥4.1.0 — evita GHSA-5xrq-8626-4rwp CRITICAL presente em 2.x; ver deps-audit) | npm | Avaliado: `node:test` nativo (rejeitado — referências usam vitest; melhor DX de mocks/coverage); jest (rejeitado — ESM friction) | runner observado nas referências (Blueprint Corner 3) |
| `tsx` (NEW) | `^4.19.0` | npm | Avaliado: `ts-node` (rejeitado — ESM friction); pré-compilar com tsc (rejeitado — passo extra no M0, YAGNI) | rodar TS ESM direto nos scripts `mcp`/`web` |
| `@types/node` (NEW) | `^22.0.0` | npm | Avaliado: nenhuma alternativa (tipos oficiais do Node) | tipos de `fetch`/`http`/`crypto` |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Dependency Graph

```
Phase 0 (scaffold) ──▶ Phase 1 (core) ──▶ Phase 2 (MCP adapter) ──┐
                                      └──▶ Phase 3 (web adapter) ──┴─▶ Phase 4 (E2E + integration validation)
```

Phase 2 e Phase 3 podem rodar em paralelo (ambos dependem só do core, não um do outro). Phase 0 e Phase 1 são bloqueantes sequenciais. Phase 4 depende de 2 e 3.

---

## Phase 0: Project scaffold

**Objective:** estabelecer o projeto Node/TS ESM com deps, tsconfig estrito, vitest e scripts, de modo que `npm test` rode.

### T0.1 — package.json + tsconfig + vitest + scripts

#### Objective
Criar o manifest ESM, a config TS estrita, a config vitest e os scripts (`test`, `typecheck`, `mcp`, `web`).

#### Why this step (action + reasoning)
1. **What:** cria `package.json` (deps `@modelcontextprotocol/sdk@latest` + `zod`; dev `typescript`, `vitest`, `tsx`, `@types/node`), `tsconfig.json` (`strict`, `NodeNext`), `vitest.config.ts`.
2. **Why now:** nada compila ou testa sem o scaffold; é o pré-requisito do ciclo TDD de todas as fases (Baseline Context: todos os arquivos são NEW). Adota o tooling vitest/ESM observado no Blueprint Corner 3.

#### Evidence
Blueprint §"Coverage Corner 3 — Tools" (vitest + tsc + ESM) e §"Coverage Corner 2 — Dependencies" (deps runtime = sdk + zod). `knowledge-base/discoveries/blueprints/m0-walking-skeleton-blueprint.md`.

#### Files to edit
```
package.json (NEW) — manifest ESM, deps, scripts
tsconfig.json (NEW) — strict, NodeNext
vitest.config.ts (NEW) — inclui src/**/*.test.ts
.gitignore — adicionar runs/ (artefatos de execução não versionados no M0)
```

#### Deep file dependency analysis
Arquivos NEW (Baseline Context). Nenhum downstream ainda. `npm install` cria `node_modules/` (gitignored) e `package-lock.json` (versionado).

#### Deep Dives
- `package.json` scripts: `"test":"vitest run"`, `"typecheck":"tsc --noEmit"`, `"mcp":"tsx src/mcp/server.ts"`, `"web":"tsx src/web/server.ts"`.
- tsconfig: `"module":"NodeNext"`, `"moduleResolution":"NodeNext"`, `"strict":true`, `"target":"ES2022"`, `"verbatimModuleSyntax":true`.
- Invariant: `"type":"module"` (ESM) — imports usam extensão `.js` em TS NodeNext.

#### Tasks
1. Escrever `package.json` com deps e scripts (vitest `^4.1.0` — ver deps-audit).
2. `npm install @modelcontextprotocol/sdk@latest zod` + dev deps; confirmar que `latest` ≠ alpha (`npm view @modelcontextprotocol/sdk version`).
3. `npm audit --json` no lockfile → confirmar 0 CRITICAL/HIGH transitivos (fecha o caveat do deps-audit; `auditor_unavailable` não pode ocorrer).
4. Escrever `tsconfig.json` e `vitest.config.ts`.
5. Adicionar `runs/` ao `.gitignore`.

#### TDD
```
RED:     scaffold_smoke() — um teste trivial src/scaffold.test.ts assert(true) que prova que vitest roda (removido na T1.1)
GREEN:   criar configs até `npm test` executar o teste
REFACTOR: None expected
VERIFY:  npm test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `npm test` executa (vitest encontra e roda o smoke test)
- [ ] `npm run typecheck` sai sem erro
- [ ] `npm view @modelcontextprotocol/sdk version` confirma versão instalada 1.x (não alpha)
- [ ] `npm audit` reporta 0 CRITICAL/HIGH (incl. transitivos)
- [ ] Pass: cada arquivo ≤ 500 linhas (`wc -l`)
- [ ] Pass: lint — `npm run typecheck` (tsc --strict) reporta 0 warnings

#### DoD
- [ ] `npm test` verde
- [ ] `npm run typecheck` zero erros
- [ ] `package-lock.json` versionado; `node_modules/` e `runs/` ignorados

---

## Phase 1: Core domain (puro, sem MCP/HTTP server)

**Objective:** implementar execução/captura HTTP, o envelope de run versionado e persist/load, 100% testável sem stdio nem browser.

### T1.1 — Schema do run + tipos (zod)

#### Objective
Definir `RunEnvelope`/`RunStep`/`CapturedRequest`/`CapturedResponse` como schema zod + tipos inferidos.

#### Why this step (action + reasoning)
1. **What:** cria `src/core/runSchema.ts` com o schema zod do envelope N-step e os tipos TS inferidos.
2. **Why now:** o schema é o contrato compartilhado por execução, persistência, MCP e web; defini-lo primeiro (D3) impede divergência de shape entre camadas e habilita validação na fronteira (`loadRun`).

#### Evidence
Blueprint §"T3 — Versionamento de schema" e ADR D3 (envelope `{schemaVersion, steps[]}`). `hoppscotch/.../rest/v/0.ts` (campo de versão).

#### Files to edit
```
src/core/runSchema.ts (NEW) — schema zod + tipos
src/core/runSchema.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
NEW. Downstream: `executeRequest.ts`, `runStore.ts`, `mcp/server.ts`, `web/render.ts` importarão os tipos. Remove o smoke test da T0.1.

#### Deep Dives
- `RunStepSchema = z.object({ request: CapturedRequestSchema, response: CapturedResponseSchema })`.
- `RunEnvelopeSchema = z.object({ schemaVersion: z.literal(1), runId: z.string().min(1), createdAt: z.string(), steps: z.array(RunStepSchema).min(1) })`.
- `CapturedRequestSchema = z.object({ method: z.string(), url: z.string().url(), headers: z.record(z.string()), body: z.string().optional() })`.
- `CapturedResponseSchema = z.object({ status: z.number(), statusText: z.string(), headers: z.record(z.string()), body: z.string(), timings: z.object({ startedAt: z.string(), durationMs: z.number().nonnegative() }) })`.
- Invariant: `schemaVersion` é literal `1`; `steps` tem ≥1 item.

#### Tasks
1. Escrever os schemas zod.
2. Exportar tipos via `z.infer`.

#### TDD
```
RED:     run_envelope_schema_accepts_valid_single_step() — parse de um envelope válido de 1 step retorna success
RED:     run_envelope_schema_rejects_wrong_version() — schemaVersion:2 falha o parse
RED:     run_envelope_schema_rejects_empty_steps() — steps:[] falha o parse
GREEN:   implementar runSchema.ts até os 3 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/core/runSchema.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 3 RED tests passam — `npx vitest run` verde
- [ ] `RunEnvelope` type exportado e usado pelos demais módulos
- [ ] Pass: cada arquivo ≤ 500 linhas (`wc -l`) linhas; `npm run typecheck` reporta 0 erros

#### DoD
- [ ] `npx vitest run src/core/runSchema.test.ts` verde
- [ ] `npm run typecheck` zero erros

### T1.2 — executeRequest (fetch + captura + erro tipado)

#### Objective
Executar um HTTP request e capturar `{request, response}` como um `RunStep`; falha de rede/timeout → `RequestExecutionError`.

#### Why this step (action + reasoning)
1. **What:** cria `src/core/errors.ts` (`RequestExecutionError`) e `src/core/executeRequest.ts` (`executeRequest(input): Promise<RunStep>` via `fetch` + `AbortController`).
2. **Why now:** é o coração do core e a unidade testável contra um `http.Server` efêmero; tudo (MCP, persist, web) consome o `RunStep` que ele produz. Erro tipado satisfaz Rule 8 (fail-fast).

#### Evidence
Blueprint §"T2" (shape `{request:{method,url,headers,data}, response:{status,statusText,headers,...}}`) e ADR D4 (fetch nativo + timeout). `bruno/.../run-single-request.js:149`.

#### Files to edit
```
src/core/errors.ts (NEW) — RequestExecutionError
src/core/executeRequest.ts (NEW) — fetch + captura + timeout
src/core/executeRequest.test.ts (NEW) — RED tests contra http.Server efêmero
```

#### Deep file dependency analysis
NEW. Importa tipos de `runSchema.ts` (T1.1). Downstream: `runStore.buildRunEnvelope` e o handler MCP chamam `executeRequest`. Caller de produção: o handler `run_request` (T2.1) — wiring.

#### Deep Dives
- Assinatura: `executeRequest(input: {method:string; url:string; headers?:Record<string,string>; body?:string}, opts?:{timeoutMs?:number}): Promise<RunStep>`.
- Captura: `startedAt = new Date(now()).toISOString()`; mede `durationMs`; `response.headers` via `Object.fromEntries(res.headers)`; `body = await res.text()`.
- Status 4xx/5xx são **respostas válidas** (capturadas, não lançam). Apenas falha de rede/abort lança `RequestExecutionError` com `url` e `cause`.
- Timeout: `AbortController` + `setTimeout(timeoutMs)` (default 30000) → abort → `RequestExecutionError('timeout: '+url)`.
- Edge cases: sem body; headers vazios; content-type não-texto → `body` é o texto bruto (tratamento binário é M2).

#### Pseudo-code / Signatures
```pseudocode
async function executeRequest(input, opts):
  ctrl = new AbortController()
  timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000)
  startedAt = isoNow()
  t0 = perfNow()
  try:
    res = await fetch(input.url, { method, headers, body, signal: ctrl.signal })
  catch e:
    throw new RequestExecutionError(`request failed: ${input.url}`, { cause: e })
  finally:
    clearTimeout(timer)
  return {
    request: { method, url, headers: input.headers ?? {}, body: input.body },
    response: { status: res.status, statusText: res.statusText,
                headers: fromEntries(res.headers), body: await res.text(),
                timings: { startedAt, durationMs: perfNow() - t0 } }
  }
# Example
input:  { method:'GET', url:'http://127.0.0.1:PORT/ok' }   (servidor responde 200 "hi")
output: step.response.status == 200 && step.response.body == "hi"
```

#### Tasks
1. `errors.ts`: `RequestExecutionError extends Error` (preserva `cause`).
2. `executeRequest.ts`: fetch + AbortController + captura.
3. Testes contra `http.Server` efêmero em `127.0.0.1` (porta 0).

#### TDD
```
RED:     execute_request_captures_status_headers_body() — GET a um http.Server local 200 captura status/headers/body
RED:     execute_request_captures_5xx_as_response() — alvo responde 503; step.response.status==503 (NÃO lança)
RED:     execute_request_throws_typed_error_on_connection_refused() — url para porta fechada lança RequestExecutionError
RED:     execute_request_records_nonnegative_duration() — step.response.timings.durationMs >= 0
RED:     execute_request_get_with_body_is_handled() — [EC-2] GET com body não vaza TypeError cru do fetch (body ignorado p/ GET/HEAD OU RequestExecutionError claro)
RED:     execute_request_captures_repeated_headers() — [EC-3] alvo com 2 Set-Cookie; valor capturado preserva ambos (junção `, ` da Headers API)
GREEN:   implementar executeRequest até os 6 passarem
REFACTOR: extrair headersToRecord() se ajudar legibilidade
VERIFY:  npx vitest run src/core/executeRequest.test.ts
```

#### Concurrency tests
(none — single-threaded)
Nota: usa `async/await` + `AbortController`, mas a execução é de um único request por chamada, sem estado compartilhado mutável entre chamadas concorrentes; não há invariante de corrida a provar no M0.

#### Acceptance Criteria
- [ ] Os 6 RED tests passam — `npx vitest run` verde
- [ ] 5xx capturado como resposta; falha de rede lança `RequestExecutionError`; GET-com-body e headers repetidos tratados
- [ ] Pass: coverage ≥ 90% em `executeRequest.ts` (caminho de erro coberto)
- [ ] Pass: cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` reporta 0 erros

#### DoD
- [ ] `npx vitest run src/core/executeRequest.test.ts` verde
- [ ] `npm run typecheck` zero erros

### T1.3 — runStore (buildRunEnvelope + persistRun + loadRun)

#### Objective
Montar o envelope a partir de steps (com clock/id injetáveis), gravar `runs/{runId}.json` e ler+validar de volta.

#### Why this step (action + reasoning)
1. **What:** cria `src/core/runStore.ts` (`buildRunEnvelope`, `persistRun`, `loadRun`) e `src/core/index.ts` (API pública).
2. **Why now:** fecha o Sub-goal 2 (persistência) e dá ao MCP e à web a única porta de entrada/saída de runs; injeção de clock/id (D4) torna o teste determinístico.

#### Evidence
Blueprint §"T2" (`--output results.json` em `bruno/.../commands/run.js:142`) e ADR D3/D4. `rules/testing.md` §6 (injeção de clock/RNG).

#### Files to edit
```
src/core/runStore.ts (NEW) — buildRunEnvelope/persistRun/loadRun
src/core/index.ts (NEW) — re-export da API pública do core
src/core/runStore.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
NEW. Importa `runSchema.ts` (tipos + validação) e tipos de `executeRequest.ts`. `index.ts` re-exporta `executeRequest`, `buildRunEnvelope`, `persistRun`, `loadRun`, `RequestExecutionError`, tipos. Downstream: `mcp/server.ts` e `web/server.ts` importam SÓ de `src/core/index.ts` (D2).

#### Deep Dives
- `buildRunEnvelope(steps: RunStep[], deps?: {now?:()=>number; newId?:()=>string}): RunEnvelope` — `schemaVersion:1`, `runId: (deps.newId ?? crypto.randomUUID)()`, `createdAt: new Date((deps.now ?? Date.now)()).toISOString()`. Ordem de chaves fixa.
- `persistRun(env: RunEnvelope, dir = process.env.HODOR_RUNS_DIR ?? 'runs'): Promise<string>` — `mkdir -p dir`; grava `${dir}/${env.runId}.json` com `JSON.stringify(env, null, 2)`; retorna o path. (Q1 resolvida: default `runs/`, override por env.)
- `loadRun(path: string): Promise<RunEnvelope>` — lê, `JSON.parse`, valida com `RunEnvelopeSchema.parse` (lança ZodError em arquivo inválido — validação na fronteira).
- Invariant: o que `persistRun` grava, `loadRun` lê idêntico (round-trip).

#### Tasks
1. `buildRunEnvelope` com deps injetáveis.
2. `persistRun` (mkdir + write).
3. `loadRun` (read + zod parse).
4. `index.ts` re-exporta a API pública.

#### TDD
```
RED:     build_run_envelope_uses_injected_clock_and_id() — com now/newId fixos, runId e createdAt são determinísticos
RED:     persist_run_writes_file_named_by_run_id() — grava ${dir}/${runId}.json em tmpdir
RED:     load_run_round_trips_persisted_envelope() — loadRun(persistRun(env)) deep-equals env
RED:     load_run_rejects_invalid_file() — arquivo com schemaVersion errado lança (ZodError)
GREEN:   implementar runStore + index até os 4 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/core/runStore.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 4 RED tests passam — `npx vitest run` verde; round-trip idêntico
- [ ] `loadRun` valida na fronteira (arquivo inválido lança)
- [ ] Pass: coverage ≥ 90%; cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` reporta 0 erros

#### DoD
- [ ] `npx vitest run src/core/runStore.test.ts` verde
- [ ] `src/core/index.ts` é a única superfície pública do core

---

## Phase 2: MCP adapter (stdio + tool run_request)

**Objective:** expor `run_request` via MCP stdio delegando ao core, persistindo o run e retornando o envelope; teste de integração via InMemoryTransport.

### T2.1 — MCP server + tool run_request (caller do core) + métrica

#### Objective
Registrar a tool `run_request`, conectar via stdio, delegar ao core (`executeRequest`+`buildRunEnvelope`+`persistRun`), retornar `structuredContent`, logar em stderr e contar runs.

#### Why this step (action + reasoning)
1. **What:** cria `src/mcp/server.ts` — `McpServer` v1.x + `registerTool('run_request', {inputSchema}, handler)` + `StdioServerTransport`; handler é o **caller de produção** do core (wiring pillar a); incrementa `runCount` e loga `{event,status,durationMs}` em stderr (D5).
2. **Why now:** fecha o Sub-goal 3 e provê o produtor de runs do loop E2E. Depende do core (Phase 1) e de nada de Phase 3.

#### Evidence
Blueprint §"T1" (`registerTool` + `StdioServerTransport` + `structuredContent`, `mcpServerOutputSchema.ts:17/:71`) e ADR D1/D5.

#### Files to edit
```
src/mcp/server.ts (NEW) — server stdio + tool + métrica
src/mcp/server.test.ts (NEW) — integração via InMemoryTransport
```

#### Deep file dependency analysis
NEW. Importa SÓ de `src/core/index.ts` (D2). `getRunCount()` exportado para a asserção de métrica. Downstream: `src/e2e.test.ts` (T4.1) chama a tool. Caller de produção do core: o handler — satisfaz wiring pillar (a).

#### Deep Dives
- Imports: `McpServer` de `@modelcontextprotocol/sdk/server/mcp.js`; `StdioServerTransport` de `@modelcontextprotocol/sdk/server/stdio.js`; `z` de `zod`.
- `registerTool('run_request', { description, inputSchema: { method: z.string(), url: z.string().url(), headers: z.record(z.string()).optional(), body: z.string().optional() } }, handler)`.
- Handler: `const step = await executeRequest(args); const env = buildRunEnvelope([step]); const path = await persistRun(env); runCount++; console.error(JSON.stringify({event:'run_request', status: step.response.status, durationMs: step.response.timings.durationMs, path})); return { content:[{type:'text', text: JSON.stringify(env,null,2)}], structuredContent: env };`
- `buildServer()` factory (retorna o `McpServer` configurado, sem conectar) — permite o teste conectar via InMemoryTransport. `main()` conecta via stdio só quando rodado como entrypoint.
- Invariant: nada vai a stdout exceto o protocolo (logs em stderr).

#### Pseudo-code / Signatures
```pseudocode
function buildServer(): McpServer
  server = new McpServer({name:'hodor', version:'0.1.0'})
  server.registerTool('run_request', {inputSchema}, async (args) => {
    step = await executeRequest(args)
    env  = buildRunEnvelope([step])
    path = await persistRun(env)
    runCount += 1
    console.error(json({event:'run_request', status: step.response.status, durationMs:..., path}))
    return { content:[{type:'text', text: json(env)}], structuredContent: env }
  })
  return server
function getRunCount(): number  -> runCount
async function main(): connect buildServer() to new StdioServerTransport()
```

#### Tasks
1. `buildServer()` + `registerTool` + handler delegando ao core.
2. Contador `runCount` + `getRunCount()` + log estruturado em stderr.
3. `main()` guard (`if (import.meta.url === ...)`/entrypoint) conecta stdio.

#### TDD
```
RED:     run_request_tool_executes_and_returns_envelope() — via InMemoryTransport, Client.callTool('run_request', {method,url}) contra http.Server local retorna structuredContent com schemaVersion:1 e 1 step
RED:     run_request_tool_persists_run_file() — após callTool, existe runs/{runId}.json (em tmpdir via HODOR_RUNS_DIR) e loadRun valida
RED:     run_request_tool_increments_run_count() — getRunCount() sobe de 0 para 1 após uma chamada (prova de wiring/métrica)
GREEN:   implementar server.ts até os 3 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/mcp/server.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 3 RED tests passam — `npx vitest run` verde (tool executa, persiste, conta)
- [ ] `structuredContent` é um `RunEnvelope` válido
- [ ] stdout não recebe logs (asserção implícita: protocolo via InMemoryTransport funciona)
- [ ] Pass: coverage ≥ 90% em server.ts; cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` reporta 0 erros

#### DoD
- [ ] `npx vitest run src/mcp/server.test.ts` verde
- [ ] Handler é caller de produção do core (wiring pillar a); teste de integração presente (pillar b); contador é a métrica (pillar c)

---

## Phase 3: Web adapter (http nativo que renderiza um run)

**Objective:** servir uma página que lê um run e renderiza request/response/headers de cada step.

### T3.1 — renderRun (run → HTML, puro)

#### Objective
Função pura que transforma um `RunEnvelope` em HTML escapado mostrando, por step, request (method/url/headers/body) e response (status/headers/body).

#### Why this step (action + reasoning)
1. **What:** cria `src/web/render.ts` (`renderRun(env): string`).
2. **Why now:** separar render (puro, testável) do servidor http (I/O) segue SRP/DIP e permite testar a renderização sem subir socket.

#### Evidence
Blueprint §"Recommendations" #4/#7 (web adapter lê via loadRun; render itera steps) e ADR D2/D4.

#### Files to edit
```
src/web/render.ts (NEW) — renderRun puro
src/web/render.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
NEW. Importa o tipo `RunEnvelope` de `src/core/index.ts`. Downstream: `src/web/server.ts` (T3.2) chama `renderRun`. Sem I/O aqui.

#### Deep Dives
- `renderRun(env: RunEnvelope): string` — HTML com `<h1>` runId, e por step uma seção Request (method+url, tabela de headers, `<pre>` body) e Response (status+statusText, tabela de headers, `<pre>` body).
- Escape HTML obrigatório (`&<>"`); body não-texto → "(binary omitted)" (M0 trata só text; heurística por content-type header).
- Invariant: itera `env.steps` (suporta N — D3); nunca injeta HTML cru do response.

#### Tasks
1. `escapeHtml()` helper.
2. `renderRun()` iterando steps.

#### TDD
```
RED:     render_run_includes_method_url_and_status() — HTML contém o method, a url e o status do step
RED:     render_run_lists_request_and_response_headers() — cada header key/value capturado aparece no HTML
RED:     render_run_escapes_html_in_body() — body "<script>" aparece escapado, não cru
RED:     render_run_iterates_multiple_steps() — envelope com 2 steps renderiza 2 seções (prova suporte N-step)
GREEN:   implementar render.ts até os 4 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/web/render.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 4 RED tests passam — `npx vitest run` verde; HTML escapado; itera N steps
- [ ] Pass: coverage ≥ 90%; cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` reporta 0 erros

#### DoD
- [ ] `npx vitest run src/web/render.test.ts` verde

### T3.2 — web server (http nativo) que serve o render

#### Objective
Servidor `http` nativo: `GET /runs/:id` carrega o run via `loadRun` e responde `renderRun`; `GET /` redireciona ao run mais recente.

#### Why this step (action + reasoning)
1. **What:** cria `src/web/server.ts` (`buildWebServer()` retorna um `http.Server`; `main()` faz `listen`). É o **caller de produção** de `loadRun`+`renderRun` (wiring pillar a do lado web).
2. **Why now:** fecha o Sub-goal 4 e é o consumidor do loop E2E. Depende do core e do render; independente do MCP (paraleliza com Phase 2).

#### Evidence
Blueprint §"Recommendations" #7 (web adapter http nativo) e ADR D4. Q2 resolvida (`/` → mais recente; `/runs/:id` → específico).

#### Files to edit
```
src/web/server.ts (NEW) — http.Server roteando para loadRun+renderRun
src/web/render.test.ts — (sem mudança; teste do server vai no e2e/integração T4.1)
```

#### Deep file dependency analysis
NEW. Importa `loadRun` de `src/core/index.ts` e `renderRun` de `./render.js`. Downstream: `src/e2e.test.ts` faz request HTTP a este server. Caller de produção de `loadRun`+`renderRun`.

#### Deep Dives
- `buildWebServer(dir = runs dir): http.Server` — `http.createServer((req,res)=>...)`.
- **[EC-1 MUST-FIX] Validação do `:id` (anti path-traversal):** antes de montar o path, validar `id` contra `/^[0-9a-f-]{36}$/i` (forma UUID). Id inválido → `400 bad id`. NUNCA interpolar `:id` cru no path (evita `../../etc/passwd`).
- Rotas: `GET /runs/:id` → (após validação) `loadRun(`${dir}/${id}.json`)` → 200 `text/html` `renderRun(env)`; arquivo ausente → 404. `GET /` → encontra o `.json` mais recente por mtime → 302 para `/runs/:id`; sem runs → 200 "no runs yet".
- Erro: `loadRun` lança em arquivo inválido → 500 com mensagem (fail-loud, sem vazar stack ao cliente além do necessário).
- Invariant: o server não executa requests (só lê/renderiza) — fronteira D2.

#### Tasks
1. `buildWebServer()` com roteamento mínimo.
2. `main()` com `listen(port)` (env `HODOR_WEB_PORT`, default 4000).

#### TDD
```
RED:     web_server_renders_existing_run() — (no T4.1 E2E) GET /runs/:id de um run persistido retorna 200 com HTML contendo o status
RED:     web_server_returns_404_for_missing_run() — GET /runs/<uuid-válido-inexistente> retorna 404
RED:     web_server_rejects_path_traversal_id() — [EC-1] GET /runs/..%2f..%2fpackage.json (id não-UUID) retorna 400, não vaza arquivo
GREEN:   implementar server.ts
REFACTOR: None expected
VERIFY:  npx vitest run src/e2e.test.ts
```

#### Concurrency tests
(none — single-threaded)
Nota: `http.Server` atende conexões assíncronas, mas o M0 não compartilha estado mutável entre requests (cada GET lê o arquivo independentemente); não há invariante de corrida.

#### Acceptance Criteria
- [ ] 404 para run ausente; 200+HTML para run existente (validado no T4.1)
- [ ] [EC-1] `:id` não-UUID → 400; nenhum arquivo fora de `runs/` é lido (teste `web_server_rejects_path_traversal_id`)
- [ ] server não importa nada de `src/mcp/` (fronteira D2)
- [ ] Pass: cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` reporta 0 erros

#### DoD
- [ ] Coberto pelo E2E (T4.1) verde
- [ ] `npm run typecheck` zero erros

---

## Phase 4: E2E + Integration Validation

**Objective:** provar o loop completo agente→run_request→arquivo→web app e rodar a cadeia de validação.

### T4.1 — Teste E2E do loop completo + README

#### Objective
Um teste que: sobe um `http.Server` alvo, chama `run_request` via InMemoryTransport (lado agente), confirma o arquivo persistido, sobe o `buildWebServer` e faz GET na página, asserindo que o request/response/headers aparecem.

#### Why this step (action + reasoning)
1. **What:** cria `src/e2e.test.ts` (o teste do Goal: `e2e_run_request_persists_and_renders`) e `README.md` (como rodar `npm run mcp` / `npm run web`).
2. **Why now:** é a prova do Sub-goal 5 e do critério do ROADMAP §M0 (demonstração E2E). Depende de Phase 2 e Phase 3.

#### Evidence
ROADMAP §M0 DoD ("Demonstração E2E: agente chama run_request → resultado persistido → visível na web app"). Blueprint §"Coverage Corner 1" (InMemoryTransport + re-leitura do arquivo).

#### Files to edit
```
src/e2e.test.ts (NEW) — loop completo
README.md (NEW) — instruções de execução (hero outcome-shaped, public-copy.md)
```

#### Deep file dependency analysis
NEW. Importa `buildServer`/`getRunCount` (mcp), `buildWebServer` (web), `loadRun` (core). É o teste integrador de todas as camadas.

#### Deep Dives
- Fluxo: `target = http.createServer(...)` responde `{ "ok": true }`; `client+server` linkados por `InMemoryTransport.createLinkedPair()`; `client.callTool({name:'run_request', arguments:{method:'POST', url: targetUrl, body:'{}'}})`; assert `structuredContent.steps[0].response.status==200`; `runId = structuredContent.runId`; assert `loadRun(runs/${runId}.json)` ok; `web = buildWebServer(); web.listen(0)`; `fetch(web /runs/${runId})`; assert HTML contém `200` e a url alvo.
- Usa `HODOR_RUNS_DIR` apontando para um tmpdir.

#### Tasks
1. Escrever o E2E ligando os três planos.
2. Escrever README com os comandos.

#### TDD
```
RED:     e2e_run_request_persists_and_renders() — o loop completo: tool executa, arquivo existe e valida, página renderiza status+url (este é o metric do Goal)
GREEN:   ajustar wiring até o E2E passar (sem alterar contratos das fases anteriores)
REFACTOR: None expected
VERIFY:  npx vitest run src/e2e.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `e2e_run_request_persists_and_renders` verde (metric do Goal observado)
- [ ] README mostra `npm run mcp` e `npm run web`
- [ ] Pass: `npm run typecheck` reporta 0 erros; cada arquivo ≤ 500 linhas (`wc -l`)

#### DoD
- [ ] `npm test` (suíte inteira) verde
- [ ] CHANGELOG `[Unreleased] § Added` atualizado com o walking skeleton M0

---

## Coverage Matrix

| # | Gap / Requirement (ROADMAP §M0 DoD) | Task(s) | Resolution |
|---|---|---|---|
| 1 | MCP server stdio expõe `run_request` (method/url/headers/body) que executa e retorna request+response+headers | T2.1 (core: T1.2) | tool delega a `executeRequest`; retorna `structuredContent`=envelope |
| 2 | Resultado persistido em arquivo sob diretório de runs (formato decidido) | T1.3, T2.1 | `persistRun` grava `runs/{runId}.json` (envelope `{schemaVersion, steps[]}`) |
| 3 | Web app mínima lê o arquivo e renderiza request/response/headers completos | T3.1, T3.2 | `loadRun` + `renderRun` servidos por `http` nativo |
| 4 | Demonstração E2E: agente→run_request→persistido→visível na web app | T4.1 | teste `e2e_run_request_persists_and_renders` |
| 5 | Risco #1: persistência escala a multi-step (M1) | T1.1, T1.3 | envelope N-step `steps[]` desde já (D3) |
| 6 | Risco #2: core desacoplado da interface | T1.3, T2.1, T3.2 | `src/core/index.ts` (T1.3) é a única superfície; T2.1/T3.2 importam só do core |
| 7 | Observabilidade (runtime metric) | T2.1 | contador `getRunCount` + log estruturado em stderr (D5) |

**Coverage: 7/7 gaps cobertos (100%)**

## Global Definition of Done

- [ ] Todas as fases completas
- [ ] Todos os testes verdes — `npm test`
- [ ] Zero erros de tipo — `npm run typecheck`
- [ ] Zero warnings de lint — `tsc --strict` (gate mínimo do M0; ESLint pode ser adicionado em milestone futuro)
- [ ] Budget de tamanho respeitado (≤ 500 linhas/arquivo, `rules/architecture.md`)
- [ ] CHANGELOG.md atualizado em `[Unreleased]` (Unbreakable Rule 6)
- [ ] Compatibilidade: greenfield, sem API pública externa a preservar
- [ ] Plan-specific: fronteira DIP core↔adaptadores verificável (nenhum import `core → mcp/web`); envelope N-step presente
- [ ] **Runtime-metric proof** — `getRunCount()` observado > 0 no teste de integração T2.1 (não só compila)
- [ ] **Plan archived** — mover para `knowledge-base/plans/completed/` após `/review` READY_TO_MERGE + merge do PR

## Failure scenarios

M0 toca I/O externo: chamadas HTTP de saída via `fetch` (a "dependência externa" é a API-alvo arbitrária que o agente testa).

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| API-alvo (HTTP, `fetch`) | resposta 5xx (ex. 503) | `http.Server` efêmero responde 503 (`execute_request_captures_5xx_as_response`) | capturado como `response.status==503` num run válido; NÃO lança; persistível e renderizável (revisor vê o 5xx) |
| API-alvo (HTTP, `fetch`) | conexão recusada (porta fechada/DNS) | url apontando para porta fechada (`execute_request_throws_typed_error_on_connection_refused`) | lança `RequestExecutionError` tipado com a url; nenhum run parcial/corrompido gravado |
| API-alvo (HTTP, `fetch`) | request pendurado (sem resposta) | `http.Server` que nunca responde + `timeoutMs` curto no teste | `AbortController` aborta → `RequestExecutionError('timeout: '+url)`; sem run gravado |

## Final Phase: Integration Validation (MANDATORY)

> Roda DEPOIS de todas as fases. O plano não está pronto até a cadeia passar.

**Objective:** validar o loop completo num workload real (não só units isolados).

### Execution

```
npm test                  # unit + integração + e2e (vitest run)
npm run typecheck         # zero erros de tipo (tsc --noEmit)
npx vitest run --coverage # coverage report (≥ 90% em arquivos do core)
```

### Acceptance Criteria

- [ ] Todas as suítes verdes (unit + integração + e2e)
- [ ] Coverage ≥ 90% nos arquivos do core (caminhos críticos de erro: 100%)
- [ ] Zero erros de tipo
- [ ] Runtime-metric proof — `getRunCount()` > 0 no teste de integração
- [ ] Failure scenarios verdes — as 3 linhas de `## Failure scenarios` exercitadas (5xx capturado; connection-refused lança; timeout lança)

### If Validation Fails

1. Identificar falhas causadas por este plano vs pré-existentes (não há pré-existentes — greenfield)
2. Corrigir todas antes de declarar completo
3. Re-rodar a cadeia
