# Blueprint: M1 — Modelo de cenário multi-step + asserções

> Discovery executada sobre `step-ci` (formato declarativo) e `hurl` (engine de captura/assert) para fixar, antes de codar, o formato do cenário do M1 + os modelos de captura de variáveis e avaliação de asserts, reusando o envelope N-step do M0. Verdict de `/discover-confidence`: **SHIPPABLE** (score 100, 0 hard caps — 2026-06-18). Plano: `.claude/knowledge-base/discoveries/plans/m1-scenario-model-plan.md` (v1.1).

## Context

O M1 (`ROADMAP.md` §M1, depende de M0 entregue em v0.1.0) pede: (1) formato declarativo de cenário (steps ordenados; cada step = request + asserts; captura de variáveis para steps seguintes); (2) engine que roda step-a-step, propaga variáveis e avalia asserts (status/headers/body via jsonpath/regex); (3) resultado por step com request/response/headers + pass/fail por assert + valor das variáveis. O risco #1 manda estudar step-ci e hurl antes de fixar o formato — feito aqui. Restrições: `.claude/rules/architecture.md` §1–§2 (engine no core), `.claude/rules/testing.md` §2 (pirâmide), Rule 9 (`parsimony-ladder.md` — não reinventar jsonpath).

## Objective

Decidir o formato do cenário + os modelos de captura/assert do M1 de modo inspecionável, reusando o envelope N-step do M0 sem refactor e sem reinventar jsonpath — com cada decisão lastreada nas referências.

## Coverage Corner 1 — Integration Tests

**Pergunta (Q4):** Como o hurl testa execução de cenário, captura e asserts?

- **Testes unitários inline** (`#[test]` em `pub mod tests`): `.claude/knowledge-base/references/hurl/packages/hurl/src/runner/capture.rs:88` (mod tests), com casos como `test_invalid_xpath` (`:166`); idem em `.claude/knowledge-base/references/hurl/packages/hurl/src/runner/assert.rs` e `.claude/knowledge-base/references/hurl/packages/hurl/src/runner/filter/jsonpath.rs` (todos têm `#[test]`). Padrão: dado uma resposta fixa + uma query/predicado, asserir o `CaptureResult`/`AssertResult`.
- **Testes E2E `.hurl`**: `.claude/knowledge-base/references/hurl/integration/hurl/` contém arquivos `.hurl` que descrevem request + seções `[Captures]`/`[Asserts]` + `HTTP <status>` esperado (ex.: `.../tests_ok_not_linted/empty_section.hurl` mostra o esqueleto `GET url` → `HTTP 200` → `[Captures]` → `[Asserts]` → body). A execução roda o arquivo contra um servidor local e compara.

**Aplicação ao M0/M1 (pirâmide, `testing.md` §2):**
- *Unit:* avaliação de um assert isolado (`evalAssert(source, op, value, response)` → `{pass, expected, actual}`) e captura isolada (`evalCapture(jsonpath, response)` → valor) contra respostas fixas.
- *Integration:* `runScenario` contra um `http.Server` efêmero local (reusando o padrão do M0), asserindo o resultado por step (asserts pass/fail + captures propagadas).

## Coverage Corner 2 — Dependencies

**Pergunta (Q5):** Como cada projeto obtém jsonpath/regex? Implicação para o Hodor.

- **hurl reimplementa jsonpath** num crate próprio: `.claude/knowledge-base/references/hurl/packages/hurl/src/jsonpath/` (`mod.rs` + `ast/` + `parser/` + `eval/`). Faz sentido para um binário Rust standalone (sem ecossistema de libs jsonpath maduras à época / controle total).
- **step-ci delega ao runner externo** `@stepci/runner` (`.claude/knowledge-base/references/step-ci/package.json` → `"@stepci/runner": "^2.0.0"`); o pacote da referência é só o CLI. Logo a lib jsonpath concreta do step-ci NÃO é citável daqui (EC-1).
- **Decisão para o Hodor (TS, Rule 9):** NÃO reimplementar jsonpath (seria reinventar a roda). Usar uma **lib npm madura de jsonpath** — a escolha concreta (`jsonpath-plus` vs `jsonpath`) é **decisão de plan-phase**, fixada no `/to-plan` e CVE-checada no `/deps-audit` (EC-1) — este blueprint não fabrica a citação. Regex usa o `RegExp` nativo do JS (rung 2 da parsimony ladder). zod (já dep do M0) valida o cenário.

## Coverage Corner 3 — Tools

**Pergunta (Q6):** Tooling de formato/validação do cenário.

- **step-ci:** cenário em **YAML**, validado por schema gerado de tipos TS via `typescript-json-schema` (`.claude/knowledge-base/references/step-ci/package.json` → `"typescript-json-schema": "^0.62.0"`) → JSON Schema → ajv. Formato amigável a humano, com interpolação `${{ }}`.
- **hurl:** formato **plain-text `.hurl`** próprio, com **parser custom** em `.claude/knowledge-base/references/hurl/packages/hurl_core/src/ast/mod.rs` (módulos `ast`/`parser`). Conciso, mas exige parser dedicado.
- **Decisão para o Hodor:** o autor do cenário é o **agente** (via MCP), não um humano digitando YAML/`.hurl`. Logo: cenário em **JSON** (o agente emite JSON trivialmente; consistente com o run envelope; diff-amigável com ordenação estável — alinhado a M3; zero dep nova de parser). Validação via **zod** (já dep) — não precisamos de `typescript-json-schema`+ajv (step-ci) nem de parser custom (hurl). YAML fica como possível conveniência de UI no M2.

## Coverage Corner 4 — Techniques

### T1 — Formato declarativo de cenário (Q1)

De `.claude/knowledge-base/references/step-ci/examples/captures.yml` (forma canônica):

```yaml
tests:
  example:
    steps:
      - name: Post a post
        http:
          url: https://${{env.host}}/${{env.resource}}
          method: POST
          json: { title: "...", body: "..." }
          captures:
            id: { jsonpath: $.id }      # captura variável da resposta
          check:
            status: 201                  # assert implícito de status
      - name: Get post by id
        http:
          url: https://${{env.host}}/${{env.resource}}/${{captures.id}}   # usa a variável capturada
          method: GET
          check:
            status: 404
            headers: { Content-Type: "application/json; charset=utf-8" }
            body: "{}"
```

Citações: `captures.yml:1-39` (steps→http→{captures,check}, interpolação `${{captures.id}}`), `.claude/knowledge-base/references/step-ci/examples/conditions.yml` (uso condicional de variáveis). Elementos: **steps ordenados**; cada step tem `request` + `captures` (nome→query jsonpath) + `check`/`asserts`; **interpolação** `${{captures.x}}` para encadear.

### T2 — Captura de variáveis (Q2)

hurl modela captura como **`name = query |> filters`** (`.claude/knowledge-base/references/hurl/packages/hurl_core/src/ast/section.rs:109` — `struct Capture { name, query, filters[] }`). O runner avalia em `.claude/knowledge-base/references/hurl/packages/hurl/src/runner/capture.rs:35` (`eval_capture` → `eval_query` (jsonpath/xpath) → `eval_filters` (regex etc.) → valor nomeado). Filtros: `.claude/knowledge-base/references/hurl/packages/hurl/src/runner/filter/jsonpath.rs`, `.../filter/regex.rs`. A variável capturada entra num **mapa de variáveis** disponível aos próximos steps.

**Aplicação M1:** `captures: { varName: { jsonpath: "$.id" } }` (+ `regex` opcional). `evalCapture(jsonpath, response.body)` via lib jsonpath → valor; armazenar em `variables[varName]`; interpolar em request fields dos steps seguintes (`${{ varName }}` / `{{ varName }}`).

### T3 — Avaliação de asserts (Q3)

hurl: **assert = `query |> filters predicate`** (`.claude/knowledge-base/references/hurl/packages/hurl_core/src/ast/section.rs:123` — `struct Assert { query, filters[], predicate }`). Avaliação em `.claude/knowledge-base/references/hurl/packages/hurl/src/runner/assert.rs` (→ `eval_predicate` em `.claude/knowledge-base/references/hurl/packages/hurl/src/runner/predicate.rs:49`). Tipos de predicado (`predicate.rs:155-202`): `Equal`/`NotEqual`, `GreaterThan(OrEqual)`/`LessThan(OrEqual)`, `StartWith`/`EndWith`, `Contain`/`Include`, `Match` (regex), `Exist`, `IsBoolean`/`IsCollection`/`IsEmpty`/`IsFloat`/`IsDate`. Asserts implícitos de status/version: `.claude/knowledge-base/references/hurl/packages/hurl/src/runner/response.rs:38` (`eval_version_status_asserts`). O resultado é um `AssertResult` com esperado vs obtido (`.../runner/result/`).

**Aplicação M1:** assert = `{ source: "status" | "header:<name>" | "jsonpath:<expr>", op: "equals"|"contains"|"matches"|"exists"|"gt"|"lt"|..., value?: <esperado> }` → `{ pass: bool, expected, actual }`. `check.status` (step-ci) é açúcar para `{source:"status", op:"equals", value:N}`.

## Cross-cutting Comparison

| Dimensão | step-ci | hurl | Decisão M1 (Hodor) |
|---|---|---|---|
| Formato do cenário | YAML (`tests→steps→http`) | plain-text `.hurl` | **JSON** (autor = agente; consistente c/ run; zod valida) |
| Captura | `captures: {x: {jsonpath}}` | `name = query \|> filters` | `captures: {x:{jsonpath}}` (+ regex opcional) |
| Interpolação | `${{captures.x}}` | variáveis no escopo | `${{ x }}` em request fields dos próximos steps |
| Assert | `check: {status,headers,body}` | `query filters predicate` | `asserts:[{source,op,value}]` + `check.status` açúcar |
| jsonpath | runner externo | crate próprio (Rust) | **lib npm madura** (decidida em plan/deps-audit — EC-1) |
| Validação | typescript-json-schema + ajv | parser custom | **zod** (já dep) |
| Resultado | por step | `AssertResult` | RunStep + `asserts[]` + `captures{}` (opcional, aditivo) |
| Teste | examples | unit `#[test]` + `.hurl` E2E | unit (assert/capture) + integração (runScenario vs http local) |

## ADRs

### D1 — Cenário em JSON validado por zod (não YAML+ajv nem parser custom)

**Decision:** o cenário do M1 é um arquivo **JSON** (`scenarios/{slug}.json` ou similar), validado por um **schema zod** no core (como `loadRun` valida o envelope no M0).

**Rationale:** o autor é o agente via MCP (emite JSON trivialmente), não um humano digitando YAML; JSON é consistente com o run envelope e diff-amigável (alinha M3); zod já é dependência (Rule 9 — não adicionar yaml/ajv/parser). step-ci (YAML+typescript-json-schema) e hurl (parser custom) resolvem para autores humanos — não é o nosso caso no M1.

**Alternatives considered:** YAML como step-ci (rejeitado M1 — exige dep de parser yaml + é conveniência de humano; pode voltar como UI no M2); `.hurl` plain-text + parser custom como hurl (rejeitado — reinventa parser, Rule 9).

**Consequences:** YAML/UI-authoring fica para M2; o schema do cenário é a fonte única do formato.

### D2 — Captura via jsonpath (lib npm) + regex nativo; modelo `name = query (|> regex)`

**Decision:** captura = `{ varName: { jsonpath: "$.path", regex?: "..." } }`, avaliada por uma lib npm de jsonpath (escolhida no plan/deps-audit) + `RegExp` nativo; o valor entra num mapa `variables` propagado por interpolação `${{ varName }}` aos próximos steps.

**Rationale:** espelha o pipeline `query |> filters` do hurl (`capture.rs`), mas em TS reusando ecossistema (Rule 9 / `parsimony-ladder` rung 2-4). Interpolação `${{ }}` é o padrão do step-ci, familiar.

**Alternatives considered:** reimplementar jsonpath (rejeitado — Rule 9); só regex sem jsonpath (rejeitado — jsonpath é o caso dominante para body JSON).

**Consequences:** a engine depende de 1 lib jsonpath; a escolha concreta é gate de deps-audit (EC-1).

### D3 — Assert model = `{source, op, value}` → `{pass, expected, actual}`; status como açúcar

**Decision:** assert = `{ source: status|header:<name>|jsonpath:<expr>, op: equals|notEquals|contains|matches|exists|gt|gte|lt|lte|..., value? }`, avaliado para `{ pass, expected, actual }`. `check.status: N` é açúcar para `{source:"status", op:"equals", value:N}`.

**Rationale:** subconjunto dos predicados do hurl (`predicate.rs`) suficiente para status/headers/body — sem copiar a superfície inteira (EC-2/YAGNI). `expected/actual` no resultado torna a falha inspecionável (alinha M2/M3).

**Alternatives considered:** portar todos os predicados do hurl (rejeitado — YAGNI no M1); asserts só de status (rejeitado — DoD exige headers e body via jsonpath/regex).

**Consequences:** novos ops são adições (OCP); o resultado por assert é estável para render.

### D4 — Reusar o envelope do M0; estender RunStep com `asserts`/`captures` OPCIONAIS (sem migração)

**Decision:** o resultado do cenário continua sendo o envelope `{schemaVersion, runId, createdAt, steps[]}` do M0; cada `RunStep` ganha campos **opcionais** `asserts: [{source,op,value,pass,expected,actual}]` e `captures: { name: value }`. **Mantém `schemaVersion: 1`** (campos opcionais aditivos = backward-compatible; runs M0 sem esses campos seguem válidos). Bump de versão fica reservado a mudança breaking futura.

**Rationale:** o M0 (ADR D3) desenhou o envelope N-step para isto — reuso sem refactor (sem re-trabalho). Campos opcionais aditivos não quebram `loadRun` nem runs antigos (KISS — evita union de versões/migração agora; YAGNI). `architecture.md` §6: a 2ª forma concreta (multi-step) é conhecida, mas a extensão é aditiva, então não precisa de bump especulativo.

**Alternatives considered:** `schemaVersion: 2` + migração (rejeitado M1 — complexidade de migração sem ganho; aditivo-opcional basta); novo formato de run separado (rejeitado — viola D3 do M0).

**Consequences:** `RunStep` schema ganha `.optional()` em `asserts`/`captures`; o render do M0 (que itera steps) já suporta — só passa a exibir asserts/captures quando presentes.

### D5 — Engine no core; nova tool MCP `run_scenario`

**Decision:** `src/core/scenario.ts` (schema zod do cenário) + `src/core/runScenario.ts` (engine: itera steps, interpola variáveis, chama `executeRequest` do M0, avalia asserts, acumula captures) — domínio puro. Adaptador MCP ganha tool `run_scenario`; o web render exibe asserts/captures por step.

**Rationale:** `architecture.md` §1–§2 — a engine é domínio, não transporte; reusa `executeRequest` do M0 (DIP mantido). Mantém o risco #2 do M0 mitigado.

**Alternatives considered:** engine no adaptador MCP (rejeitado — acopla, impede reuso pelo web e teste isolado).

**Consequences:** `run_scenario` é caller de produção da engine (wiring pillar a); a engine é unit-testável sem MCP/stdio.

## Recommendations

1. **(Q1/T1/D1)** Definir schema zod `ScenarioSchema = { schemaVersion:1, name, steps:[{ name, request:{method,url,headers?,body?}, captures?:{[k]:{jsonpath:string, regex?:string}}, asserts?:[{source,op,value?}] }] }`. Cenário em JSON, validado no load (como `loadRun`).
2. **(Q2/T2/D2)** `evalCapture(spec, response)` via lib jsonpath npm + RegExp; acumular em `variables`; interpolar `${{ var }}` em `url/headers/body` dos próximos steps (`interpolate(template, variables)`).
3. **(Q3/T3/D3)** `evalAssert(assert, response)` → `{pass, expected, actual}`; ops mínimos: `equals, notEquals, contains, matches, exists, gt, gte, lt, lte`. `source`: `status`, `header:<name>`, `jsonpath:<expr>`.
4. **(Q4)** Testes: unit de `evalAssert`/`evalCapture`/`interpolate` (puros, contra respostas fixas); integração de `runScenario` contra `http.Server` efêmero (cenário 2-step com captura encadeada + asserts pass e fail).
5. **(Q5/EC-1)** Escolher a lib jsonpath no `/to-plan` + `/deps-audit` (candidatos: `jsonpath-plus`, `jsonpath`); NÃO reimplementar.
6. **(Q6/D1)** Validação por zod; sem `typescript-json-schema`/ajv/parser custom.
7. **(D4)** Estender `RunStep` com `asserts`/`captures` opcionais, `schemaVersion:1` mantido; `runScenario` produz o envelope via `buildRunEnvelope` (reuso M0).
8. **(D5)** `src/core/{scenario,runScenario}.ts` + tool MCP `run_scenario` + render de asserts/captures por step.

## Blocked questions (if any)

Nenhuma — as 6 perguntas respondidas com citações verificadas; a lib jsonpath concreta é decisão de plan-phase (EC-1), não pergunta bloqueada.
