# Blueprint: M4 — Geração de cenários assistida pelo agente

> Discovery executada sobre `schemathesis` (geração ancorada em spec + checks default), `keploy` (proveniência/estado de testcase gravado + promoção curada), `bruno`/`hurl` (parsing de curl + OpenAPI→request) e o `mcp-typescript-sdk` (sampling vs tool-embute-LLM) para decidir, ANTES de codar, a divisão de tools MCP, os campos de proveniência, onde persistir o draft e os asserts default gerados — sempre com o humano no gate (risco #1) e sem depender só de OpenAPI (risco #2). Mínimo 2 referências independentes (schemathesis + keploy + bruno/hurl). Plano sugerido: `.claude/knowledge-base/discoveries/plans/m4-scenario-generation-plan.md` (a criar via `/discover-plan`).

## Context

M4 (`ROADMAP.md` §M4 `:162`, depende de M1/M2/M3) pede: (1) tool(s) MCP que, dado um endpoint (ou OpenAPI/curl de exemplo), o AGENTE gera um cenário candidato (steps + asserts) como rascunho **não-aprovado**; (2) cenários gerados entram no mesmo fluxo de revisão M2/M3 marcados "gerado pelo agente, pendente de revisão"; (3) o humano edita/refina antes de aprovar. Riscos declarados (`ROADMAP.md:176-177`): (#1) cenários ruins gerando ruído de revisão — manter humano no gate, **nunca auto-aprovar**; (#2) não depender só de OpenAPI — suportar exemplos reais (curl/traffic).

**Baseline (o que já existe, M0-M3):**
- `src/core/scenarioSchema.ts:50` — `ScenarioSchema = {schemaVersion: z.literal(1), name, steps[].min(1)}`; `ScenarioStepSchema:38` = `{name, request:{method,url,headers?,body?}, captures?, asserts?[]}`; `AssertSpecSchema:21` = `{source: string ("status"|"header:x"|"jsonpath:expr"), op: enum, value?}`.
- `src/mcp/server.ts:34` (`run_request`) e `:73` (`run_scenario`): padrão `registerTool` com `inputSchema` zod + `outputSchema=RunEnvelopeSchema.shape`, métrica em `console.error` (stderr), delega 100% ao core (`:52`, `:83`).
- `src/core/verdict.ts:10` — `VerdictSchema = {runId, verdict: enum["approved","rejected"], note?, decidedAt}`; gravado em `verdicts/{runId}.json` (efêmero).
- `src/core/reviewArtifact.ts:29` — `ReviewArtifactSchema = {artifactVersion: z.literal(1), scenarioName?, runId, createdAt, verdict, steps[normalizado]}` em `reviews/{runId}.json` (commitável); `buildReviewArtifact(env, verdict)` `:46`.
- `src/web/server.ts:119` — `POST /runs/:id/verdict` é o caller de produção que grava verdict + artefato de review.

Restrições: `architecture.md` §1–§2 (lógica no core, MCP/web são adaptadores); `parsimony-ladder.md` (stdlib/dep-já-instalada antes de novo código; JSON nativo).

## Objective

Decidir a **divisão de responsabilidades** (o que a tool MCP faz vs o que o agente faz), os **campos de proveniência aditivos** (`origin`/`reviewState`, backward-compat como `name` foi no M2), **onde persistir o draft commitável**, **se há parser de curl** e **quais asserts default** o scaffold/agente gera — de modo que cenários gerados sejam rascunhos rastreáveis que passam pelo gate humano de M2/M3 sem nunca auto-aprovar.

## Coverage Corner 1 — Integration Tests

**Pergunta (Q-IT):** Como as referências testam a fronteira "exemplo → request estruturado" e o gate de promoção, e o que isso prescreve para os testes de integração do M4?

- **schemathesis** testa que a geração é **derivada da spec** — o `APIOperation` (`.claude/knowledge-base/references/schemathesis/src/schemathesis/schemas.py:710` `"An API operation (e.g., GET /users)"`) carrega `path:str` (`:716`), `method` (`:717`) e os parâmetros roteados por `location` em containers tipados (`path_parameters`/`headers`/`cookies`/`query`/`body`, `:725-729`). As operações só vêm de iterar o schema parseado (`get_all_operations`, `specs/openapi/schemas.py:459`) — nunca inventadas. **Lição de grounding:** o teste prova que um request só existe se a operação existe na spec; um cenário gerado a partir de OpenAPI deve mapear 1:1 a uma operação real.
- **keploy** testa a **promoção curada** (não auto-promoção): em `normalise.go:155-158`, uma falha `High`-risk NÃO é promovida sem `--allow-high-risk` (`"please confirm ... and then run with --allow-high-risk"`); a seleção é explícita via `config.Normalize.SelectedTests` (`normalise.go:130-138`). O gate humano é uma **operação** com guarda, não um flag silencioso.

**Aplicação ao Hodor (testing.md §2/§6 — integração na fronteira):**
- `scaffold_from_curl_produces_validated_draft_scenario` — dado um curl real, o scaffold determinístico emite um `Scenario` que passa por `ScenarioSchema.parse` (fronteira zod) e NÃO tem `reviewState: approved`.
- `scaffold_from_openapi_maps_one_operation_to_one_step` — dada uma operação OpenAPI (path+method+param), o scaffold emite exatamente um step com aquele method/url/headers; uma operação inexistente → erro de fronteira (grounding — espelha schemathesis).
- `generated_draft_never_enters_reviews_until_human_verdict` — o draft persistido em `drafts/` NÃO produz `reviews/{id}.json`; só `POST /runs/:id/verdict` (M2/M3) o faz. Prova o risco #1 (nunca auto-aprova).
- `draft_round_trip_preserves_provenance` — `origin: "agent-generated"` + `reviewState: "draft"` sobrevivem ao save/load (espelha o `LastUpdated{Author,Timestamp}` do keploy como audit trail).

## Coverage Corner 2 — Dependencies

**Pergunta (Q-DEP):** Precisamos de lib nova (parser de curl, parser de OpenAPI, LLM no servidor)? O que as referências usam e o que o Hodor deve fazer?

- **Parser de curl:** bruno **não escreve um lexer próprio** — delega a tokenização ao `shell-quote` (`.claude/knowledge-base/references/bruno/packages/bruno-app/src/utils/curl/parse-curl.js:3` `import { parse } from 'shell-quote'`) e usa uma **tabela declarativa flag→categoria** (`FLAG_CATEGORIES`, `:11`: `'header': ['-H','--header']`, `'data': ['-d','--data',...]`, `'method': ['-X','--request']`, `'form': ['-F','--form']`) + máquina de estados (`buildRequest`, `:57`). hurl usa abordagem distinta: **modela a gramática do curl como `clap`** (`.claude/knowledge-base/references/hurl/packages/hurlfmt/src/curl/mod.rs:64-95`) e lê os matches.
- **OpenAPI→request:** bruno itera `paths` filtrando os 8 métodos HTTP (`.claude/knowledge-base/references/bruno/packages/bruno-converters/src/openapi/openapi-to-bruno.js:854`) e mapeia cada operação em `{method, url, params, headers, body}` (`transformOpenapiRequestItem`, `:161`; `method: request.method.toUpperCase()` `:201`; templating `{id}`→`:id` `:869`).
- **LLM no servidor:** o `mcp-typescript-sdk` expõe `sampling/createMessage` no SERVER (`.claude/knowledge-base/references/mcp-typescript-sdk/packages/server/src/server/server.ts:435` / `:230`) — i.e. o servidor PODE pedir ao LLM do cliente para gerar. Mas no Hodor o cliente MCP **já é o Claude** (o agente). Pedir sampling de volta seria um round-trip redundante.

**Decisão Hodor (Rule 9 / parsimony rungs 1-4):**
- **NÃO embutir LLM na tool** (rung 1 — não precisa existir): o agente (Claude) já é o gerador; a tool não chama `createMessage` de volta. Isso elimina dep + a complexidade de sampling.
- **Parser de curl:** escopo MÍNIMO determinístico (`-X`, `-H`, `-d/--data`, URL posicional) reusando o conceito da tabela bruno; a tokenização de aspas/escapes é o único ponto delicado — usar `shell-quote` (dep pequena, MIT, battle-tested em bruno) em vez de hand-rolling regex de quoting (rung 2/4). Avaliar via `/deps-audit` antes de adicionar.
- **OpenAPI:** **NÃO** adicionar um parser de OpenAPI completo no M4 (YAGNI — risco #2 diz "suportar exemplos reais, não SÓ OpenAPI"). O agente lê a spec (ele tem o texto) e monta os steps; a tool apenas valida/persiste. Um scaffold OpenAPI→Step determinístico fica como item opcional/M-futuro.
- **zod** (já dep) valida o draft na fronteira; nenhuma dep de validação nova.

## Coverage Corner 3 — Tools

**Pergunta (Q-TOOL):** Quantas tools MCP, com que contrato, e onde persiste o draft?

- **schemathesis** separa **modelo** (`APIOperation`) de **checks** (registro `CHECKS` via `@schemathesis.check`, `.claude/knowledge-base/references/schemathesis/src/schemathesis/checks.py:105`): a geração produz a estrutura; os asserts são um conjunto default plugável.
- **keploy** separa **artefato** (`TestCase`, versionado por `Version` string `apiVersion`-style, `.claude/knowledge-base/references/keploy/pkg/models/testcase.go:43`) do **estado de execução** (`TestStatus` enum em `TestResult`, `pkg/models/testrun.go:331-340`: `PENDING/RUNNING/FAILED/PASSED/IGNORED/OBSOLETE`) — o estado de lifecycle NÃO mora no artefato; é uma operação (`normalize`) que estampa `LastUpdated{Author,Timestamp}` (`testcase.go:37-40`).
- **step-ci** expõe a geração como **comando com toggles** (`generate [spec]`, `.claude/knowledge-base/references/step-ci/src/index.ts:111`; toggles `generatePathParams/generateRequestBody/useExampleValues` + checks `checkStatus/checkSchema` `:123-131`) — a geração tem knobs explícitos.

**Decisão Hodor (KISS — 1 tool de persistência + 1 helper determinístico):**
- **Tool A — `save_scenario_draft` (a persistência + validação, NÃO gera nada):** recebe um `Scenario` que o agente montou + proveniência (`origin`, `sourceKind`, `sourceRef?`), valida com `ScenarioSchema.parse` + os campos de proveniência aditivos, e persiste como DRAFT em `drafts/{draftId}.json`. **Nunca executa, nunca aprova.** Espelha a separação keploy (artefato gravado ≠ aprovado).
- **Tool B — `scaffold_request_from_curl` (helper DETERMINÍSTICO, opcional):** recebe uma string curl, retorna um `ScenarioStep` esqueleto (`{name, request:{method,url,headers,body}}`) para ANCORAR a geração do agente (evita o agente errar a estrutura do request). Espelha o `parse-curl.js` do bruno. NÃO gera asserts nem persiste — só faz scaffold de UM step. (O agente pode então enriquecer com captures/asserts e chamar `save_scenario_draft`.)
- **Persistência do draft:** novo diretório **`drafts/`** commitável (1 arquivo por draft), separado de `scenarios/`/`reviews/`. O draft é um `Scenario` + proveniência, NÃO um run (ainda não foi executado). Justificativa: keploy guarda o artefato gravado separado do resultado; o draft do Hodor é a "entrada candidata" antes da execução/review.

## Coverage Corner 4 — Techniques

### T1 — Geração ancorada na fonte (Q-grounding, risco #2)

schemathesis nunca inventa endpoints — toda operação vem do schema parseado (`get_all_operations`, `specs/openapi/schemas.py:459`; loaders constroem `OpenApiSchema(raw_schema=...)` em `openapi/loaders.py:238` e validam a versão antes de tudo `:225-235`). O `APIOperation` roteia parâmetros por `location` real (`schemas.py:777-784` — só aceita parâmetro cujo location resolve a um container).

**Aplicação ao Hodor:** o agente gera o cenário a partir de uma FONTE concreta (curl colado, OpenAPI fornecido, traffic de exemplo) — nunca de memória. A tool `scaffold_request_from_curl` ancora o request real; para OpenAPI o agente cita a operação. O campo de proveniência `sourceKind: "curl"|"openapi"|"endpoint"|"traffic"` + `sourceRef?` registra de ONDE veio (transparência — alinha o risco #1 e o que M5 exige). Suportar curl/endpoint (não só OpenAPI) mitiga o risco #2 diretamente.

### T2 — Asserts default gerados (Q-asserts)

schemathesis aplica um conjunto de checks default plugáveis, dos quais os **deriváveis sem stateful** mapeiam para o Hodor:
- `not_a_server_error` (`checks.py:135`) — status NÃO é 5xx.
- `status_code_conformance` (`specs/openapi/checks.py:105`) — status ∈ documentados (`response.status_code not in allowed_status_codes` → falha `:111`).
- `content_type_conformance` (`:132`) — Content-Type ∈ documentados.
- `response_schema_conformance` (`:263`) — body valida contra o schema da resposta.

**Aplicação ao Hodor (mapeando para o `AssertSpec` existente, `scenarioSchema.ts:21`):** o agente/scaffold gera asserts default a partir do que o `AssertSpec` já suporta:
- **Sempre:** `{source:"status", op:"lt", value:500}` (≈ `not_a_server_error`) OU `{source:"status", op:"equals", value:200}` quando a fonte declara o status esperado (OpenAPI → o status documentado; curl → o agente infere ou deixa um TODO para o humano).
- **Quando a fonte declara Content-Type:** `{source:"header:content-type", op:"contains", value:"application/json"}` (≈ `content_type_conformance`).
- **Quando há corpo JSON conhecido:** `{source:"jsonpath:$.<campo>", op:"exists"}` para campos-chave (≈ `response_schema_conformance`, versão leve — o Hodor não tem validador de JSON Schema no M4).

O conjunto default é **conservador e revisável** — o ponto é dar um ponto de partida, não acertar tudo; o humano refina (risco #1).

### T3 — Proveniência aditiva + estado de revisão (Q-proveniência, risco #1)

keploy NÃO modela "gravado vs importado vs autorado" no artefato (lição negativa: `testcase.go` não tem campo `origin` — um teste importado é indistinguível, `import.go:373-374` usa a mesma struct). O que keploy oferece como padrão: separar **artefato** de **estado de lifecycle**, e usar `LastUpdated{Author,Timestamp}` (`testcase.go:37-40`) como audit trail estampado na promoção.

**Aplicação ao Hodor (preencher a lacuna que o keploy tem):** adicionar proveniência **explícita e aditiva** (backward-compat, como `name` entrou no envelope no M2):
- No `Scenario` (e propagado ao draft): campo OPCIONAL `provenance?: { origin: "agent-generated"|"human-authored", sourceKind: "curl"|"openapi"|"endpoint"|"traffic", sourceRef?: string, generatedAt: string }`. Opcional ⇒ cenários M1 existentes continuam válidos (`schemaVersion` permanece `1`).
- Estado de revisão `reviewState: "draft"|"approved"` — porém, alinhado ao keploy, o estado de aprovação **NÃO precisa morar no Scenario**: a aprovação já é o `Verdict` (M2) + o `reviews/{id}.json` (M3). Um draft é "pendente" enquanto NÃO existe `reviews/{runId}.json` para sua execução. `reviewState` no draft serve só ao rótulo da UI ("gerado pelo agente, pendente"), default `"draft"`.

### T4 — Scaffold de curl determinístico (Q-parser-curl)

bruno: `FLAG_CATEGORIES` (`parse-curl.js:11`) + máquina de estados (`buildRequest:57`, dispatch `valueHandlers:177`, header split `value.split(/:\s*(.+)/)` `:199`); tokenização via `shell-quote`. hurl: modela curl como `clap` (`hurlfmt/src/curl/mod.rs:64`; default `GET`, ou `POST` se há `--data`, `matches.rs:37-41`).

**Aplicação ao Hodor:** `core/parseCurl.ts` — `parseCurl(cmd: string): ScenarioStep["request"]` reusando o CONCEITO bruno (tabela flag→categoria mínima: `-X`→method, `-H`→header, `-d`/`--data`→body, posicional→url; default method `GET` ou `POST`-se-data como hurl). Tokenização via `shell-quote` (dep pequena) ou, se `/deps-audit` reprovar, um split mínimo. Determinístico, testável, sem LLM. É o scaffold da Tool B.

## Cross-cutting Comparison

| Dimensão | schemathesis | keploy | bruno/hurl | Decisão M4 (Hodor) |
|---|---|---|---|---|
| Quem gera | Hypothesis a partir do schema | record/replay de traffic | import determinístico | **o agente (Claude)**; tool não embute LLM |
| Grounding | só operações do schema parseado (`schemas.py:459`) | traffic real gravado | curl/openapi reais | fonte concreta obrigatória (`sourceKind`/`sourceRef`) |
| Asserts default | `not_a_server_error`/`status`/`content_type`/`schema` conformance (`checks.py`) | match com noise | toggles `checkStatus/checkSchema` (step-ci) | status<500 + status documentado + content-type + jsonpath-exists (mapeados ao `AssertSpec`) |
| Proveniência | n/a | sem campo `origin` (lacuna); `LastUpdated{Author,Timestamp}` | n/a | **preencher a lacuna:** `provenance{origin,sourceKind,...}` aditivo |
| Estado/aprovação | n/a | `TestStatus` no RESULT, não no artefato; promoção curada com risk gate (`normalise.go:155`) | n/a | aprovação = `Verdict`(M2)+`reviews/`(M3); `reviewState:"draft"` é só rótulo; **nunca auto-aprova** |
| Onde persiste | n/a (runtime) | `tests/<name>.yaml` versionado (`Version` string) | árvore de arquivos | `drafts/{draftId}.json` commitável (zod-validado) |
| Parser de curl | n/a | n/a | tabela flag→cat + state machine (bruno) / clap (hurl) | `parseCurl` mínimo (conceito bruno) + `shell-quote` |

## ADRs

### D1 — Divisão de tools: `save_scenario_draft` (persistência) + `scaffold_request_from_curl` (helper determinístico); a tool NÃO embute LLM

**Decision:** duas tools MCP. **Tool A `save_scenario_draft`**: recebe um `Scenario` montado pelo agente + proveniência, valida (`ScenarioSchema` + provenance) e persiste como DRAFT em `drafts/{draftId}.json` — não executa, não aprova. **Tool B `scaffold_request_from_curl`** (opcional/segunda): recebe string curl, retorna um `ScenarioStep.request` determinístico para ancorar a geração. Nenhuma das duas chama `sampling/createMessage`.

**Rationale:** o cliente MCP do Hodor JÁ é o Claude (o gerador). Embutir LLM (ou pedir sampling de volta, `mcp-typescript-sdk/packages/server/src/server/server.ts:435`) é round-trip redundante (parsimony rung 1 — não precisa existir). O papel determinístico da tool é validar+persistir (A) e dar scaffold de request real (B), espelhando a separação schemathesis (modelo) vs checks e keploy (artefato gravado ≠ aprovado). `architecture.md` §1-§2: lógica no core, MCP é adaptador (segue `server.ts:34/:73`).

**Alternatives considered:** (a) uma tool `generate_scenario` que embute/chama um LLM — rejeitado (Rule 9/YAGNI; o agente já gera). (b) sampling `createMessage` do server p/ o cliente — rejeitado (redundante; o agente é o cliente). (c) só Tool A sem scaffold — aceitável como MVP, mas o scaffold de curl reduz erros de estrutura do agente e ataca o risco #2 (exemplos reais).

**Consequences:** a geração mora no prompt/raciocínio do agente; a tool é determinística e testável; nenhuma dep de LLM. Tool B pode ser cortada do MVP se `/deps-audit` reprovar `shell-quote` (degradação graciosa — o agente monta o request direto).

### D2 — Proveniência aditiva no `Scenario`: `provenance?` opcional (backward-compat)

**Decision:** adicionar ao `ScenarioSchema` um campo OPCIONAL `provenance: z.object({ origin: z.enum(["agent-generated","human-authored"]), sourceKind: z.enum(["curl","openapi","endpoint","traffic"]), sourceRef: z.string().optional(), generatedAt: z.string() }).optional()`. `schemaVersion` permanece `z.literal(1)`.

**Rationale:** keploy mostra a LACUNA — não ter `origin` torna gerado e autorado indistinguíveis (`testcase.go`; `import.go:373`). O Hodor preenche essa lacuna explicitamente. Campo opcional ⇒ cenários M1 existentes seguem válidos (exatamente como `name` entrou aditivo no M2). `sourceKind`/`sourceRef` dão a transparência de origem (alinha risco #1 e M5). `origin` é o que a UI lê para o rótulo "gerado pelo agente".

**Alternatives considered:** bump `schemaVersion` para 2 — rejeitado (campo opcional é backward-compat, não precisa de migração). Campo `origin` solto sem objeto — rejeitado (agrupar em `provenance` mantém o schema coeso e extensível, ISP).

**Consequences:** o `Scenario` carrega sua própria origem; a UI de M2/M3 lê `provenance.origin` para marcar "pendente de revisão"; sem quebra de compat.

### D3 — Estado de aprovação NÃO duplica no Scenario; "pendente" = ausência de `reviews/{runId}.json`; `reviewState:"draft"` é só rótulo

**Decision:** a aprovação continua sendo o `Verdict` (M2, `verdict.ts:10`) materializado em `reviews/{runId}.json` (M3). Um draft é "pendente de revisão" enquanto sua execução não tem artefato de review. O draft carrega `reviewState: z.enum(["draft","approved"]).default("draft")` APENAS como rótulo de UI, não como fonte de verdade da aprovação.

**Rationale:** keploy separa estado de lifecycle (`TestStatus` no `TestResult`, `testrun.go:331`) do artefato — o Hodor já tem esse padrão (verdict separado do run, M2 D3). Duplicar "approved" no Scenario criaria duas fontes de verdade (viola SRP/DRY). A promoção curada do keploy (`normalise.go:155` risk gate, nunca auto-promove) confirma: aprovação é uma OPERAÇÃO humana (o `POST /verdict`), não um flag no artefato gerado.

**Alternatives considered:** máquina de estados completa `draft→pending→approved` no Scenario — rejeitado (YAGNI; o verdict+reviews já modela aprovação). Não ter `reviewState` algum — rejeitado (a UI precisa de um rótulo para "gerado, pendente" sem ter de executar primeiro).

**Consequences:** zero risco de auto-aprovação por design (risco #1) — nenhum caminho escreve `reviews/` sem o `POST /verdict` humano; o draft é inerte até o humano executá-lo e julgá-lo.

### D4 — Persistir draft em `drafts/{draftId}.json` commitável, separado de `runs`/`verdicts`/`reviews`

**Decision:** novo diretório `drafts/` (commitável, via `HODOR_DRAFTS_DIR`, default `drafts/`), 1 arquivo por draft = o `Scenario` + `provenance`, zod-validado no save/load. `runs/`/`verdicts/` seguem efêmeros; `reviews/` segue commitável (artefato pós-verdict).

**Rationale:** o draft é a ENTRADA candidata (cenário não-executado), conceitualmente distinto do run (saída) e do review (artefato pós-aprovação). keploy guarda o artefato gravado em `tests/<name>.yaml` separado do resultado (`testdb/db.go:421` write; `testrun.go` status). bruno guarda request por arquivo (árvore). Commitável porque o humano deve poder revisar/editar o draft no git antes de aprovar (DoD #3). `core/draftStore.ts` (`saveDraft`/`loadDraft`/`listDrafts`) no domínio; MCP/web são callers.

**Alternatives considered:** reusar `scenarios/` — rejeitado (M1 não criou `scenarios/`; e misturar drafts com cenários aprovados perde o rótulo de origem). Guardar draft dentro de `reviews/` — rejeitado (reviews é pós-verdict; draft é pré-execução). Não persistir (só retornar ao agente) — rejeitado (DoD #1 pede rascunho persistido; DoD #3 pede edição humana, que precisa de arquivo).

**Consequences:** `drafts/` sai do gitignore; o draft aparece para `git add`/edição; o fluxo M2/M3 (executar via `run_scenario` → verdict → `reviews/`) permanece intacto e é o único caminho de aprovação.

### D5 — Asserts default conservadores mapeados ao `AssertSpec` existente

**Decision:** o scaffold/agente gera um conjunto default mínimo usando só o `AssertSpec` atual (`scenarioSchema.ts:21`): (1) `{source:"status", op:"lt", value:500}` sempre (ou `equals` ao status documentado se a fonte o declara); (2) `{source:"header:content-type", op:"contains", value:<tipo>}` quando a fonte declara Content-Type; (3) `{source:"jsonpath:$.<campo>", op:"exists"}` para campos-chave de um corpo JSON conhecido. NÃO adicionar validador de JSON Schema no M4.

**Rationale:** mapeia os checks default do schemathesis deriváveis sem stateful (`not_a_server_error` `checks.py:135`, `status_code_conformance` `specs/openapi/checks.py:105`, `content_type_conformance` `:132`, `response_schema_conformance` `:263` em versão leve) ao vocabulário que o Hodor JÁ tem (Rule 9/parsimony — nada novo). Conservador porque o ponto é um ponto de partida revisável (risco #1: o humano refina), não correção exaustiva.

**Alternatives considered:** validação de response contra JSON Schema completo (como schemathesis) — rejeitado M4 (não há validador de schema de resposta no Hodor; é peso de M-futuro). Gerar zero asserts e deixar tudo p/ o humano — rejeitado (perde o valor de acelerar a autoria, DoD).

**Consequences:** cada cenário gerado nasce com asserts básicos verificáveis; o humano adiciona os de negócio; nenhuma dep nova; o assert engine de M1 (`evalAssert.ts`) executa sem mudança.

### D6 — Parser de curl: scaffold determinístico mínimo (conceito bruno), `shell-quote` para tokenização

**Decision:** `core/parseCurl.ts` implementa `parseCurl(cmd)` → `{method, url, headers?, body?}` cobrindo `-X/--request`, `-H/--header`, `-d/--data*`, e a URL posicional, com default `GET` (ou `POST` se há `--data`, como hurl). Tokenização via `shell-quote` (dep MIT, usada por bruno) — sujeito a aprovação no `/deps-audit`. Sem suporte a `-F/--form`/multipart no M4 (YAGNI).

**Rationale:** reusa o CONCEITO do bruno (tabela flag→categoria `parse-curl.js:11` + state machine `:57`, header split `:199`) e a convenção de default-method do hurl (`matches.rs:37`). Quoting de shell é o único ponto realmente delicado — delegar a `shell-quote` (rung 2/4: não reinventar lexer de shell) em vez de regex frágil. Cobertura mínima ataca o risco #2 (exemplos reais) sem peso de um parser completo.

**Alternatives considered:** parser de curl completo (form/multipart/auth) — rejeitado (YAGNI M4). Hand-roll do split de aspas com regex — rejeitado (frágil; é o erro clássico que o bruno evitou usando lib). Modelar via `clap` como hurl — N/A (é Rust; em TS `shell-quote`+tabela é o equivalente KISS). Não ter parser, agente monta o request — aceitável como fallback se a dep reprovar.

## Recommendations

1. **(D2)** `src/core/scenarioSchema.ts`: adicionar `ProvenanceSchema` + `provenance?` opcional ao `ScenarioSchema` (mantendo `schemaVersion: z.literal(1)`); exportar tipos por `core/index.ts`.
2. **(D4)** `src/core/draftStore.ts`: `DraftSchema = Scenario` (com provenance) + `saveDraft`/`loadDraft`/`listDrafts` em `drafts/` (via `HODOR_DRAFTS_DIR`); `drafts/` REMOVIDO do gitignore; zod na fronteira; `assertSafeId` (como `reviewArtifact.ts:65`).
3. **(D1)** `src/mcp/server.ts`: `registerTool("save_scenario_draft", {inputSchema: ScenarioSchema.shape + provenance, outputSchema: {draftId, path}}, ...)` — caller de `saveDraft`; métrica `draftSavedCount` em stderr (wiring triad pillar c). Delega 100% ao core.
4. **(D1/D6)** `src/core/parseCurl.ts` + `registerTool("scaffold_request_from_curl", ...)` retornando um `ScenarioStep.request` — opcional/segunda iteração; só após `/deps-audit` aprovar `shell-quote`.
5. **(D5)** Helper `core/defaultAsserts.ts`: `defaultAssertsFor({statusHint?, contentTypeHint?, jsonKeys?})` → `AssertSpec[]` (status<500, content-type contains, jsonpath exists). Usado pelo agente como sugestão; o humano refina.
6. **(D3)** `src/web/render.ts` + listagem: ler `provenance.origin === "agent-generated"` e exibir badge "gerado pelo agente · pendente de revisão"; o draft aparece numa view (ou na listagem) com botão "executar" (via `run_scenario`) que leva ao fluxo M2/M3 normal. NENHUM caminho escreve `reviews/` sem `POST /verdict`.
7. **(testes IT)** scaffold curl→draft validado; openapi→1 step; draft NÃO gera review até verdict humano; round-trip preserva proveniência; default asserts são executáveis pelo `evalAssert` de M1.
8. **(escopo — fora do M4 / M5)** comparação run-vs-run / regressão / anti-flaky é M5 (`ROADMAP.md:181`); validador de JSON Schema de resposta completo (como schemathesis `response_schema_conformance`) é M-futuro; parser de OpenAPI completo no servidor é M-futuro (o agente lê a spec no M4); `-F`/multipart no curl parser é M-futuro.

## Blocked questions (if any)

Nenhuma — as 5 perguntas do escopo respondidas com citações verificadas em ≥3 referências independentes (schemathesis, keploy, bruno/hurl, + mcp-typescript-sdk para o ponto de sampling). Negativa relevante registrada: a geração OpenAPI→step do step-ci está em dependência fora-da-árvore (`@stepci/plugin-openapi`, `src/index.ts:7`), não citável neste clone — suprida por bruno (`openapi-to-bruno.js`). A comparação run-vs-run é escopo M5 declarado, não pergunta bloqueada.
