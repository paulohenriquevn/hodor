# Discovery Plan: M1 — Modelo de cenário multi-step + asserções (formato declarativo, captura de variáveis, avaliação de asserts)

> **Version 1.1** (absorveu checkpoint EC-1 + DOCUMENT EC-2/EC-3 de `knowledge-base/reviews/m1-scenario-model-edge-cases-2026-06-18.md`) — Esta descoberta investiga, sobre `step-ci` e `hurl`, **como** desenhar o cenário multi-step do M1 do Hodor antes de fixar o formato (mitigando o risco #1 do ROADMAP: não reinventar uma DSL quando Step CI/Hurl já mostram designs maduros). O blueprint resultante deve fixar três decisões: (a) o **formato declarativo do cenário** (steps ordenados, cada step = request + captures + asserts; interpolação de variáveis capturadas em steps seguintes); (b) o **mecanismo de captura de variáveis** (jsonpath/regex sobre a resposta) e sua propagação; (c) o **modelo de avaliação de asserts** (status/headers/body via jsonpath/regex) e como o resultado por step registra request/response/headers + pass/fail por assert + valor das variáveis capturadas. Reusa o core do M0 (envelope `{schemaVersion, steps[]}`) — o cenário é o INPUT declarativo, o run é o OUTPUT já N-step.

**Slug:** `m1-scenario-model`
**Owner:** paulohenriquevn
**Created:** 2026-06-18
**Time budget:** 6h (per-project breakdown in ADR D1)

## Context

Disparado pelo início do milestone **M1 — Modelo de cenário multi-step + asserções** (`ROADMAP.md` §M1; depende de M0, entregue em v0.1.0). O ROADMAP declara o risco #1 desta fase: *"Reinventar uma DSL de cenário quando Step CI/Hurl já mostram designs maduros — mitigar estudando ambos em `knowledge-base/references/` antes de fixar o formato."* Esta descoberta existe exatamente para isso.

O M0 já entregou o **core** (`src/core/`): `executeRequest` (captura request/response/headers), envelope versionado `{schemaVersion:1, runId, createdAt, steps[]}`, `persistRun`/`loadRun` (ver `knowledge-base/discoveries/blueprints/m0-walking-skeleton-blueprint.md`, ADR D3). M1 ESTENDE isso: um cenário declarativo (input) executado step-a-step, propagando variáveis capturadas e avaliando asserts; cada step do run (output) ganha `asserts[]` (pass/fail) e `captures{}`.

Regras do projeto que qualquer padrão emprestado DEVE respeitar:
- `rules/architecture.md` §1–§2 — a engine de cenário e a avaliação de asserts/captura ficam no **core** (domínio puro); MCP/web continuam adaptadores. O cenário é dado, não comportamento de transporte.
- `rules/testing.md` §2 — engine e asserts têm testes unitários; execução de cenário ponta-a-ponta tem teste de integração.
- `rules/parsimony-ladder.md` — preferir lib madura de jsonpath a reimplementar (Rule 9).

## Objective

Permitir decidir, com evidência citada, **o formato do cenário + o modelo de captura/assert do M1** de modo que (a) seja inspecionável e diff-amigável (alinhado a M3), (b) reuse o envelope N-step do M0 sem refactor, (c) não reinvente jsonpath/asserts. Critérios mensuráveis para o blueprint:

- [ ] Todas as research questions respondidas com citações a `knowledge-base/references/`
- [ ] Tabela comparativa step-ci × hurl populada (formato, captura, assert, validação)
- [ ] Recommendations com ≥1 proposta concreta por research question (incl. shape do arquivo de cenário e do resultado por step)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `knowledge-base/references/step-ci/` | `examples/`, `package.json` | Formato declarativo YAML de cenário (steps/captures/check) + interpolação de variáveis + tooling de validação de schema |
| `knowledge-base/references/hurl/` | `packages/hurl/src/runner/` (capture, assert, predicate, response, filter), `packages/hurl/src/jsonpath/`, `packages/hurl_core/src/ast/`, `integration/` | Engine madura: captura via query+filtros, avaliação de predicados/asserts, jsonpath, testes E2E `.hurl` |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `knowledge-base/references/hurl/packages/hurlfmt/`, `hurl/contrib/`, `hurl/bin/` | Formatter e empacotamento — fora do escopo da engine/formato |
| `knowledge-base/references/hurl/packages/hurl/src/http/`, `cli/`, `report/`, `html/` | Cliente HTTP (já temos `fetch` do M0), CLI/relatórios — não tocam o modelo de cenário |
| `knowledge-base/references/step-ci/src/` (CLI thin) | A engine real do step-ci é o pacote externo `@stepci/runner` (NÃO vendorizado aqui) — só o formato (examples) e o manifest são fonte local |
| `knowledge-base/references/{bruno,hoppscotch,keploy,schemathesis,mcp-typescript-sdk}/` | bruno/hoppscotch/mcp serviram M0; keploy=M5 (normalização), schemathesis=M4 (geração) — descobertas futuras |
| `knowledge-base/references/*/` build artifacts (`dist/`, `node_modules/`, `target/`) | Build artifacts |
| Qualquer projeto NÃO clonado em `knowledge-base/references/` | Cross-Project Rule |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** hurl: 4h; step-ci: 2h.

**Rationale:** hurl é a fonte de engine madura (captura+assert+jsonpath em código auditável local) — maior orçamento. step-ci contribui o FORMATO declarativo (examples) e a estratégia de validação de schema; 2h bastam (sua engine não está vendorizada).

**Alternatives considered:** split igual — rejeitado porque a engine do step-ci não é local; deep-dive só no hurl — rejeitado porque o formato YAML do step-ci é o design de DSL mais próximo da nossa tese (inspecionável por humano).

**Stop condition — per question (mandatory):** Quando a Fase A de uma pergunta retorna vazio após 3 retries com variantes de query, marcar BLOCKED com motivo "Fase A exhausted" e seguir. Não preencher com hotspots de outra pergunta.

**Stop condition — per project (mandatory):** Quando o orçamento de um projeto esgota com perguntas pendentes, marcá-las BLOCKED ("budget exhausted") e seguir. Se todo projeto restante estiver assim, emitir `<promise>BLUEPRINT_BLOCKED</promise>` com relatório honesto. Nunca `BLUEPRINT_COMPLETE` com perguntas bloqueadas.

**Anti-pattern:** NUNCA fabricar respostas de Fase B para fechar pergunta cuja Fase A esgotou (Regra 3).

**Consequences:** o halt-loop pára num projeto quando o orçamento esgota; perguntas bloqueadas viram seed da próxima descoberta.

### D2 — Investigation depth

**Decision:** Ler end-to-end os arquivos pequenos e densos (examples YAML do step-ci; `capture.rs`, `assert.rs`, `predicate.rs`, `response.rs`, `ast/section.rs`); para o jsonpath crate (grande), mapear a interface pública (mod.rs) e ler só `eval/` o suficiente para entender o contrato, sem auditar o parser inteiro.

**Rationale:** os exemplos e os arquivos de runner são a fonte de design direta; o parser jsonpath interno do hurl é detalhe de implementação (vamos usar uma lib TS, não portar o parser).

**Consequences:** trade-off explícito — profundidade no modelo/contrato, superfície no parser jsonpath.

### D3 — Cenário é INPUT declarativo; reusa o envelope de run N-step do M0 (anti-refactor)

**Decision:** o cenário (arquivo declarativo) é a ENTRADA; o resultado de execução continua sendo o envelope `{schemaVersion, steps[]}` do M0, com cada step ESTENDIDO por `asserts[]` e `captures{}`. A investigação trata "como estender o step do envelope" e "qual o shape do arquivo de cenário", não "criar um novo formato de run".

**Rationale:** o M0 (ADR D3) desenhou o envelope N-step justamente para M1. Reusar evita refactor (sem re-trabalho); `schemaVersion` permite bump se o step ganhar campos. Mitiga o risco #1 (não reinventar) e o risco #2 do M0 (não acoplar).

**Consequences:** o blueprint deve recomendar (a) um schema de arquivo de cenário e (b) a extensão do `RunStep` com `asserts`/`captures` — possivelmente `schemaVersion: 2`.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Qual o **formato declarativo de cenário** do step-ci — steps ordenados, `captures` (jsonpath), `check` (status/headers/body), e a sintaxe de interpolação de variáveis capturadas (`${{captures.x}}`)? | techniques | `knowledge-base/references/step-ci/examples/captures.yml`, `knowledge-base/references/step-ci/examples/conditions.yml` | SKIP Fase A (YAML text-shape). Glob `examples/*.yml` e selecionar os que têm `captures`/`check` | Ler `captures.yml` e `conditions.yml` end-to-end; mapear o shape do step e a interpolação | Esqueleto comentado do cenário (tests→steps→http→{captures,check}) + sintaxe de variáveis, com `path:line` |
| Q2 | Como o hurl **captura variáveis** da resposta — `eval_capture` via query (jsonpath/xpath) + cadeia de filtros (regex etc.) — e como a variável fica disponível para steps seguintes? | techniques | `knowledge-base/references/hurl/packages/hurl/src/runner/capture.rs`, `knowledge-base/references/hurl/packages/hurl/src/runner/filter/jsonpath.rs`, `knowledge-base/references/hurl/packages/hurl/src/runner/filter/regex.rs` | `ast-grep run -p 'pub fn eval_capture($$$) { $$$ }' --lang rust knowledge-base/references/hurl/packages/hurl/src/runner/` ; fallback Grep `eval_capture\|eval_query\|eval_filters` | Ler `capture.rs` (fluxo query→filtros→valor nomeado), e os filtros `jsonpath.rs`/`regex.rs` (contrato) | Descrição do pipeline de captura (query → filtros → nome→valor) + como entra no escopo de variáveis, com citações |
| Q3 | Como o hurl **avalia asserts** — predicados explícitos (`assert.rs`/`predicate.rs`) e asserts implícitos de status/version (`response.rs`) — e qual o shape do `AssertResult` (pass/fail + esperado/obtido)? | techniques | `knowledge-base/references/hurl/packages/hurl/src/runner/assert.rs`, `knowledge-base/references/hurl/packages/hurl/src/runner/predicate.rs`, `knowledge-base/references/hurl/packages/hurl/src/runner/response.rs`, `knowledge-base/references/hurl/packages/hurl_core/src/ast/section.rs` | `ast-grep run -p 'pub fn eval_predicate($$$) { $$$ }' --lang rust knowledge-base/references/hurl/packages/hurl/src/runner/` ; fallback Grep `eval_assert\|eval_predicate\|AssertResult` | Ler `assert.rs` + `predicate.rs` (tipos de predicado, resultado), `response.rs` (asserts implícitos status/headers), `ast/section.rs` (structs `Capture`/`Assert`) | Tabela tipo-de-assert → como avalia → shape do resultado (pass/fail, expected, actual), com citações |
| Q4 | Como o hurl **testa** execução de cenário, captura e asserts — testes unitários inline (`#[test]`) + testes E2E `.hurl` em `integration/`? | tests | `knowledge-base/references/hurl/packages/hurl/src/runner/capture.rs`, `knowledge-base/references/hurl/packages/hurl/src/runner/assert.rs`, `knowledge-base/references/hurl/integration/` | `ast-grep run -p '#[test] fn $NAME() { $$$ }' --lang rust knowledge-base/references/hurl/packages/hurl/src/runner/` ; Glob `integration/**/*.hurl` | Ler 1–2 blocos `mod tests` de `capture.rs`/`assert.rs` + 1 arquivo `.hurl` de integração (estrutura request+asserts+captures) | Como mockam/asseguram captura e assert (unit) + formato do teste E2E `.hurl`, com citações; nota unit vs integration |
| Q5 | Como cada projeto **obtém jsonpath/regex** — hurl reimplementa (`src/jsonpath/` próprio) vs step-ci delega ao runner externo? Qual a implicação para o Hodor (lib npm de jsonpath vs roll-our-own)? | deps | `knowledge-base/references/hurl/packages/hurl/src/jsonpath/mod.rs`, `knowledge-base/references/step-ci/package.json` | SKIP Fase A (text-shape). Read direto do `mod.rs` (interface pública) e do `package.json` | Ler a interface pública do crate jsonpath do hurl; ler deps do step-ci (`@stepci/runner`, `typescript-json-schema`) | Comparação: hurl=jsonpath próprio (Rust) vs step-ci=runner externo; recomendação de lib jsonpath npm para o Hodor (Rule 9), com citações |
| Q6 | Qual o **tooling de formato/validação do cenário** — step-ci (YAML + `typescript-json-schema` → JSON Schema → ajv) vs hurl (parser custom em `hurl_core`)? Qual serve melhor um cenário inspecionável + validável no Hodor? | tools | `knowledge-base/references/step-ci/package.json`, `knowledge-base/references/hurl/packages/hurl_core/src/ast/mod.rs` | SKIP Fase A. Read do `package.json` (typescript-json-schema) e do `ast/mod.rs` (módulos do parser) | Ler como step-ci gera schema a partir de tipos TS; ler a organização do AST do hurl | Tabela formato→parsing→validação (YAML+JSON-Schema vs parser custom) + recomendação para o Hodor (TS), com citações |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q5 | Covered |
| Tools | Q6 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Todo `knowledge-base/references/{project}/{path}` declarado na Fase A existe | Marcar Qx BLOCKED "path not found", seguir |
| Per-question Fase A budget | Fase A retornou ≥1 hotspot OU 3 retries de variante | Após 3 retries vazios, BLOCKED "Fase A exhausted"; seguir |
| Q2/Q3 leitura do jsonpath | Ler só a interface pública (`jsonpath/mod.rs`) + o suficiente de `eval/` — NÃO auditar o parser inteiro (D2) | Parar após entender o contrato; marcar parser interno fora de escopo |
| [EC-1] Q5 lib npm jsonpath | A escolha da lib npm de jsonpath é decisão de PLAN-phase (fixada no `/to-plan`, CVE-checada no `/deps-audit`), NÃO citação de referência (step-ci runner não vendorizado) | Citar só o crate próprio do hurl como evidência de "own-impl vs lib"; nunca fabricar "step-ci usa lib X" |
| After answering Qx | Seção do blueprint sob Qx tem ≥1 citação | Re-iterar Qx (máx 1 retry) |
| Per-project time budget | Orçamento do projeto não esgotado | Ao esgotar, BLOCKED "budget exhausted" para Qx restantes; avançar |
| Before promising complete | As 4 corners populadas E D3 (extensão do RunStep + shape do cenário) tem recomendação concreta | Recusar promise, continuar iterando |

## Acceptance Criteria

- [ ] Todas as research questions respondidas OU BLOCKED com motivo
- [ ] As quatro corners têm seção populada no blueprint
- [ ] Toda citação aponta para `knowledge-base/references/{...}` real
- [ ] ≥1 ADR no blueprint sintetiza as decisões (shape do cenário + extensão do RunStep + lib jsonpath)
- [ ] Time budget respeitado por projeto
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint salvo em `knowledge-base/discoveries/blueprints/m1-scenario-model-blueprint.md`

## Global Definition of Done

- [ ] Todas as fases completas (plan → edge-cases → execute → confidence → improve se preciso → re-score)
- [ ] Verdict final de `/discover-confidence` registrado no header do blueprint
- [ ] Sem citações fabricadas
- [ ] Coverage Matrix 100%
- [ ] ADRs referenciam ≥1 princípio das regras (`architecture.md` §1–§2; `testing.md` §2; Rule 9 / `parsimony-ladder.md`)
