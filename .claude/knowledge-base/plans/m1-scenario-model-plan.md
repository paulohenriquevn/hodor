---
slug: m1-scenario-model
milestone_id: M1
created_at: 2026-06-18
goal: Entregar o modelo de cenário multi-step do Hodor — cenário declarativo JSON com steps, captura de variáveis (jsonpath/regex) e asserts (status/headers/body), executado step-a-step com resultado por step — provado por um teste E2E verde.
---

# Plan: M1 — Modelo de cenário multi-step + asserções

> **Version 1.1** (absorveu EC-1 MUST-FIX header case-insensitive + EC-2/EC-3 SHOULD-TEST + EC-4 DOCUMENT de `knowledge-base/reviews/m1-scenario-model-edge-cases-2026-06-18.md`) — Estende o core do M0 com o **cenário** como artefato de primeira classe: um arquivo declarativo JSON (`{schemaVersion, name, steps[]}`), validado por zod, em que cada step tem `request` + `captures` (jsonpath/regex) + `asserts` (status/headers/body). A engine `runScenario` (core puro) itera os steps, **interpola variáveis capturadas** do step anterior, reusa `executeRequest` do M0, avalia asserts para `{pass, expected, actual}` e produz o **envelope N-step do M0** com cada `RunStep` estendido por `asserts[]` e `captures{}` (opcionais, aditivos — sem migração). Baseado no blueprint SHIPPABLE `knowledge-base/discoveries/blueprints/m1-scenario-model-blueprint.md`. Não reinventa jsonpath (usa `jsonpath-plus`); não acopla ao transporte (engine no core, tool MCP `run_scenario` é adaptador).

## Goal

> Enable um agente a definir e executar um cenário multi-step (request + captura de variáveis + asserts) via a tool MCP `run_scenario`, de modo que variáveis capturadas de um step propaguem para os seguintes e cada assert registre pass/fail, measured by o teste E2E `e2e_scenario_multistep_captures_and_asserts` retornando verde.

## Context

O `ROADMAP.md` §M1 ("Modelo de cenário multi-step + asserções", depende de M0 entregue em v0.1.0) pede: (1) formato declarativo de cenário (steps ordenados; cada step = request + asserts; captura de variáveis para steps seguintes); (2) engine que roda step-a-step, propaga variáveis e avalia asserts (status/headers/body via jsonpath/regex); (3) resultado por step com request/response/headers + pass/fail por assert + valor das variáveis.

O blueprint da fase DISCOVER (`knowledge-base/discoveries/blueprints/m1-scenario-model-blueprint.md`, SHIPPABLE) estudou step-ci (formato declarativo) e hurl (engine de captura/assert/jsonpath) e fixou cinco decisões: (D1) cenário JSON validado por zod; (D2) captura via jsonpath-plus + regex nativo, propagação por interpolação `${{ var }}`; (D3) assert `{source,op,value}` → `{pass,expected,actual}`; (D4) reusar o envelope do M0 estendendo `RunStep` com `asserts`/`captures` OPCIONAIS (schemaVersion:1 mantido — aditivo, sem migração); (D5) engine no core + tool MCP `run_scenario`.

O M0 entregou o core (`src/core/`): `executeRequest`, envelope `{schemaVersion:1, steps[]}`, `buildRunEnvelope`/`persistRun`/`loadRun`. M1 reusa tudo isso.

## Baseline Context (deep review of current state)

> Estado real pós-M0 (v0.1.0). Evidência: `git log -1` por arquivo + `wc -l`. Os arquivos do core existem e serão ESTENDIDOS (não reescritos).

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `src/core/runSchema.ts` | 45 | `061638f` (2026-06-18) | schema zod do envelope de run + tipos (M0) | `schemaVersion` literal `1`; `RunStep` existente NÃO quebra; novos campos são `.optional()` |
| `src/core/index.ts` | 19 | `061638f` (2026-06-18) | superfície pública do core (M0) | só re-exporta; adiciona exports de cenário sem remover os do M0 |
| `src/core/executeRequest.ts` | 91 | `061638f` (2026-06-18) | execução HTTP via fetch + captura (M0) | NÃO modificar — `runScenario` o reusa como está |
| `src/core/runStore.ts` | 49 | `061638f` (2026-06-18) | buildRunEnvelope/persistRun/loadRun (M0) | `buildRunEnvelope` reusado; sem mudança de assinatura |
| `src/mcp/server.ts` | 77 | `2f88936` (2026-06-18) | adaptador MCP stdio + tool run_request (M0) | tool `run_request` permanece; adiciona `run_scenario` |
| `src/web/render.ts` | 90 | `8038343` (2026-06-18) | run → HTML puro (M0) | render existente preservado; passa a exibir asserts/captures quando presentes |
| `package.json` | ~30 | `2f88936` (2026-06-18) | manifest (M0) | adicionar `jsonpath-plus`; runtime deps continuam mínimas |
| `src/core/scenarioSchema.ts` (NEW) | 0 | — | (a criar) schema zod do cenário + tipos | `schemaVersion` literal `1`; steps ≥ 1 |
| `src/core/interpolate.ts` (NEW) | 0 | — | (a criar) interpolação `${{ var }}` pura | template sem var → erro tipado ou mantém literal (decidido na T1.2) |
| `src/core/evalCapture.ts` (NEW) | 0 | — | (a criar) captura via jsonpath-plus + regex | jsonpath sem match → valor `null`; nunca lança por miss |
| `src/core/evalAssert.ts` (NEW) | 0 | — | (a criar) avaliação de assert → {pass,expected,actual} | nunca lança; assert inválido → pass:false com motivo |
| `src/core/runScenario.ts` (NEW) | 0 | — | (a criar) engine step-a-step | reusa executeRequest+buildRunEnvelope; falha de rede aborta cenário |
| `src/core/scenarioSchema.test.ts` (NEW) | 0 | — | RED test do schema de cenário | — |
| `src/core/interpolate.test.ts` (NEW) | 0 | — | RED test interpolação | — |
| `src/core/evalCapture.test.ts` (NEW) | 0 | — | RED test captura | — |
| `src/core/evalAssert.test.ts` (NEW) | 0 | — | RED test asserts | — |
| `src/core/runScenario.test.ts` (NEW) | 0 | — | integração da engine vs http efêmero | — |
| `src/mcp/scenario.test.ts` (NEW) | 0 | — | integração tool run_scenario via InMemoryTransport | — |
| `src/web/render.test.ts` | 51 | `2f88936` (2026-06-18) | RED test do render (M0) | adiciona casos de asserts/captures |
| `src/scenario-e2e.test.ts` (NEW) | 0 | — | E2E cenário 2-step | — |
| `CHANGELOG.md` | ~30 | `e1050fd` (2026-06-18) | contrato público | nunca editar `[0.1.0]` released; entradas vão em `[Unreleased]` |

### Current callers / dependents

- **Símbolo `RunStepSchema`/`RunStep`** (`src/core/runSchema.ts`): callers em produção — `src/core/runStore.ts` (envelope), `src/web/render.ts` (itera steps). Estender com campos `.optional()` é backward-compatible: callers existentes não quebram (não leem os novos campos). Tests: `runSchema.test.ts`, `render.test.ts`.
- **Símbolo `executeRequest`** (`src/core/executeRequest.ts`): caller atual `src/mcp/server.ts:run_request`. M1 adiciona caller `src/core/runScenario.ts` (reuso, sem mudar a assinatura).
- **Símbolo `buildRunEnvelope`** (`src/core/runStore.ts`): caller `src/mcp/server.ts`. M1 adiciona caller `runScenario.ts`.
- External (API pública consumida por outro repo): **não**.

### Domain glossary

- **scenario (cenário)** — artefato declarativo de entrada: `{schemaVersion, name, steps[]}`; cada step = request + captures + asserts. Distinto do **run** (saída executada).
- **capture** — extração de um valor da resposta (via jsonpath e/ou regex) para uma variável nomeada, usável em steps seguintes.
- **assert** — verificação `{source, op, value}` sobre a resposta, avaliada para `{pass, expected, actual}`.
- **interpolation** — substituição de `${{ var }}` em campos do request pelos valores das variáveis capturadas.
- **variables** — mapa nome→valor acumulado ao longo dos steps (capturas).

### Architecture boundaries affected

Mantém `rules/architecture.md` §1–§2: a engine de cenário e a avaliação de asserts/captura ficam no **core** (`src/core/`), domínio puro; `src/mcp/` ganha a tool `run_scenario` (adaptador); `src/web/` exibe asserts/captures (adaptador). Direção de import: `mcp → core`, `web → core`; o core não importa mcp/web. `jsonpath-plus` é dep de runtime do core (encapsulada em `evalCapture.ts`).

## Prior Art & Related Work

- **Internal blueprint:** `knowledge-base/discoveries/blueprints/m1-scenario-model-blueprint.md` — ADRs D1–D5, Coverage Corners 1–4, Cross-cutting Comparison, Recommendations 1–8. Fonte primária.
- **Internal blueprint (M0):** `knowledge-base/discoveries/blueprints/m0-walking-skeleton-blueprint.md` — envelope N-step (ADR D3) que M1 reusa.
- **Reference projects** (`knowledge-base/references/`):
  - `step-ci/examples/captures.yml` — formato declarativo (steps/captures/check) + interpolação `${{captures.x}}`.
  - `hurl/packages/hurl_core/src/ast/section.rs` — structs `Capture {name,query,filters}` / `Assert {query,filters,predicate}`.
  - `hurl/packages/hurl/src/runner/capture.rs`, `assert.rs`, `predicate.rs` — pipeline de captura + tipos de predicado.
- **Patterns skills** (`skills/*-patterns/`): nenhum registrado ainda.

## Objective

- [ ] Sub-goal 1 — Schema de cenário JSON (`{schemaVersion:1, name, steps[]}`) validado por zod; `RunStep` estendido com `asserts`/`captures` opcionais (backward-compatible).
- [ ] Sub-goal 2 — `interpolate(template, variables)` substitui `${{ var }}` puro e determinístico.
- [ ] Sub-goal 3 — `evalCapture` extrai valor via jsonpath-plus (+ regex opcional); miss → null sem lançar.
- [ ] Sub-goal 4 — `evalAssert` avalia `{source,op,value}` → `{pass,expected,actual}` para status/header/jsonpath body; ops mínimos cobertos.
- [ ] Sub-goal 5 — `runScenario` executa step-a-step: interpola, reusa `executeRequest`, captura, asserta, acumula variáveis, produz envelope do M0 com steps estendidos.
- [ ] Sub-goal 6 — Tool MCP `run_scenario` + render web de asserts/captures + E2E 2-step verde.

## ADRs

### D1 — Cenário JSON validado por zod (não YAML+ajv nem parser custom)

**Decision:** cenário é um JSON `{schemaVersion:1, name, steps[]}` validado por `ScenarioSchema` (zod) no core, como `loadRun` valida o envelope.

**Rationale:** autor é o agente via MCP (emite JSON trivial); JSON consistente com o run + diff-amigável (alinha M3); zod já é dep (Rule 9 — sem yaml/ajv). Blueprint ADR D1.

**Alternatives considered:** YAML como step-ci (rejeitado M1 — dep de parser + conveniência humana, volta no M2); `.hurl` + parser custom (rejeitado — reinventa parser, Rule 9).

**Consequences:** YAML/UI fica para M2; o schema zod é a fonte única do formato.

### D2 — Captura via `jsonpath-plus` + regex nativo; propagação por interpolação

**Decision:** captura = `{ varName: { jsonpath: "$.x", regex?: "..." } }` avaliada por `jsonpath-plus` (sem o recurso de eval/script — só path queries) + `RegExp` nativo; valor entra num mapa `variables` interpolado via `${{ varName }}` nos steps seguintes.

**Rationale:** espelha o pipeline `query |> filters` do hurl (`capture.rs`), em TS reusando lib madura (Rule 9 / parsimony rung 2-4). `jsonpath-plus@^10.4.0` está CLEAN no OSV (CVEs de RCE corrigidos em 10.0.0+). Blueprint ADR D2.

**Alternatives considered:** reimplementar jsonpath (rejeitado — Rule 9); lib `jsonpath` clássica (rejeitado — menos mantida, usa `static-eval`); só regex (rejeitado — jsonpath é o caso dominante em body JSON).

**Consequences:** 1 dep runtime nova (jsonpath-plus), encapsulada em `evalCapture.ts`; uso restrito a path queries (sem eval) por segurança.

### D3 — Assert `{source, op, value}` → `{pass, expected, actual}`; status como açúcar

**Decision:** assert = `{ source: "status"|"header:<name>"|"jsonpath:<expr>", op: "equals"|"notEquals"|"contains"|"matches"|"exists"|"gt"|"gte"|"lt"|"lte", value? }` → `{pass, expected, actual}`. Açúcar `check.status: N` ≡ `{source:"status", op:"equals", value:N}`.

**Rationale:** subconjunto dos predicados do hurl (`predicate.rs`) suficiente para o DoD (status/headers/body) sem copiar a superfície inteira (YAGNI). `expected/actual` torna a falha inspecionável (M2/M3). Blueprint ADR D3.

**Alternatives considered:** portar todos os predicados do hurl (rejeitado — YAGNI); só status (rejeitado — DoD exige headers + body jsonpath/regex).

**Consequences:** novos ops são adições (OCP); resultado estável para render.

### D4 — Reusar envelope do M0; `RunStep` ganha `asserts`/`captures` OPCIONAIS (sem migração)

**Decision:** resultado continua `{schemaVersion:1, runId, createdAt, steps[]}`; `RunStep` ganha `asserts?: [{source,op,value?,pass,expected,actual}]` e `captures?: {[name]: value}` (opcionais). `schemaVersion` permanece `1` (aditivo = backward-compatible).

**Rationale:** o M0 (ADR D3) desenhou o envelope N-step para isto — reuso sem refactor (sem re-trabalho). Opcional-aditivo não quebra `loadRun` nem runs M0 (KISS — sem union de versões/migração; YAGNI). Blueprint ADR D4.

**Alternatives considered:** `schemaVersion:2` + migração (rejeitado — complexidade sem ganho no M1); novo formato de run (rejeitado — viola D3 do M0).

**Consequences:** `RunStepSchema` ganha `.optional()`; `render.ts` (que já itera steps) passa a exibir asserts/captures quando presentes.

### D5 — Engine no core; tool MCP `run_scenario`

**Decision:** `src/core/runScenario.ts` (engine pura: itera steps, interpola, chama `executeRequest`, captura, asserta, acumula) + tool MCP `run_scenario` (adaptador) + render web de asserts/captures.

**Rationale:** `architecture.md` §1–§2 — engine é domínio, não transporte; reusa `executeRequest` (DIP mantido). Blueprint ADR D5.

**Alternatives considered:** engine no handler MCP (rejeitado — acopla, impede reuso pelo web e teste isolado, viola SRP/DIP).

**Consequences:** `run_scenario` é caller de produção da engine (wiring pillar a); engine unit-testável sem MCP.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `jsonpath-plus` historicamente teve CVE de RCE (eval em expressões) | Medium | Pinar `^10.4.0` (≥10.0.0, eval desabilitado por default; OSV CLEAN); usar SÓ path queries, nunca o modo script; deps-audit confirma | impl |
| Interpolação de `${{var}}` em URL pode injetar caracteres inválidos (var capturada com `/`, espaços) | Medium | `encodeURIComponent` ao interpolar em segmento de URL; teste com valor capturado contendo caractere especial | impl |
| Cenário longo/loop infinito de steps trava a engine | Low | Cada step herda o timeout do `executeRequest` (M0, AbortController); cenário é lista finita (sem loops no M1) | impl |
| Assert contra campo volátil (timestamp/id aleatório) gera falso-negativo | Low | Risco aceito no M1; normalização é escopo declarado de M5 (Keploy). Documentado. | impl |

## Unresolved Questions

- Q1 — Ao falhar um assert, o cenário continua os steps seguintes ou aborta? Resolução proposta: **continua** avaliando todos os asserts do step e segue para o próximo step (registra fail), mas **falha de REQUEST (rede)** aborta o cenário (não há resposta para capturar/asserir) — resolvido na T1.5.
- Q2 — `interpolate` com variável inexistente: lança ou mantém literal? Resolução proposta: **lança** `ScenarioError` tipado (fail-fast — var ausente é erro de cenário) — resolvido na T1.2.
- (demais decisões resolvidas em plan time via D1–D5.)

## Dependencies

Estende o manifest do M0. Uma dep de runtime nova (jsonpath); regex via `RegExp` nativo; validação via zod (já presente).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | `^1.20.0` | npm | tool MCP `run_scenario` (M0) |
| `zod` | `^3.25.1` | npm | validação do schema de cenário (reuso M0) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| `jsonpath-plus` (NEW) | `^10.4.0` | npm | Avaliado: reimplementar jsonpath (rejeitado — Rule 9, hurl só fez por ser binário Rust standalone); `jsonpath` clássico (rejeitado — menos mantido, usa `static-eval`); `@jsonquerylang/jsonquery` (rejeitado — sintaxe não-jsonpath, menos familiar) | jsonpath padrão `$.x`, mantido, OSV CLEAN @10.4.0 (CVE RCE corrigido em 10.0.0+); usado só p/ path queries (sem eval) |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Dependency Graph

```
Phase 0 (dep) ──▶ Phase 1 (core: schema → interpolate → evalCapture → evalAssert → runScenario)
                         └──▶ Phase 2 (MCP tool) ──┐
                         └──▶ Phase 3 (web render) ─┴─▶ Phase 4 (E2E + validação)
```

Phase 1 é sequencial internamente (runScenario depende de interpolate/evalCapture/evalAssert/schema). Phase 2 e Phase 3 paralelizam (ambos dependem só do core). Phase 4 depende de 2 e 3.

---

## Phase 0: Dependência

**Objective:** adicionar `jsonpath-plus` e confirmar CVE-clean.

### T0.1 — Adicionar jsonpath-plus

#### Objective
Instalar `jsonpath-plus@^10.4.0` e confirmar 0 CVE.

#### Why this step (action + reasoning)
1. **What:** adiciona `jsonpath-plus` às `dependencies` do `package.json` e `npm install`.
2. **Why now:** `evalCapture` (T1.3) depende dela; instalar primeiro destrava o ciclo TDD. Decisão fixada no blueprint ADR D2 + deps-audit.

#### Evidence
Blueprint §"Coverage Corner 2 — Dependencies" (não reinventar jsonpath; lib decidida em plan-phase). `knowledge-base/discoveries/blueprints/m1-scenario-model-blueprint.md`.

#### Files to edit
```
package.json — adiciona "jsonpath-plus": "^10.4.0" em dependencies
```

#### Deep file dependency analysis
`package.json` (M0, `2f88936`). Downstream: `evalCapture.ts` importará `jsonpath-plus`. `npm install` atualiza o lockfile (versionado).

#### Deep Dives
- `jsonpath-plus` v10 expõe `JSONPath({ path, json })`; o modo `eval` (script) fica DESABILITADO por default — usar só path queries.
- Invariant: nenhuma outra dep runtime adicionada.

#### Tasks
1. Adicionar a dep ao `package.json`.
2. `npm install`; `npm audit` para confirmar 0 CRITICAL/HIGH.

#### TDD
```
RED:     (sem teste de código — passo de build) — guard: import { JSONPath } from "jsonpath-plus" resolve em src/core/evalCapture.ts (verificado na T1.3)
GREEN:   npm install conclui; npm run typecheck OK
REFACTOR: None expected
VERIFY:  npm audit
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `npm ls jsonpath-plus` mostra `10.x` instalado
- [ ] `npm audit` reporta 0 CRITICAL/HIGH (incl. transitivos)
- [ ] `npm run typecheck` reporta 0 erros
- [ ] Pass: cada arquivo ≤ 500 linhas (`wc -l`)

#### DoD
- [ ] `npm audit` verde; lockfile versionado

---

## Phase 1: Core — schema, interpolação, captura, asserts, engine

**Objective:** implementar o modelo de cenário e a engine de execução, 100% testável sem MCP/web.

### T1.1 — Schema de cenário + extensão do RunStep

#### Objective
Definir `ScenarioSchema` (zod) e estender `RunStepSchema` com `asserts`/`captures` opcionais; `loadScenario`.

#### Why this step (action + reasoning)
1. **What:** cria `src/core/scenarioSchema.ts` (Scenario/Step/Capture/Assert specs) e adiciona campos `.optional()` `asserts`/`captures` ao `RunStepSchema` em `src/core/runSchema.ts`; adiciona `loadScenario` (read+validate).
2. **Why now:** o schema é o contrato compartilhado por interpolate/capture/assert/engine; defini-lo primeiro impede divergência (D1/D4). A extensão opcional do RunStep é o ponto-chave anti-refactor (D4).

#### Evidence
Blueprint §"T1" (formato), §"D4" (RunStep aditivo). `knowledge-base/references/step-ci/examples/captures.yml`; `src/core/runSchema.ts:30` (RunStepSchema atual).

#### Files to edit
```
src/core/scenarioSchema.ts (NEW) — ScenarioSchema + AssertSpec + CaptureSpec + tipos
src/core/runSchema.ts — adiciona asserts?/captures? opcionais ao RunStepSchema + AssertResult schema
src/core/scenarioSchema.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
`runSchema.ts` (M0): RunStepSchema é consumido por runStore + render. Adicionar `.optional()` é backward-compatible (verificado: render itera mas não exige os campos). `scenarioSchema.ts` NEW. Downstream: interpolate/evalCapture/evalAssert/runScenario importam os tipos.

#### Deep Dives
- `AssertSpecSchema = z.object({ source: z.string(), op: z.enum(["equals","notEquals","contains","matches","exists","gt","gte","lt","lte"]), value: z.unknown().optional() })`.
- `CaptureSpecSchema = z.object({ jsonpath: z.string().optional(), regex: z.string().optional() })` (≥1 presente).
- `ScenarioStepSchema = z.object({ name: z.string(), request: {method,url,headers?,body?}, captures: z.record(CaptureSpecSchema).optional(), asserts: z.array(AssertSpecSchema).optional() })`.
- `ScenarioSchema = z.object({ schemaVersion: z.literal(1), name: z.string(), steps: z.array(ScenarioStepSchema).min(1) })`.
- `AssertResultSchema = z.object({ source, op, value?, pass: z.boolean(), expected: z.unknown(), actual: z.unknown() })`.
- `RunStepSchema` += `asserts: z.array(AssertResultSchema).optional()`, `captures: z.record(z.unknown()).optional()`.
- Invariant: RunStep do M0 (sem asserts/captures) continua válido.

#### Tasks
1. Escrever `scenarioSchema.ts`.
2. Estender `RunStepSchema` com os 2 campos opcionais + `AssertResultSchema`.
3. `loadScenario(path)` (read + `ScenarioSchema.parse`).

#### TDD
```
RED:     scenario_schema_accepts_valid_multistep() — cenário 2-step com captures+asserts faz parse
RED:     scenario_schema_rejects_empty_steps() — steps:[] falha
RED:     run_step_still_accepts_m0_shape() — RunStep sem asserts/captures (forma M0) continua válido (backward-compat)
RED:     run_step_accepts_asserts_and_captures() — RunStep com asserts[]+captures{} faz parse
GREEN:   implementar até os 4 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/core/scenarioSchema.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 4 RED tests passam — `npx vitest run src/core/scenarioSchema.test.ts` verde
- [ ] RunStep do M0 (sem novos campos) valida — backward-compat provada
- [ ] Pass: cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/core/scenarioSchema.test.ts` verde; `npm run typecheck` 0 erros

### T1.2 — interpolate (`${{ var }}`)

#### Objective
Função pura que substitui `${{ var }}` num template pelos valores de `variables`; var ausente → erro tipado.

#### Why this step (action + reasoning)
1. **What:** cria `src/core/interpolate.ts` (`interpolate(template, variables)`) e `ScenarioError` em `src/core/errors.ts` (reuso do arquivo de erros do M0).
2. **Why now:** a engine precisa interpolar url/headers/body de cada step antes de executar; isolar puro torna testável e resolve Q2 (var ausente → fail-fast).

#### Evidence
Blueprint §"T1"/"D2" (interpolação `${{ }}` do step-ci). `knowledge-base/references/step-ci/examples/captures.yml` (`${{captures.id}}`).

#### Files to edit
```
src/core/interpolate.ts (NEW) — interpolate puro
src/core/errors.ts — adiciona ScenarioError (M0 errors.ts existente)
src/core/interpolate.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
`errors.ts` (M0): tem `RequestExecutionError`; adicionar `ScenarioError` é aditivo. `interpolate.ts` NEW. Downstream: `runScenario` usa `interpolate`.

#### Deep Dives
- `interpolate(template: string, variables: Record<string, unknown>): string` — regex `/\$\{\{\s*([\w.]+)\s*\}\}/g`; cada match → `variables[name]`; ausente → `throw new ScenarioError("undefined variable: "+name)`.
- `interpolateRequest(request, variables)` — aplica em url (com `encodeURIComponent` no valor interpolado dentro de segmento — Drawback), headers values, body.
- Edge: template sem placeholders → retorna igual; valor não-string → `String(value)`.

#### Pseudo-code / Signatures
```pseudocode
function interpolate(template, variables):
  return template.replace(/\$\{\{\s*([\w.]+)\s*\}\}/g, (_, name) =>
    name in variables ? String(variables[name]) : throw ScenarioError("undefined variable: "+name))
# Example
interpolate("/posts/${{ id }}", {id: 42}) -> "/posts/42"
interpolate("/x/${{ missing }}", {})      -> throws ScenarioError
```

#### Tasks
1. `ScenarioError` em errors.ts.
2. `interpolate` + `interpolateRequest`.

#### TDD
```
RED:     interpolate_substitutes_variable() — "/p/${{ id }}" + {id:42} → "/p/42"
RED:     interpolate_throws_on_undefined_variable() — var ausente lança ScenarioError
RED:     interpolate_leaves_plain_template_unchanged() — sem placeholder → igual
RED:     interpolate_request_encodes_url_value() — valor com caractere especial é encodeURIComponent na URL
GREEN:   implementar até os 4 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/core/interpolate.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 4 RED tests passam — `npx vitest run src/core/interpolate.test.ts` verde
- [ ] Var ausente → `ScenarioError` (fail-fast, Q2 resolvida)
- [ ] Pass: cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/core/interpolate.test.ts` verde

### T1.3 — evalCapture (jsonpath-plus + regex)

#### Objective
Extrair valor da resposta via jsonpath e/ou regex; miss → null sem lançar.

#### Why this step (action + reasoning)
1. **What:** cria `src/core/evalCapture.ts` (`evalCapture(spec, response)`), encapsulando `jsonpath-plus`.
2. **Why now:** a engine captura variáveis após cada step; encapsular a lib num módulo (DIP) isola a dependência e resolve a captura testável.

#### Evidence
Blueprint §"T2"/"D2" (pipeline query→filtros). `knowledge-base/references/hurl/packages/hurl/src/runner/capture.rs:35` (eval_capture).

#### Files to edit
```
src/core/evalCapture.ts (NEW) — evalCapture via jsonpath-plus + RegExp
src/core/evalCapture.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
NEW. Importa `jsonpath-plus` (T0.1) e tipos de scenarioSchema/runSchema. Downstream: `runScenario` chama `evalCapture` por step.

#### Deep Dives
- `evalCapture(spec: CaptureSpec, response: CapturedResponse): unknown` — se `spec.jsonpath`: `JSONPath({path: spec.jsonpath, json: JSON.parse(response.body)})` → primeiro match ou `null`; se `spec.regex`: `new RegExp(spec.regex).exec(response.body)?.[1] ?? match[0] ?? null`; jsonpath+regex → aplica regex no resultado do jsonpath.
- jsonpath em body não-JSON → catch → null (não lança).
- Invariant: nunca lança por miss/parse; retorna `null`.

#### Pseudo-code / Signatures
```pseudocode
function evalCapture(spec, response):
  value = response.body
  if spec.jsonpath:
    try: value = JSONPath({path: spec.jsonpath, json: JSON.parse(response.body)})[0] ?? null
    catch: return null
  if spec.regex and value != null:
    m = new RegExp(spec.regex).exec(String(value)); value = m ? (m[1] ?? m[0]) : null
  return value
# Example
evalCapture({jsonpath:"$.id"}, {body:'{"id":7}'}) -> 7
evalCapture({jsonpath:"$.x"},  {body:'{"id":7}'}) -> null
```

#### Tasks
1. `evalCapture` com jsonpath + regex.

#### TDD
```
RED:     eval_capture_extracts_jsonpath() — {jsonpath:"$.id"} sobre '{"id":7}' → 7
RED:     eval_capture_returns_null_on_miss() — jsonpath sem match → null (não lança)
RED:     eval_capture_returns_null_on_non_json_body() — jsonpath sobre body não-JSON → null
RED:     eval_capture_applies_regex() — {regex:"v(\\d+)"} sobre "v42" → "42"
GREEN:   implementar até os 4 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/core/evalCapture.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 4 RED tests passam — `npx vitest run src/core/evalCapture.test.ts` verde
- [ ] Miss/parse-error → `null` (nunca lança)
- [ ] Pass: coverage ≥ 90% em `evalCapture.ts`; cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/core/evalCapture.test.ts` verde

### T1.4 — evalAssert (status/header/jsonpath × ops)

#### Objective
Avaliar `{source, op, value}` sobre a resposta → `{pass, expected, actual}`; nunca lança.

#### Why this step (action + reasoning)
1. **What:** cria `src/core/evalAssert.ts` (`evalAssert(assert, response)`), reusando a extração de source (status/header/jsonpath) e os ops.
2. **Why now:** é o coração da verificação do DoD; isolar puro torna cada op testável e o resultado inspecionável.

#### Evidence
Blueprint §"T3"/"D3" (assert model). `knowledge-base/references/hurl/packages/hurl/src/runner/predicate.rs:155-202` (tipos de predicado); `.../response.rs:38` (status implícito).

#### Files to edit
```
src/core/evalAssert.ts (NEW) — evalAssert + extração de source + ops
src/core/evalAssert.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
NEW. Importa tipos de scenarioSchema/runSchema; reusa `evalCapture` (jsonpath) p/ source `jsonpath:`. Downstream: `runScenario` chama `evalAssert` por assert.

#### Deep Dives
- `extractActual(source, response)`: `status` → response.status; `header:<name>` → `response.headers[name.toLowerCase()]` (**[EC-1] case-insensitive** — headers do M0 são lowercased); `jsonpath:<expr>` → JSONPath sobre body.
- `applyOp` faz `String(actual)` antes de `contains`/`matches` (**[EC-2]** coerção — actual pode ser numérico).
- `applyOp(op, actual, expected)`: equals/notEquals (==), contains (String.includes), matches (RegExp), exists (actual != null), gt/gte/lt/lte (Number).
- `evalAssert(assert, response): AssertResult` = `{source, op, value, pass, expected: value, actual}`; qualquer erro de extração → `pass:false, actual:null`.
- Invariant: nunca lança; sempre retorna AssertResult.

#### Pseudo-code / Signatures
```pseudocode
function evalAssert(a, response):
  actual = extractActual(a.source, response)   // status | header:x | jsonpath:expr
  pass = applyOp(a.op, actual, a.value)
  return { source:a.source, op:a.op, value:a.value, pass, expected:a.value, actual }
# Example
evalAssert({source:"status",op:"equals",value:200}, {status:200}) -> {pass:true, expected:200, actual:200}
evalAssert({source:"jsonpath:$.ok",op:"equals",value:true}, {body:'{"ok":false}'}) -> {pass:false, actual:false}
```

#### Tasks
1. `extractActual` (3 sources).
2. `applyOp` (9 ops).
3. `evalAssert`.

#### TDD
```
RED:     eval_assert_status_equals() — status 200, op equals 200 → pass:true
RED:     eval_assert_header_contains() — header:content-type contains "json" → pass conforme
RED:     eval_assert_jsonpath_body() — jsonpath:$.ok equals true sobre '{"ok":true}' → pass:true
RED:     eval_assert_records_expected_and_actual_on_fail() — assert que falha registra expected≠actual, pass:false
RED:     eval_assert_matches_regex() — op matches com value regex sobre actual string
RED:     eval_assert_never_throws_on_bad_source() — source jsonpath inválido → pass:false, actual null (não lança)
RED:     eval_assert_header_case_insensitive() — [EC-1] assert source "header:Content-Type" casa com header lowercased "content-type"
RED:     eval_assert_contains_coerces_to_string() — [EC-2] op contains sobre actual numérico não lança (String coercion)
GREEN:   implementar até os 8 passarem
REFACTOR: extrair applyOp/extractActual se ajudar
VERIFY:  npx vitest run src/core/evalAssert.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 8 RED tests passam — `npx vitest run src/core/evalAssert.test.ts` verde
- [ ] Header case-insensitive (EC-1); ops coercem actual não-string (EC-2); nunca lança; `{pass, expected, actual}` sempre presente
- [ ] Pass: coverage ≥ 90% em `evalAssert.ts`; cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/core/evalAssert.test.ts` verde

### T1.5 — runScenario (engine step-a-step)

#### Objective
Executar o cenário: por step, interpola request, reusa `executeRequest`, avalia asserts, captura variáveis (propaga), monta o envelope do M0 com steps estendidos.

#### Why this step (action + reasoning)
1. **What:** cria `src/core/runScenario.ts` (`runScenario(scenario, deps)`), orquestrando interpolate + executeRequest (M0) + evalAssert + evalCapture + buildRunEnvelope (M0).
2. **Why now:** é a engine que fecha os Sub-goals 1-5 e o DoD (roda step-a-step, propaga variáveis, avalia asserts, resultado por step). Reusa o core do M0 (D4/D5).

#### Evidence
Blueprint §"D5"/"Recommendations #7". `knowledge-base/references/hurl/packages/hurl/src/runner/capture.rs` (fluxo). M0: `src/core/executeRequest.ts:27`, `src/core/runStore.ts` (buildRunEnvelope).

#### Files to edit
```
src/core/runScenario.ts (NEW) — engine
src/core/index.ts — re-exporta runScenario, loadScenario, tipos de cenário (sem remover exports M0)
src/core/runScenario.test.ts (NEW) — integração vs http.Server efêmero
```

#### Deep file dependency analysis
NEW + index.ts (M0). Importa executeRequest+buildRunEnvelope (M0), interpolate (T1.2), evalCapture (T1.3), evalAssert (T1.4), schemas (T1.1). `index.ts` ganha exports de cenário (aditivo). Downstream: tool MCP `run_scenario` (T2.1) e E2E.

#### Deep Dives
- `runScenario(scenario: Scenario, deps?: EnvelopeDeps & {timeoutMs?}): Promise<RunEnvelope>`.
- Loop: `variables = {}`; para cada step: `req = interpolateRequest(step.request, variables)`; `runStep = await executeRequest(req, {timeoutMs})` (M0); `asserts = (step.asserts ?? []).map(a => evalAssert(a, runStep.response))`; `captures = {}`; para cada `[name, spec]` de `step.captures`: `captures[name] = evalCapture(spec, runStep.response)`; `variables = {...variables, ...captures}`; push `{...runStep, asserts, captures}`.
- **Q1 resolvida:** assert fail NÃO aborta (registra e segue); **falha de rede** (`executeRequest` lança `RequestExecutionError`) ABORTA o cenário — propaga o erro (fail-fast); a engine não engole.
- `buildRunEnvelope(steps, deps)` (M0) monta o envelope final.
- Invariant: variáveis capturadas no step N estão disponíveis no step N+1; ordem preservada.

#### Pseudo-code / Signatures
```pseudocode
async function runScenario(scenario, deps):
  variables = {}; steps = []
  for step in scenario.steps:
    req = interpolateRequest(step.request, variables)
    runStep = await executeRequest(req, {timeoutMs: deps.timeoutMs})   // lança em falha de rede → aborta
    asserts = (step.asserts ?? []).map(a => evalAssert(a, runStep.response))
    captures = {}; for [name, spec] in entries(step.captures ?? {}): captures[name] = evalCapture(spec, runStep.response)
    variables = {...variables, ...captures}
    steps.push({...runStep, asserts, captures})
  return buildRunEnvelope(steps, deps)
# Example: step1 captura id de POST; step2 usa ${{id}} na URL; assert status 200 em ambos → envelope 2-step
```

#### Tasks
1. Loop da engine com interpolação + captura propagada + asserts.
2. Re-exportar em index.ts.

#### TDD
```
RED:     run_scenario_executes_steps_in_order() — cenário 2-step contra http.Server local → envelope com 2 steps na ordem
RED:     run_scenario_propagates_captured_variable() — step1 captura id; step2 usa ${{id}} na URL → request do step2 reflete o valor
RED:     run_scenario_records_assert_pass_and_fail() — step com assert que passa e outro que falha → asserts[].pass corretos
RED:     run_scenario_aborts_on_network_error() — step com url para porta fechada → runScenario rejeita (RequestExecutionError), não engole
RED:     run_scenario_result_step_has_asserts_and_captures() — envelope.steps[].asserts e .captures presentes
GREEN:   implementar até os 5 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/core/runScenario.test.ts
```

#### Concurrency tests
(none — single-threaded)
Nota: steps são SEQUENCIAIS por design (variáveis propagam do step N ao N+1); `await` em série, sem estado compartilhado concorrente. Não há invariante de corrida no M1.

#### Acceptance Criteria
- [ ] Os 5 RED tests passam — `npx vitest run src/core/runScenario.test.ts` verde
- [ ] Variável capturada propaga ao step seguinte; ordem preservada; falha de rede aborta (Q1)
- [ ] Pass: coverage ≥ 90% em `runScenario.ts`; cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/core/runScenario.test.ts` verde; `src/core/index.ts` exporta a API de cenário

---

## Phase 2: MCP adapter — tool run_scenario

**Objective:** expor `run_scenario` via MCP, delegando à engine; persiste o run; métrica.

### T2.1 — Tool MCP run_scenario

#### Objective
Registrar `run_scenario` (aceita o cenário), delegar a `runScenario`, persistir via `persistRun`, retornar `structuredContent` = envelope; contador + log stderr.

#### Why this step (action + reasoning)
1. **What:** adiciona `registerTool("run_scenario", {inputSchema: ScenarioSchema.shape, outputSchema: RunEnvelopeSchema.shape}, handler)` em `src/mcp/server.ts`; handler chama `runScenario` + `persistRun`; incrementa `scenarioRunCount`.
2. **Why now:** fecha o Sub-goal 6 (lado agente) e provê o produtor de runs de cenário para o E2E. Reusa o padrão da tool `run_request` do M0 (D5).

#### Evidence
Blueprint §"D5". M0: `src/mcp/server.ts:run_request` (padrão registerTool + outputSchema + persistRun + métrica).

#### Files to edit
```
src/mcp/server.ts — adiciona tool run_scenario (run_request preservada)
src/mcp/scenario.test.ts (NEW) — integração via InMemoryTransport
```

#### Deep file dependency analysis
`server.ts` (M0, `2f88936`): tem `buildServer` + `run_request` + `getRunCount`. Adiciona `run_scenario` + `getScenarioRunCount` (aditivo; `run_request` intacto). Importa `runScenario`+`ScenarioSchema` de `../core/index.js`. Downstream: E2E.

#### Deep Dives
- Handler: `const env = await runScenario(scenario); const path = await persistRun(env); scenarioRunCount++; console.error(JSON.stringify({event:"run_scenario", steps: env.steps.length, path})); return {content:[{type:"text",text:JSON.stringify(env,null,2)}], structuredContent: env}`.
- `inputSchema: ScenarioSchema.shape` (valida o cenário na fronteira MCP).
- `RequestExecutionError` (falha de rede num step) → o SDK envolve em `isError` (como no M0); não crash.
- Invariant: stdout = protocolo; logs em stderr.

#### Tasks
1. `registerTool("run_scenario", ...)` + handler delegando a runScenario.
2. `scenarioRunCount` + `getScenarioRunCount()` + log stderr.

#### TDD
```
RED:     run_scenario_tool_executes_and_returns_envelope() — via InMemoryTransport, callTool run_scenario c/ cenário 2-step → structuredContent com 2 steps, schemaVersion 1
RED:     run_scenario_tool_persists_run_file() — após callTool, runs/{runId}.json existe e loadRun valida
RED:     run_scenario_tool_increments_count() — getScenarioRunCount() sobe de 0→1 (métrica/wiring)
GREEN:   implementar até os 3 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/mcp/scenario.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 3 RED tests passam — `npx vitest run src/mcp/scenario.test.ts` verde
- [ ] `run_request` (M0) continua funcionando (`npx vitest run src/mcp/server.test.ts` verde)
- [ ] Pass: coverage ≥ 90% no trecho novo; cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/mcp/` verde; handler é caller de produção da engine (wiring a); integração (b); contador (c)

---

## Phase 3: Web — render de asserts/captures por step

**Objective:** exibir, por step, os asserts (pass/fail, expected/actual) e as variáveis capturadas.

### T3.1 — Render de asserts/captures

#### Objective
Estender `renderRun` para, quando o step tiver `asserts`/`captures`, exibir uma tabela de asserts (com cor pass/fail) e a lista de variáveis capturadas.

#### Why this step (action + reasoning)
1. **What:** adiciona seções no `src/web/render.ts` que iteram `step.asserts` e `step.captures` (quando presentes), escapando HTML.
2. **Why now:** fecha o Sub-goal 6 (lado humano) e o requisito do DoD "pass/fail por assert visível". O render do M0 já itera steps — extensão aditiva (D4).

#### Evidence
Blueprint §"D3"/"D4" (resultado inspecionável). M0: `src/web/render.ts:90` (render que itera steps).

#### Files to edit
```
src/web/render.ts — adiciona assertsTable + capturesList por step (preserva render M0)
src/web/render.test.ts — adiciona casos de asserts/captures
```

#### Deep file dependency analysis
`render.ts` (M0, `8038343`): `renderRun` itera steps com Request/Response. Adiciona blocos condicionais para asserts/captures. `render.test.ts` (M0) ganha casos. Downstream: web server (sem mudança — só renderiza).

#### Deep Dives
- `assertsTable(asserts)`: linhas `source | op | value | pass?` com classe `pass`/`fail` (cor verde/vermelha); diferença pass/fail visualmente evidente (DoD).
- `capturesList(captures)`: `name = value` (escapado).
- Só renderiza as seções quando `step.asserts?.length`/`step.captures` presente (backward-compat com runs M0).
- Invariant: escapa todo valor dinâmico (anti-XSS, como M0).

#### Tasks
1. `assertsTable` + `capturesList`.
2. Inserir no `stepSection` quando presentes.

#### TDD
```
RED:     render_run_shows_assert_pass_and_fail() — step com 1 assert pass + 1 fail → HTML marca cada um (classe/texto pass|fail)
RED:     render_run_shows_captured_variables() — step.captures {id:7} → HTML exibe "id" e "7"
RED:     render_run_escapes_assert_values() — assert com value "<x>" → escapado no HTML
RED:     render_run_m0_step_without_asserts_still_renders() — step sem asserts/captures (forma M0) renderiza sem erro (backward-compat)
GREEN:   implementar até os 4 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/web/render.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 4 RED tests passam — `npx vitest run src/web/render.test.ts` verde
- [ ] pass/fail visualmente distinto; runs M0 (sem asserts) ainda renderizam
- [ ] Pass: cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/web/render.test.ts` verde

---

## Phase 4: E2E + Integration Validation

**Objective:** provar o cenário multi-step ponta-a-ponta e rodar a cadeia de validação.

### T4.1 — E2E cenário 2-step + CHANGELOG

#### Objective
Teste que: sobe um servidor alvo, chama `run_scenario` (via InMemoryTransport) com um cenário 2-step que captura no step1 e usa no step2, confirma asserts pass/fail e a propagação, confirma o arquivo persistido e o render.

#### Why this step (action + reasoning)
1. **What:** cria `src/scenario-e2e.test.ts` (`e2e_scenario_multistep_captures_and_asserts` — métrica do Goal) e atualiza CHANGELOG `[Unreleased]`.
2. **Why now:** prova do Sub-goal 6 e do critério do ROADMAP §M1 (engine roda step-a-step, propaga variáveis, avalia asserts, resultado por step). Depende de Phase 2 e 3.

#### Evidence
ROADMAP §M1 DoD; Blueprint §"Coverage Corner 1" (integração runScenario + InMemoryTransport).

#### Files to edit
```
src/scenario-e2e.test.ts (NEW) — loop completo de cenário
CHANGELOG.md — [Unreleased] § Added (M1)
```

#### Deep file dependency analysis
NEW. Importa buildServer/getScenarioRunCount (mcp), buildWebServer (web), loadRun (core). Integra todas as camadas.

#### Deep Dives
- Alvo: `http.Server` que no step1 (POST) responde `{"id": 7}` 201 e no step2 (GET /item/7) responde `{"ok":true}` 200 (rota por path).
- Cenário: step1 captura `id` de `$.id`, assert status 201; step2 url `/item/${{ id }}`, assert status 200 + assert jsonpath `$.ok` equals true.
- Assert: confirma `structuredContent.steps[1].request.url` contém `7` (propagação) e `steps[1].asserts` pass; persiste; `buildWebServer` renderiza com asserts/captures.
- `getScenarioRunCount` exercitado (runtime metric).

#### Tasks
1. Escrever o E2E 2-step.
2. CHANGELOG `[Unreleased] § Added`.

#### TDD
```
RED:     e2e_scenario_multistep_captures_and_asserts() — cenário 2-step: captura id no step1, usa em step2, asserts pass; arquivo persiste; web renderiza asserts/captures (métrica do Goal)
GREEN:   ajustar wiring até o E2E passar (sem alterar contratos anteriores)
REFACTOR: None expected
VERIFY:  npx vitest run src/scenario-e2e.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `e2e_scenario_multistep_captures_and_asserts` verde (metric do Goal observado)
- [ ] `getScenarioRunCount()` > 0 no E2E (runtime-metric proof)
- [ ] CHANGELOG `[Unreleased] § Added` com o M1
- [ ] Pass: `npm test` (suíte inteira) verde; `npm run typecheck` 0 erros; cada arquivo ≤ 500 linhas (`wc -l`)

#### DoD
- [ ] `npm test` verde; CHANGELOG atualizado

---

## Coverage Matrix

| # | Gap / Requirement (ROADMAP §M1 DoD) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Formato declarativo de cenário (steps ordenados; step = request + asserts; captura de variáveis para steps seguintes) | T1.1, T1.2 | `ScenarioSchema` JSON + interpolação `${{ }}` |
| 2 | Engine roda step-a-step, propaga variáveis capturadas | T1.5 | `runScenario` loop sequencial com `variables` acumulado |
| 3 | Avalia asserções (status, headers, body via jsonpath/regex) | T1.3, T1.4 | `evalAssert` (status/header/jsonpath × ops) + `evalCapture` (jsonpath/regex) |
| 4 | Resultado registra, por step, request/response/headers + pass/fail de cada assert + valor das variáveis | T1.1, T1.5, T3.1 | `RunStep` estendido com `asserts[]`+`captures{}`; render exibe |
| 5 | Lado agente (autoria/execução via MCP) | T2.1 | tool `run_scenario` |
| 6 | Demonstração multi-step ponta-a-ponta | T4.1 | `e2e_scenario_multistep_captures_and_asserts` |
| 7 | Risco #1 (não reinventar DSL) | DISCOVER, T1.1, T1.3 | formato derivado de step-ci/hurl; jsonpath-plus (não reinventado) |
| 8 | Reuso do envelope M0 sem refactor (anti re-trabalho) | T1.1, T1.5 | `RunStep` aditivo opcional + `buildRunEnvelope` reusado |

**Coverage: 8/8 gaps cobertos (100%)**

## Global Definition of Done

- [ ] Todas as fases completas
- [ ] Todos os testes verdes — `npm test`
- [ ] Zero erros de tipo — `npm run typecheck`
- [ ] Zero warnings de lint — `npm run typecheck` (tsc --strict, gate mínimo)
- [ ] Budget de tamanho respeitado (≤ 500 linhas/arquivo, `rules/architecture.md`)
- [ ] CHANGELOG.md atualizado em `[Unreleased]` (Unbreakable Rule 6)
- [ ] Compatibilidade preservada: `run_request` (M0) e runs/render M0 continuam funcionando (backward-compat do RunStep aditivo)
- [ ] Plan-specific: engine no core (nenhum import `core → mcp/web`); variável capturada propaga; assert registra pass/fail + expected/actual
- [ ] **Runtime-metric proof** — `getScenarioRunCount()` observado > 0 no E2E
- [ ] **Plan archived** — mover para `knowledge-base/plans/completed/` após `/review` READY_TO_MERGE + merge do PR

## Failure scenarios

M1 toca I/O externo via `executeRequest` (M0) reusado — cada step faz uma chamada HTTP de saída.

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| API-alvo (HTTP, por step) | step falha por erro de rede (porta fechada/DNS) | url do step para porta fechada (`run_scenario_aborts_on_network_error`) | `runScenario` rejeita com `RequestExecutionError`; cenário aborta naquele step; nenhum run parcial corrompido persistido |
| API-alvo (HTTP) | resposta com body não-JSON quando captura usa jsonpath | alvo responde texto não-JSON + step com `captures.x.jsonpath` (`eval_capture_returns_null_on_non_json_body`) | `evalCapture` → `null` (não lança); cenário segue; variável fica null |
| API-alvo (HTTP) | assert falha (status/body divergente do esperado) | alvo responde status≠esperado (`run_scenario_records_assert_pass_and_fail`) | assert registrado `pass:false` com expected≠actual; cenário NÃO aborta (segue steps) |

## Final Phase: Integration Validation (MANDATORY)

> Roda DEPOIS de todas as fases.

**Objective:** validar o cenário multi-step num workload real.

### Execution

```
npm test                  # unit + integração + e2e (vitest run)
npm run typecheck         # 0 erros (tsc --noEmit)
npx vitest run --coverage # coverage (≥ 90% no core de cenário)
npm audit                 # 0 CRITICAL/HIGH (jsonpath-plus incl.)
```

### Acceptance Criteria

- [ ] Todas as suítes verdes (unit + integração + e2e), incl. as do M0 (backward-compat)
- [ ] Coverage ≥ 90% nos arquivos novos do core (caminhos de erro: 100%)
- [ ] Zero erros de tipo
- [ ] Runtime-metric proof — `getScenarioRunCount()` > 0 no E2E
- [ ] Failure scenarios verdes — as 3 linhas exercitadas (network abort; jsonpath miss → null; assert fail registrado)
- [ ] `npm audit` 0 CRITICAL/HIGH

### If Validation Fails

1. Identificar falhas causadas por M1 vs M0 (M0 deve continuar verde — backward-compat).
2. Corrigir todas antes de declarar completo.
3. Re-rodar a cadeia.
