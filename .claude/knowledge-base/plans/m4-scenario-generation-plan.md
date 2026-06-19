---
slug: m4-scenario-generation
milestone_id: M4
created_at: 2026-06-19
goal: Dar ao agente uma tool MCP que persiste um cenário candidato (gerado por ele) como rascunho não-aprovado com proveniência rastreável, que entra no fluxo de revisão M2/M3 marcado "gerado pelo agente · pendente", provado por um teste E2E verde.
---

# Plan: M4 — Geração de cenários assistida pelo agente

> **Version 1.1** (absorveu EC-1 + EC-2 MUST-FIX de `knowledge-base/reviews/m4-scenario-generation-edge-cases-2026-06-19.md`: draftId default `randomUUID` sem overwrite silencioso; url do step validada na fronteira do draft). Baseado no blueprint SHIPPABLE_WITH_CAVEATS `knowledge-base/discoveries/blueprints/m4-scenario-generation-blueprint.md` (schemathesis: grounding + asserts default; keploy: proveniência/estado separado do artefato; bruno/hurl: parsing). Introduz a tool MCP `save_scenario_draft`: o AGENTE (Claude — que já é o cliente MCP e o gerador) monta um `Scenario` a partir de uma fonte concreta (endpoint/curl/OpenAPI que ele lê) e o submete; a tool valida (zod) + persiste como DRAFT em `drafts/{draftId}.json` commitável, com `provenance` aditivo. O draft NÃO é executado nem aprovado pela tool. A proveniência propaga `Scenario → RunEnvelope → ReviewArtifact`, e a web app marca "gerado pelo agente · pendente de revisão". A aprovação continua sendo EXCLUSIVAMENTE o `POST /verdict` humano (M2) → `reviews/{id}.json` (M3) — nunca auto-aprova (risco #1). ZERO dependência nova.

## Goal

> Entregar a tool MCP `save_scenario_draft` que persiste um cenário gerado pelo agente como rascunho versionável com proveniência, propagada até o artefato de review e exibida como "gerado pelo agente · pendente", measured by o teste E2E `e2e_m4_agent_draft_flows_to_review_marked_pending` retornando verde.

## Context

`ROADMAP.md` §M4 (depende de M1/M2/M3, todos `[x]`) pede: (1) tool MCP que, dado endpoint/OpenAPI/curl, o agente gera um cenário candidato (steps+asserts) como rascunho não-aprovado; (2) cenários gerados entram no fluxo de revisão M2/M3 marcados "gerado pelo agente, pendente de revisão"; (3) o humano edita/refina antes de aprovar. Riscos: (#1) cenários ruins gerando ruído — humano no gate, nunca auto-aprovar; (#2) não depender só de OpenAPI — suportar exemplos reais (curl/traffic).

**Insight central de parsimônia (blueprint D1):** no MCP, o cliente JÁ é o Claude — o LLM gerador. A tool NÃO embute LLM nem pede `sampling/createMessage` de volta (round-trip redundante). O papel determinístico da tool é **validar + persistir** o cenário que o agente montou, com proveniência. A geração mora no raciocínio do agente, ancorada numa fonte concreta (`provenance.sourceKind`).

**Escopo deferido (YAGNI, documentado no blueprint Rec 8):** parser de curl determinístico (Tool B `scaffold_request_from_curl` + dep `shell-quote`) e `defaultAssertsFor` — o agente parseia curl e gera asserts nativamente; embutir parser + dep nova é o inverso da ladder. Revisitar só se houver fricção real. Comparação run-vs-run/regressão = M5. Validador de JSON Schema de resposta + parser OpenAPI no servidor = M-futuro.

## Baseline Context (deep review of current state)

> Estado real pós-M3 (v0.4.0). Evidência: `git log` + `wc -l` + grep de callers. `runs/`+`verdicts/` gitignored; `reviews/` commitável.

### Files that will be touched

| File | LoC hoje | Last commit | Por que existe | Invariante a preservar |
|---|---|---|---|---|
| `src/core/provenance.ts` (NEW) | 0 | — | (a criar) `ProvenanceSchema` (origin/sourceKind/sourceRef?/generatedAt) — SoT único do conceito (DRY) | reusado por Scenario E RunEnvelope; sem ciclo de import |
| `src/core/scenarioSchema.ts` | 64 | `ec2928b` | `ScenarioSchema = {schemaVersion:1, name, steps[]}` (M1) | add `provenance?` OPCIONAL; `schemaVersion` permanece `1` (backward-compat) |
| `src/core/runSchema.ts` | 65 | `1582c47` | envelope + RunStep (M0-M3) | add `provenance?` OPCIONAL ao `RunEnvelopeSchema`; runs M0-M3 sem ele seguem válidos |
| `src/core/runStore.ts` | 40 | `ec2928b` | `buildRunEnvelope(steps, deps, name?)` | add param `provenance?` aditivo (último, opcional); assinatura M2 preservada |
| `src/core/runScenario.ts` | 45 | `ec2928b` | engine multi-step → envelope (M1) | propaga `scenario.provenance` ao envelope; sem mudança de comportamento de execução |
| `src/core/reviewArtifact.ts` | 95 | `442b1da` | artefato versionável (M3) | `buildReviewArtifact` carrega `env.provenance` (aditivo, opcional) ao artefato |
| `src/core/draftStore.ts` (NEW) | 0 | — | (a criar) `saveDraft`/`loadDraft`/`listDrafts` em `drafts/` | zod na fronteira; `assertSafeId` (espelha `reviewArtifact.ts:65`); nunca executa/aprova |
| `src/core/index.ts` | 64 | `442b1da` | superfície pública do core (DIP) | add exports de provenance/draftStore; preserva existentes |
| `src/mcp/server.ts` | 114 | `ec2928b` | adaptador MCP (run_request/run_scenario) | add tool `save_scenario_draft`; delega 100% ao core; métrica em stderr; tools existentes intactas |
| `src/web/server.ts` | 268 | `442b1da` | adaptador HTTP (listagem + verdict) | listagem lê `provenance.origin`; rotas/validação M2/M3 preservadas |
| `src/web/render.ts` | 257 | `ec2928b` | render HTML server-side | badge "gerado pelo agente · pendente" quando `origin==agent-generated` e sem verdict; escape XSS mantido |
| `.gitignore` | 32 | `442b1da` | ignora runs/, verdicts/ | add comentário: `drafts/` é COMMITÁVEL (não adicionar) |
| `CHANGELOG.md` | — | (release) | contrato público | entrada em `[Unreleased] § Added` |

### Current callers / dependents

- **`ScenarioSchema`** (`scenarioSchema.ts:50`): caller `mcp/server.ts:80` (`run_scenario` inputSchema). Add `provenance?` é aditivo — a tool `run_scenario` segue aceitando cenários sem proveniência.
- **`RunEnvelopeSchema`** (`runSchema.ts:55`): callers `runStore.ts` (build/persist/load), `reviewArtifact.ts` (normaliza), `web/render.ts` (render), `mcp/server.ts` (outputSchema). `provenance?` opcional não quebra nenhum.
- **`buildRunEnvelope`** (`runStore.ts:23`): callers `mcp/server.ts:54` (`run_request`, sem name/provenance), `runScenario.ts:44` (com name). Novo param opcional ao final preserva ambos.
- **`buildReviewArtifact`** (`reviewArtifact.ts:46`): caller `web/server.ts` (postVerdict). Carregar provenance é aditivo.

### Domain glossary

- **Draft** — cenário candidato gerado, NÃO executado e NÃO aprovado, em `drafts/{id}.json` (editável no git).
- **Provenance** — metadados de origem: `origin` (agent-generated|human-authored), `sourceKind` (curl|openapi|endpoint|traffic), `sourceRef?`, `generatedAt`.
- **Pendente de revisão** — estado derivado: um draft/run cuja execução ainda NÃO tem `reviews/{runId}.json`. Não é flag de aprovação (D3).

### Architecture boundaries affected

Lógica no `src/core/` (domínio puro: schemas, draftStore, propagação). `src/mcp/` e `src/web/` são adaptadores que só importam de `src/core/index.js`. `core` não importa de mcp/web. DIP preservado.

## Prior Art & Related Work

- Interno: blueprint `knowledge-base/discoveries/blueprints/m4-scenario-generation-blueprint.md` (6 ADRs de design); padrão aditivo de schema dos M1/M2 (`asserts?`/`name?`); `reviewArtifact.ts` `assertSafeRunId` (padrão de path-safety a espelhar).
- Externo (citado no blueprint): schemathesis (`checks.py`, grounding em spec), keploy (`testcase.go` — lacuna de `origin`; `normalise.go:155` risk-gate de promoção curada), bruno (`parse-curl.js`, `openapi-to-bruno.js`), mcp-typescript-sdk (`server.ts:435` sampling — rejeitado por redundância).

## ADRs

### D1 — Tool `save_scenario_draft` valida+persiste; NÃO embute LLM (blueprint D1)

**Decisão:** uma tool MCP `save_scenario_draft` que recebe o `Scenario` (montado pelo agente) + `provenance`, valida com `ScenarioSchema.parse` e persiste como DRAFT em `drafts/{draftId}.json`. Não executa, não aprova, não chama LLM.

**Rationale:** o cliente MCP do Hodor já é o Claude (o gerador) — `architecture.md` § 1 mantém lógica no core. Embutir LLM ou pedir `sampling/createMessage` de volta (mcp-typescript-sdk `server.ts:435`) é round-trip redundante (parsimony rung 1). Espelha a separação keploy (artefato gravado ≠ aprovado).

**Alternativas rejeitadas:** (a) tool `generate_scenario` que chama um LLM — rejeitado (Rule 9/YAGNI; o agente já gera). (b) sampling server→client — rejeitado (redundante). (c) Tool B parser de curl + dep `shell-quote` — **deferido** (YAGNI M4; o agente parseia curl nativamente; revisitar se houver fricção).

### D2 — Proveniência aditiva e opcional (blueprint D2)

**Decisão:** `ProvenanceSchema` em `src/core/provenance.ts` (SoT único), referenciado por `ScenarioSchema.provenance?` e `RunEnvelopeSchema.provenance?`, ambos OPCIONAIS. `schemaVersion` permanece `z.literal(1)`.

**Rationale:** keploy mostra a lacuna de não ter `origin` (`testcase.go` — gerado e importado indistinguíveis). Campo opcional ⇒ backward-compat total, exatamente como `name` entrou aditivo no M2 (`runSchema.ts:51`). Agrupar em objeto `provenance` mantém o schema coeso (ISP) e evita duplicar o conceito (DRY — daí o módulo único).

**Alternativas rejeitadas:** bump `schemaVersion` para 2 (campo opcional não exige migração); `origin` solto sem objeto (perde coesão/extensibilidade).

### D3 — "Pendente" = ausência de `reviews/{runId}.json`; aprovação só via `POST /verdict` (blueprint D3, risco #1)

**Decisão:** a aprovação continua sendo EXCLUSIVAMENTE o `Verdict` (M2) materializado em `reviews/{runId}.json` (M3). Um draft/run gerado é "pendente" enquanto NÃO existe o artefato de review da sua execução. NÃO há campo de aprovação no draft nem caminho que escreva `reviews/` sem o `POST /verdict` humano.

**Rationale:** keploy separa estado de lifecycle (`TestStatus` no result) do artefato e usa risk-gate na promoção (`normalise.go:155`, nunca auto-promove). Duplicar "approved" no draft criaria duas fontes de verdade (SRP/DRY). Zero risco de auto-aprovação por design.

**Alternativas rejeitadas:** máquina de estados `draft→pending→approved` no Scenario (YAGNI — verdict+reviews já modela); flag `approved` no draft (segunda fonte de verdade).

### D4 — Draft em `drafts/{draftId}.json` commitável (blueprint D4, DoD #3)

**Decisão:** novo diretório `drafts/` (commitável, via `HODOR_DRAFTS_DIR`, default `drafts/`), 1 arquivo por draft = `Scenario` + `provenance`, zod-validado no save/load, `draftId` path-safe (espelha `reviewArtifact.ts:65`). `runs/`+`verdicts/` seguem efêmeros.

**Rationale:** o draft é a ENTRADA candidata (não-executada), distinta de run (saída) e review (pós-verdict). Commitável porque o humano edita/refina no git antes de aprovar (DoD #3). Espelha keploy guardando o artefato separado do resultado.

**Alternativas rejeitadas:** reusar `scenarios/` (M1 não criou; mistura draft com aprovado); guardar em `reviews/` (reviews é pós-verdict); não persistir (DoD #1/#3 exigem arquivo editável).

## Dependency Graph

```
P1 (core: provenance + schemas aditivos + draftStore + propagação) ──> P2 (mcp: save_scenario_draft)
                                  │                                  └─> P3 (web: badge proveniência)
                                  └──────────────────────────────────> P4 (E2E loop M4)
P2, P3 podem paralelizar após P1; P4 depende de P1+P2+P3.
```

## Phases

### Phase 1 — Core: proveniência aditiva + draftStore + propagação

#### T1.1 — `ProvenanceSchema` (módulo único, DRY)

**Why this step:** o conceito de proveniência é usado por Scenario E RunEnvelope; um módulo único evita duplicação (DRY) e ciclo de import. Ação: criar `src/core/provenance.ts`. Raciocínio: ancora D2; SoT único citável pela UI e pela tool.

**Files to edit:** `src/core/provenance.ts` (NEW), `src/core/provenance.test.ts` (NEW), `src/core/index.ts`.

**Deep file dependency analysis:** nenhum import de mcp/web (domínio puro). zod já é dep.

#### TDD
- RED `provenance_schema_accepts_agent_generated` — `{origin:"agent-generated", sourceKind:"curl", sourceRef:"curl ...", generatedAt:"..."}` passa `ProvenanceSchema.parse`.
- RED `provenance_schema_rejects_unknown_origin` — `origin:"random"` → `safeParse` falha.
- RED `provenance_schema_allows_optional_source_ref` — sem `sourceRef` → válido.

**Acceptance:** `ProvenanceSchema` exporta `origin` enum(agent-generated|human-authored), `sourceKind` enum(curl|openapi|endpoint|traffic), `sourceRef?`, `generatedAt:string`; tipo `Provenance` exportado por `core/index.ts`.

**DoD:** `npx vitest run src/core/provenance.test.ts` verde; `tsc` limpo.

#### Concurrency tests
(none — single-threaded) — schema puro, sem estado compartilhado.

#### T1.2 — `provenance?` aditivo em Scenario + RunEnvelope + propagação

**Why this step:** a proveniência precisa fluir do cenário gerado até o artefato de review (DoD #2). Ação: add `provenance?` opcional a `ScenarioSchema` e `RunEnvelopeSchema`; `buildRunEnvelope` ganha param `provenance?`; `runScenario` propaga `scenario.provenance`; `buildReviewArtifact` carrega `env.provenance`. Raciocínio: backward-compat como `name` no M2; é a espinha da propagação que marca "gerado · pendente".

**Files to edit:** `src/core/scenarioSchema.ts`, `src/core/runSchema.ts`, `src/core/runStore.ts`, `src/core/runScenario.ts`, `src/core/reviewArtifact.ts` + os respectivos `*.test.ts`.

**Deep file dependency analysis:** `buildRunEnvelope` callers (`run_request` sem provenance, `runScenario` com) — param opcional ao final preserva ambos. `RunEnvelopeSchema` callers (render/load/output) tolerantes a campo opcional. `reviewArtifact` `NormalizedStep` não muda; provenance vai no topo do artefato.

#### TDD
- RED `scenario_schema_accepts_optional_provenance` — cenário com `provenance` válido passa; cenário M1 sem `provenance` SEGUE válido (`schemaVersion:1`).
- RED `run_envelope_accepts_optional_provenance` — envelope com/sem provenance válido.
- RED `build_run_envelope_carries_provenance_when_given` — `buildRunEnvelope(steps, deps, name, prov)` inclui `provenance`; sem o param → ausente (run_request M0 intacto).
- RED `run_scenario_propagates_scenario_provenance_to_envelope` — `runScenario(scenarioComProvenance)` → `env.provenance.origin==="agent-generated"`.
- RED `build_review_artifact_carries_provenance` — `buildReviewArtifact(envComProvenance, verdict).provenance.origin==="agent-generated"`; sem provenance no env → ausente no artefato.

**Acceptance:** os 4 schemas/funcs aceitam e propagam `provenance` de ponta a ponta; TODOS os testes M0/M1/M2/M3 existentes seguem verdes (backward-compat).

**DoD:** `npx vitest run` verde (suíte inteira); `tsc` limpo.

#### Concurrency tests
(none — single-threaded).

#### T1.3 — `draftStore` (saveDraft/loadDraft/listDrafts em `drafts/`)

**Why this step:** o draft precisa ser persistido como arquivo editável commitável (DoD #1/#3). Ação: criar `src/core/draftStore.ts` com `DraftSchema` (= Scenario com provenance obrigatória), `saveDraft`/`loadDraft`/`listDrafts`, `drafts/` via `HODOR_DRAFTS_DIR`, `assertSafeId`. Raciocínio: D4; espelha `reviewArtifact.ts` (validação na fronteira + path-safety + stableStringify p/ diff estável).

**Files to edit:** `src/core/draftStore.ts` (NEW), `src/core/draftStore.test.ts` (NEW), `src/core/index.ts`, `.gitignore` (comentário drafts/ commitável).

**Deep file dependency analysis:** reusa `ScenarioSchema`, `ProvenanceSchema`, `stableStringify` (diff estável — M3), padrão `assertSafeRunId`. Domínio puro.

#### TDD
- RED `save_draft_writes_validated_scenario_with_provenance` — salva um draft com provenance; arquivo existe em `drafts/{id}.json`, zod-válido, `stableStringify` (chaves ordenadas).
- RED `save_draft_rejects_scenario_without_provenance` — draft sem provenance → `ZodError` (um draft É gerado/autorado, sempre tem origem).
- RED `save_draft_generates_safe_id_when_omitted` (EC-1) — `saveDraft(scenario)` sem `id` → `draftId = crypto.randomUUID()` (espelha `runStore.ts:29`), path-safe por construção, retornado no resultado.
- RED `save_draft_does_not_silently_overwrite_existing_id` (EC-1) — salvar duas vezes com o MESMO id explícito → erro `draft already exists` (não last-write-wins silencioso; evita perder candidato a revisar). Sobrescrita intencional exige id novo.
- RED `save_draft_rejects_step_with_invalid_url` (EC-2) — draft com `steps[].request.url:"not a url"` → `ZodError` na fronteira do draft (fail-fast; alinha com `CapturedRequestSchema.url` `.url()` do `runSchema.ts:14`), em vez de só estourar no run-time.
- RED `load_draft_round_trips` / `load_draft_returns_null_when_absent` / `load_draft_throws_on_corrupt_file` (espelha reviewArtifact, fail-loud).
- RED `save_draft_rejects_path_traversal_id` — id `../x` → `unsafe` (F-sec-2 do M3).
- RED `list_drafts_returns_saved_ids` — lista os drafts salvos; tolera arquivo corrompido (não 500).
- RED `list_drafts_returns_empty_when_dir_absent` (EC-3) — diretório inexistente → `[]`, não throw.

**Acceptance:** `saveDraft(scenario, id?, dir?)`/`loadDraft(id, dir?)`/`listDrafts(dir?)` no core; `id` omitido → `randomUUID`; mesmo id existente → erro (sem overwrite silencioso); url do step validada na fronteira do draft; `drafts/` fora do gitignore; path-safe; determinístico.

**DoD:** `npx vitest run src/core/draftStore.test.ts` verde; `git check-ignore drafts/` retorna não-ignorado.

#### Concurrency tests
(none — single-threaded; I/O de arquivo isolado por id, last-write-wins aceito como no verdict/review do M2/M3).

### Phase 2 — MCP: tool `save_scenario_draft`

#### T2.1 — Tool `save_scenario_draft`

**Why this step:** é a superfície que o agente chama para registrar o rascunho (DoD #1). Ação: `registerTool("save_scenario_draft", {inputSchema: ScenarioSchema.shape + provenance, outputSchema:{draftId, path}}, ...)` chamando `saveDraft`; métrica `draftSavedCount` em stderr (wiring pillar c). Raciocínio: D1; delega 100% ao core, espelha `run_scenario` (`server.ts:73`).

**Files to edit:** `src/mcp/server.ts`, `src/mcp/server.test.ts` (ou novo `src/mcp/draft.test.ts`).

**Deep file dependency analysis:** caller de produção de `saveDraft` (wiring pillar a). InputSchema valida na fronteira MCP. Não executa o cenário, não toca `reviews/`.

#### TDD
- RED `save_scenario_draft_tool_persists_draft_via_inmemory_transport` — via `InMemoryTransport` (padrão dos testes MCP), chamar a tool com um Scenario+provenance → retorna `{draftId, path}` e `loadDraft(draftId)` resolve com `origin==="agent-generated"`.
- RED `save_scenario_draft_tool_rejects_invalid_scenario` — Scenario sem steps / provenance inválida → erro na fronteira (não persiste).
- RED `save_scenario_draft_increments_metric` — `getDraftSavedCount()` incrementa.

**Acceptance:** a tool aparece em `tools/list`; persiste draft; nunca executa nem escreve `reviews/`; métrica observável.

**DoD:** `npx vitest run src/mcp` verde; `tsc` limpo.

#### Concurrency tests
(none — single-threaded; o McpServer processa uma chamada por vez no teste).

### Phase 3 — Web: badge "gerado pelo agente · pendente"

#### T3.1 — Badge de proveniência na listagem/run

**Why this step:** DoD #2 — cenários gerados entram no fluxo de revisão MARCADOS "gerado pelo agente, pendente". Ação: na listagem e na view de run, ler `provenance.origin === "agent-generated"` e renderizar um badge "gerado pelo agente"; quando sem verdict, "· pendente de revisão". Raciocínio: D2/D3; só leitura de campo aditivo, sem novo endpoint.

**Files to edit:** `src/web/render.ts`, `src/web/server.ts` (se a listagem precisar ler provenance do envelope), `src/web/render.test.ts` + `src/web/server.test.ts`.

**Deep file dependency analysis:** render lê `env.provenance`; escape XSS já existente (M2) aplica a `sourceRef`. Sem mudança de rota.

#### TDD
- RED `render_shows_agent_generated_badge` — run com `provenance.origin==="agent-generated"` → HTML contém "gerado pelo agente".
- RED `render_shows_pending_when_no_verdict` — run agent-generated sem verdict → HTML contém "pendente de revisão".
- RED `render_omits_badge_for_human_authored` — run sem provenance (M0-M3) → sem badge (backward-compat visual).
- RED `render_escapes_provenance_source_ref` — `sourceRef` com `<script>` → escapado (XSS — herda M2).

**Acceptance:** badge visível p/ agent-generated; ausente p/ runs legados; XSS-safe.

**DoD:** `npx vitest run src/web` verde.

#### Concurrency tests
(none — single-threaded).

### Phase 4 — Final Phase: Integration Validation (E2E loop M4)

#### T4.1 — E2E `e2e_m4_agent_draft_flows_to_review_marked_pending`

**Why this step:** prova o loop M4 inteiro e a métrica do Goal. Ação: criar `src/m4-e2e.test.ts`. Raciocínio: integra P1+P2+P3 — agente salva draft (via tool/saveDraft) → humano executa (`runScenario` propaga provenance) → run normalizado → `POST /verdict` → `reviews/{id}.json` carrega provenance; antes do verdict a UI mostra "pendente"; nunca auto-aprova.

**Files to edit:** `src/m4-e2e.test.ts` (NEW), `CHANGELOG.md`.

#### TDD
- RED `e2e_m4_agent_draft_flows_to_review_marked_pending`:
  1. `saveDraft(scenarioGerado{provenance: agent-generated, sourceKind: curl})` → `drafts/{id}.json` existe, editável, NÃO há `reviews/`.
  2. humano "executa": `runScenario` → `env.provenance.origin==="agent-generated"`; a web app (listagem) renderiza badge "gerado pelo agente · pendente de revisão" (sem verdict).
  3. `POST /runs/:id/verdict approved` → `reviews/{id}.json` existe com `provenance.origin==="agent-generated"` + verdict (proveniência sobreviveu ao loop).
  4. asserção do risco #1: ANTES do POST não existia `reviews/{id}.json` (nenhum caminho auto-aprovou).
  5. `drafts/` não-gitignored; `runs/`+`verdicts/` ignorados.

**Acceptance:** E2E verde; os 3 DoDs do ROADMAP demonstrados empiricamente.

**DoD (Final Phase — chain inteira):** `npx vitest run` (suíte completa) verde; `npx tsc --noEmit` 0 erros; `npm audit` 0 vulns (ZERO dep nova); coverage core dos arquivos novos ≥ 90%; `git check-ignore drafts/` não-ignorado; backward-compat M0-M3 verde; CHANGELOG `[Unreleased] § Added` atualizado.

#### Concurrency tests
(none — single-threaded).

#### Failure scenarios
- **Draft corrompido em disco** (`loadDraft`): JSON inválido → lança (fail-loud), `listDrafts` pula o corrompido sem 500. Reproduzido em T1.3.
- **Scenario inválido na tool** (`save_scenario_draft`): steps vazio / provenance ausente → `ZodError` na fronteira → não persiste. Reproduzido em T2.1.
- **Path-traversal no draftId**: `../x` → `unsafe id` (defense-in-depth). Reproduzido em T1.3.
- (Sem I/O externo de rede novo — a execução real continua sendo `executeRequest`/`run_scenario` do M0/M1, já cobertos.)

## Coverage Matrix

| # | Gap / Requirement (ROADMAP §M4 DoD) | Task(s) | Resolution |
|---|---|---|---|
| 1 | DoD #1 — tool MCP gera cenário candidato (rascunho não-aprovado) de endpoint/curl/OpenAPI | T2.1, T1.3, T1.1, T1.2 | `save_scenario_draft` persiste o Scenario gerado + provenance em `drafts/` |
| 2 | DoD #2 — gerados entram no fluxo M2/M3 marcados "gerado, pendente" | T1.2, T3.1, T4.1 | propagação Scenario→Run→Review + badge na web |
| 3 | DoD #3 — humano edita/refina antes de aprovar | T1.3, T4.1 | draft = arquivo commitável editável; aprovação só via verdict (D3) |
| 4 | Risco #1 — nunca auto-aprovar | T4.1 | assert: sem `reviews/` antes do `POST /verdict` humano (D3) |
| 5 | Risco #2 — suportar exemplos reais (não só OpenAPI) | T1.1 | `provenance.sourceKind` curl/endpoint/traffic; agente gera de qualquer fonte |
| 6 | Backward-compat M0-M3 | T1.2 | campos `provenance?` opcionais; suíte existente verde |
| 7 | ZERO dep nova | T1.3 | escopo defere parser curl/shell-quote (D1) |

**Coverage: 7/7 gaps cobertos (100%)**

## Global DoD

- Todos os testes verdes (`npx vitest run`); `tsc --noEmit` 0 erros; `npm audit` 0 vulns.
- ZERO dependência nova (verificável por `git diff package.json` vazio).
- Coverage dos arquivos core novos (`provenance.ts`, `draftStore.ts`) ≥ 90%.
- Lint/complexidade: arquivos ≤ 500 LoC (architecture.md); funções coesas (SRP).
- DIP preservado: `grep -rn 'from "../web"\|from "../mcp"' src/core/` vazio.
- `drafts/` commitável; `runs/`+`verdicts/` efêmeros.
- CHANGELOG `[Unreleased] § Added` com a entrada do M4.
- Os 3 DoDs do ROADMAP §M4 validados empiricamente pelo E2E.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `zod` | `^3.x` (já declarado) | npm | validação na fronteira de `ProvenanceSchema`/`DraftSchema` (reuso M0-M3) |
| `@modelcontextprotocol/sdk` | `1.29.0` (já declarado) | npm | `registerTool("save_scenario_draft", ...)` (reuso M0/M1) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | — | M4 não adiciona dependência. `shell-quote` (parser de curl) foi DEFERIDO via D1 (Tool B fora de escopo) — o agente parseia curl nativamente. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Drawbacks & Risks

| Risco | Severidade | Mitigação | Owner |
|---|---|---|---|
| Cenários gerados de baixa qualidade gerarem ruído de revisão (risco #1 ROADMAP) | Média | Humano no gate — nunca auto-aprova (D3); proveniência transparente; asserts conservadores revisáveis | dev |
| Acoplar formato do draft à implementação | Baixa | `provenance` aditivo + zod versionável (`schemaVersion:1`); draft é só Scenario+provenance | dev |
| Defer do parser de curl frustrar a expectativa "from curl" | Baixa | O agente parseia curl nativamente; `provenance.sourceKind:"curl"` registra a origem; revisitar Tool B se houver fricção (documentado) | dev |
| Proveniência não propagar até o review (DoD #2) | Média | T1.2 testa a cadeia Scenario→Run→Review explicitamente; T4.1 prova ponta-a-ponta | dev |

## Unresolved Questions

(none — every decision is resolved at plan time; design fixado no blueprint e escopo de parsimônia neste plano.)
