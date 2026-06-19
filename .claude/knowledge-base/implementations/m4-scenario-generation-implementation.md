# Implementation Summary — m4-scenario-generation

Date: 2026-06-19
Plan: knowledge-base/plans/m4-scenario-generation-plan.md (v1.1, SHIPPABLE_WITH_CAVEATS 89)
Promise: **IMPLEMENTATION_COMPLETE**

## Resultado

Geração de cenários assistida pelo agente (M4): tool MCP `save_scenario_draft` que persiste o
cenário CANDIDATO gerado pelo agente como rascunho não-aprovado em `drafts/{draftId}.json`
(commitável), com proveniência aditiva (`provenance: {origin, sourceKind, sourceRef?, generatedAt}`)
que propaga `Scenario → RunEnvelope → ReviewArtifact`. A web app marca os runs gerados como
"🤖 gerado pelo agente · pendente de revisão". A aprovação continua sendo EXCLUSIVAMENTE o verdict
humano (M2) → `reviews/` (M3) — a tool nunca executa nem auto-aprova (risco #1). ZERO dep nova.

## Validação (Final Phase)

| Gate | Resultado |
|---|---|
| `npx vitest run` | 144 testes, 26 arquivos — **PASS** |
| `npx tsc --noEmit` | 0 erros — **PASS** |
| `npm audit` | 0 vulnerabilidades (ZERO dep nova) — **PASS** |
| Coverage core | 97.59% lines (draftStore 94.28%, provenance ~100%) — **PASS** |
| `git check-ignore drafts/` | não-ignorado (commitável) — **PASS** |
| Backward-compat M0-M3 | run_request/run_scenario/listagem/verdict/review verdes |
| DIP | `grep 'from "../web"\|from "../mcp"' src/core/` vazio — **PASS** |

## Wiring triad por task

| Task | Caller (pillar a) | Integration test (pillar b) | Observável (pillar c) |
|---|---|---|---|
| T1.1 provenance | Scenario/RunEnvelope/ReviewArtifact usam | provenance.test.ts (4) | schema validado |
| T1.2 propagação | runScenario→buildRunEnvelope; buildReviewArtifact | provenancePropagation.test.ts (5) | env/artifact.provenance |
| T1.3 draftStore | save_scenario_draft tool chama saveDraft | draftStore.test.ts (11) | drafts/{id}.json |
| T2.1 tool | `save_scenario_draft` (caller de produção) | mcp/draft.test.ts (4) | draftSavedCount em stderr |
| T3.1 badge | renderRun/renderListing lêem provenance | render.test.ts (6 M4) | HTML "gerado pelo agente" |
| T4.1 E2E | integra mcp+core+web | m4-e2e.test.ts (1) | loop completo |

## DoD do ROADMAP §M4 (validado)

| DoD | Evidência |
|---|---|
| #1 tool gera cenário candidato (rascunho não-aprovado) de endpoint/curl/OpenAPI | `save_scenario_draft` persiste o Scenario gerado + provenance.sourceKind em `drafts/`; o agente gera de qualquer fonte |
| #2 gerados entram no fluxo M2/M3 marcados "gerado, pendente" | propagação Scenario→Run→Review + badge "🤖 gerado · pendente"; E2E prova |
| #3 humano edita/refina antes de aprovar | draft = arquivo JSON commitável editável (drafts/); aprovação só via verdict |

## Edge cases / decisões honradas

- **EC-1** draftId: omitido → `randomUUID`; id existente → erro (sem overwrite silencioso — não perde candidato).
- **EC-2 (corrigido honestamente):** a sugestão original (apertar url do step para `.url()`) estava INCORRETA — cenários M1 usam url templada `${{ var }}` que não é URL válida antes da interpolação. Validação de url é deferida ao run-time (`executeRequest`+`CapturedRequestSchema.url()`); teste `save_draft_accepts_templated_url_step` prova o porquê.
- **EC-3** `listDrafts` em dir inexistente → `[]`; tolera arquivo corrompido (não 500).
- **Parsimônia (ADR D1):** Tool B (parser de curl + dep `shell-quote`) DEFERIDA — o agente (cliente MCP) já parseia curl e gera asserts nativamente. ZERO dep nova.
- ADRs D1-D4 do plano honrados; aprovação nunca duplicada no draft (D3); `drafts/` separado de runs/verdicts/reviews (D4).

## Backward-compatibility
- `provenance?` OPCIONAL em Scenario/RunEnvelope/ReviewArtifact (`schemaVersion:1` preservado).
- `buildRunEnvelope` param `provenance?` aditivo ao final — `run_request` (M0) e `run_scenario` (M1) intactos.
- Tools `run_request`/`run_scenario` inalteradas; nova tool é aditiva.

## Commits (develop)
`4351af8` core provenance+propagação (T1.1,T1.2) · `90e6e52` draftStore (T1.3) · `4b53dd5` tool MCP (T2.1) · `326d4ee` web badge (T3.1) · `48d7910` E2E+CHANGELOG (T4.1).
