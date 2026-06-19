# Review: m4-scenario-generation

**Date:** 2026-06-19
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-api-design, domain-security
**Findings:** 20 total (BLOCKER: 0, HIGH: 2, MEDIUM: 7, LOW: 6, INFO: vários)
**Verdict:** READY_TO_MERGE (0 BLOCKER; os 2 HIGH + MEDIUMs relevantes resolvidos e re-validados)

## Pré-condições

- `/code-quality` (re-audit pós-fixes): **PASS_WITH_CAVEATS** (0 HARD; só `symbol_fab_unverifiable_typescript` — falso-positivo do subpath do SDK MCP).
- Branch `develop`, árvore limpa, 146 testes verdes, `tsc` limpo, `npm audit` 0 vulns, ZERO dep nova.

## HIGH findings — RESOLVIDOS antes do merge

### F-sec-1 (domain-security): vazamento de credencial no draft commitável
- **File:** `src/core/draftStore.ts` · **Risco:** `saveDraft` persistia o `Scenario` cru em `drafts/{id}.json` (commitável) — `request.headers` (Authorization/Cookie/x-api-key) + `sourceRef` (curl com auth) iriam para o git/PR. Assimetria provada com o M3, que já redige no artefato de review.
- **Resolução:** `redactDraftSecrets` redige headers de request sensíveis (reusa o SoT `redactRequestHeaders` do M3 — DRY) + best-effort no `sourceRef`, antes de gravar. Teste `save_draft_redacts_sensitive_request_headers`. CHANGELOG § Security. Resíduo (segredo em URL/body) documentado.

### F-tests-1 (tests) + F-dom-6: divergência plano↔código no EC-2
- **Risco:** o plano v1.1 absorveu EC-2 como "rejeitar url inválida na fronteira", mas a impl aceitava url-lixo (validação só no run-time, não-testada).
- **Resolução:** `DraftSchema.superRefine` valida cada `step.request.url` — aceita URL absoluta OU template `${{ }}` (preserva interpolação M1), rejeita lixo fail-fast. Testes `save_draft_rejects_step_with_invalid_url` (lixo) + `save_draft_accepts_templated_url_step` (template). Divergência eliminada — não se defere mais, valida-se.

## MEDIUM findings

| ID | Finding | Resolução |
|---|---|---|
| F-arch-9 | `sourceRef` sem bound de tamanho | `ProvenanceSchema.sourceRef.max(4096)` |
| F-arch-8 | `generatedAt` volátil no artefato versionável | metadata estável por-draft (como `createdAt` do M3); documentado |
| F-dom-1/F-dom-3 | "draft already exists" inalcançável via tool (sempre randomUUID) | guard mantido p/ a API core (saveDraft direto); via MCP o randomUUID é o default seguro — aceito por design |
| F-dom-2 | usar `DraftSchema.shape` na tool (DRY) | inviável: `DraftSchema` é `ZodEffects` (superRefine) sem `.shape`; o refinement de url é aplicado em `saveDraft`. Não adotado |
| F-wire-1 | `listDrafts`/`loadDraft` sem caller de produção | mesmo perfil aceito no M3 (`loadReviewArtifact`): leitura para futura UI de drafts; exercitado por teste/E2E (não-morto) |

## LOW / INFO (aceitos)

- F-xval-2: `provenance.sourceKind` é auto-declarado pelo agente (rotulado-por-proveniência, não parseado-por-máquina) — aceitável (humano no gate). F-dom-5 (`human-authored` sem sourceKind honesto), F-arch-10/11, F-tests-2/3/4, F-sec-2/3/4 — advisory; prototype-pollution e path-traversal verificados SEGUROS.

## Cross-validation summary

5/5 tasks (T1.1–T4.1) DONE; 17 acceptance criteria; 7/7 gaps da Coverage Matrix; 4 ADRs honrados; sem plan drift.

### DoD do ROADMAP §M4 — SATISFEITO

| DoD | Evidência |
|---|---|
| #1 tool gera cenário candidato (rascunho não-aprovado) de endpoint/curl/OpenAPI | `save_scenario_draft` valida+persiste o Scenario gerado + `provenance.sourceKind`; o agente gera de qualquer fonte (parser de curl deferido — ADR D1, documentado) |
| #2 gerados entram no fluxo M2/M3 marcados "gerado, pendente" | propagação Scenario→Run→Review + badge "🤖 gerado · pendente"; E2E prova |
| #3 humano edita/refina antes de aprovar | draft = JSON commitável editável (`drafts/`); aprovação só via `POST /verdict` |

Risco #1 (nunca auto-aprovar) genuinamente provado (E2E: sem `reviews/` antes do verdict + tool não escreve runs/reviews). Risco #2 coberto por `sourceKind`.

## Quality gates summary

- npm test: PASS (146 testes, 26 arquivos)
- tsc --noEmit: PASS (0 erros)
- npm audit: PASS (0 vulnerabilidades, ZERO dep nova)
- Coverage core: 97.75% lines / draftStore 96% lines
- code-quality: PASS_WITH_CAVEATS (0 HARD)
- DIP: `grep 'from "../web"|"../mcp"' src/core/` vazio; `git check-ignore drafts/` não-ignorado

## Spawned agents (audit trail)

`.claude/agents/review-m4-scenario-generation-2026-06-19/` — architecture, tests, wiring, cross-validation, domain-api-design, domain-security (+ findings/*.yaml)

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER. Os 2 HIGH (vazamento de credencial no draft commitável; divergência EC-2 plano↔código) foram corrigidos com código+teste e re-validados; os MEDIUMs relevantes resolvidos ou documentados. M4 entrega a geração assistida com o humano sempre no gate. Próximo passo (humano): `/release` (v0.5.0, minor — Added + Security).
