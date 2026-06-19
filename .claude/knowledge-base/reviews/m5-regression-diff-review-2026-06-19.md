# Review: m5-regression-diff

**Date:** 2026-06-19
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-data-pipeline, domain-security
**Findings:** 24 total (BLOCKER: 0, HIGH: 5, MEDIUM: 4, LOW: vários, INFO: vários)
**Verdict:** READY_TO_MERGE (0 BLOCKER; os 3 HIGH acionáveis corrigidos+re-validados; 2 HIGH documentados como tradeoffs conscientes)

## Pré-condições

- `/code-quality` (re-audit pós-fixes): **PASS_WITH_CAVEATS** (0 HARD; só `symbol_fab_unverifiable_typescript` — falso-positivo do subpath do SDK).
- Branch `develop`, árvore limpa, 187 testes verdes, `tsc` limpo, `npm audit` 0 vulns, ZERO dep nova, DIP limpo.

## HIGH findings

### F-dom-sec-1 (domain-security): path-traversal no `rm` da retenção — RESOLVIDO
- **Risco:** `pruneRunHistory` fazia `rm(join(dir, runId+'.json'))` com `runId` vindo do conteúdo do run (validado só por `min(1)`); PoC confirmou escape de `runs/`.
- **Resolução:** `RunEnvelopeSchema.runId` agora é path-safe (regex `^[A-Za-z0-9._-]+$` — sem `/`/`..`) — fecha na desserialização para TODOS os callers; + assert `resolve(target).startsWith(resolve(dir)+sep)` antes do rm. Teste `run_envelope_rejects_path_unsafe_runId`.

### F-dom-1 (domain-data-pipeline): assimetria de noise podia esconder regressão — RESOLVIDO
- **Risco (risco #1 do ROADMAP):** `diffRuns` usava `curr.noise ?? prev.noise` — noise adicionado só no run atual mascarava AMBOS os lados, escondendo uma mudança real no baseline.
- **Resolução:** cada lado é mascarado com o SEU próprio noise → quando o noise difere, a mudança SURFACE (não é escondida) + flag `noiseChanged` (web exibe aviso "regras de noise mudaram"). Teste `diff_runs_surfaces_change_when_noise_asymmetric`.

### F-wire-1 (wiring): retenção sem observável no sucesso — RESOLVIDO
- **Risco (risco #2 do ROADMAP):** `pruneAfterPersist` só logava falha; poda bem-sucedida era invisível em produção.
- **Resolução:** `pruneRunHistory` retorna `{removed, pinned, kept}`; `pruneAfterPersist` loga `prune_history` no sucesso (stderr — pillar c). Teste `prune_run_history_returns_observable_stats`.

### F-dom-2 (HIGH→documentado): paths de noise abrangentes mascaram subárvores
- Um path como `$.data` mascara o objeto inteiro. **Decisão:** é o poder/risco INERENTE do noise — o usuário declara explicitamente; a mitigação do design (blueprint D2) é "regras inspecionáveis + sentinela visível `"<noise>"`". Não é bug; documentado como tradeoff conhecido. Teste `mask_noise_nested_and_array_paths` exercita a granularidade.

### F-dom-3 (HIGH→documentado): colisão da sentinela `"<noise>"`
- Um body que contenha literalmente `"<noise>"` colide com a sentinela. **Decisão:** impacto real ínfimo (ninguém retorna esse literal); a sentinela visível é deliberada. Documentado; sentinela mais exótica é YAGNI.

## MEDIUM (documentados)

| ID | Finding | Decisão |
|---|---|---|
| F-dom-6 | runs aprovados (pinned) contam na janela de retenção → podem crescer | BY DESIGN: aprovados são pinados "forever" (EC-1/audit-trail-rotation); são os curados/valiosos. Crescimento de NÃO-aprovados é o que a retenção limita, e funciona |
| F-dom-5 | `stepCountChanged` compara só `min(len)`; step inserido no meio cascateia | `hasRegression` é forçado true (nada escondido); perda só de diagnóstico fino. Marcadores added/removed = M-futuro |
| F-arch-5 / F-tests-3 | log de prune cru / clamp comment overclaim | log estruturado adotado no fix; comentário alinhado |

## Cross-validation summary

5/5 tasks (T1.1-T4.1) MET; 7/7 gaps; 6 ADRs; 4 MUST-FIX (EC-1..EC-4) implementados E provados; sem plan drift.

### DoD do ROADMAP §M5 — SATISFEITO

| DoD | Evidência |
|---|---|
| #1 execuções históricas guardadas e comparáveis | `scenarioKey` + `findPreviousRun` (ordem total); E2E acha o anterior |
| #2 diff status/headers/body destacado na web | `diffRuns` + `renderDiff` + `GET /runs/:id/diff`; E2E "Mudança detectada"+"body mudou" |
| #3 normalização de voláteis INCL. body, regras inspecionáveis | `noise` jsonpath no cenário + `maskNoise` (sentinela visível) + `normalizeRun` headers; E2E: timestamp volátil suprimido |

Risco #1 (normalização esconder regressão) provado: E2E + fix F-dom-1 (noise assimétrico surface). Risco #2 (retenção): last-N + observável.

## Quality gates summary

- npm test: PASS (187 testes, 31 arquivos)
- tsc --noEmit: PASS (0 erros)
- npm audit: PASS (0 vulnerabilidades, ZERO dep nova)
- Coverage core: maskNoise 100% · diffRuns 96.55% · runHistory 94.87% lines (todos ≥90)
- code-quality: PASS_WITH_CAVEATS (0 HARD)
- DIP: `grep 'from "../web"|"../mcp"' src/core/` vazio

## Spawned agents (audit trail)

`.claude/agents/review-m5-regression-diff-2026-06-19/` — architecture, tests, wiring, cross-validation, domain-data-pipeline, domain-security (+ findings/*.yaml)

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER. Os 3 HIGH acionáveis (path-traversal na retenção, assimetria de noise escondendo regressão, observabilidade da poda) foram corrigidos com código+teste e re-validados; os 2 HIGH restantes (noise abrangente, colisão de sentinela) são tradeoffs conscientes do design de noise, documentados. M5 entrega regressão + anti-flaky fechando a limitação de body-noise do M3 — completa a V1 (M0-M5). Próximo passo (humano): `/release` (v0.6.0, minor).
