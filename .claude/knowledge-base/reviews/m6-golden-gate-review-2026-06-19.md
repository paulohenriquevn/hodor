# Review: m6-golden-gate

**Date:** 2026-06-19
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-api-design, domain-security
**Findings:** 26 total (BLOCKER: 0, HIGH: 6, MEDIUM: vários, LOW/INFO: vários)
**Verdict:** READY_TO_MERGE (0 BLOCKER; os 5 HIGH acionáveis corrigidos+re-validados; 1 HIGH de segurança documentado como vetor conhecido)

## Pré-condições

- `/code-quality` (re-audit pós-fixes): **PASS_WITH_CAVEATS** (0 HARD; só `symbol_fab_unverifiable_typescript`).
- Branch `develop`, árvore limpa, 217 testes verdes, `tsc` limpo, `npm audit` 0 vulns, ZERO dep nova, DIP limpo.

## HIGH findings

### F-arch-1 (architecture): listagem O(N²) — RESOLVIDO
- `listRuns` chamava `findGoldenRun` por run, e cada chamada re-escaneava `runs/` inteiro. **Resolução:** carrega os runs UMA vez + `findGoldenRunIn(runs, key, …)` (helper sobre runs pré-carregados). Dashboard volta a O(N).

### F-dom-1 + F-dom-4 (domain-api): gate cego/não-acionável — RESOLVIDO
- `check_scenario` descartava `noiseChanged` e não dava como buscar o diff. **Resolução:** outputSchema agora inclui `noiseChanged` (mesmo em `ok`, sinaliza noise divergente — F-dom-1) e `goldenRunId` (o agente busca o diff completo via `/runs/:id/diff?vs=golden` — F-dom-4). Teste `check_scenario_tool_detects_regression` assere `goldenRunId`.

### F-dom-2 (domain-api): falso senso de cobertura da suíte — RESOLVIDO
- Catálogo = `drafts/`; cenários aprovados sem draft ficavam fora, mas `allOk:true` era silencioso. **Resolução:** `replaySuite` reporta `uncataloguedGoldens` (`goldenScenarioKeys` ∖ catálogo). Teste `replay_suite_reports_uncatalogued_goldens`.

### F-tests-2 (tests): claim central D2 sem teste — RESOLVIDO
- Nenhum teste provava que `checkScenario` RE-RODA e recaptura tokens frescos (a justificativa de não-pure-replay). **Resolução:** `check_scenario_recaptures_inter_step_token_freshly` — cenário 2-step (login→captura token→/me); o golden tem `tok-1`, o check recaptura `tok-2` fresco. Regressão p/ pure-replay falharia agora.

### F-dom-sec-1 (domain-security): SSRF via draft commitável — DOCUMENTADO
- `replay_suite` re-executa drafts de `drafts/` (commitável) → draft malicioso de terceiro dispara requests arbitrários. **Decisão:** vetor real mas dentro do threat model atual (single-user, agente confiável); documentado em CHANGELOG § Security ("não execute replay_suite sobre drafts não-confiáveis"); mitigação técnica (allowlist de hosts) é candidata ao M7. Espelha a honestidade do teto sem-auth.

## MEDIUM (resolvidos/documentados)

| ID | Finding | Decisão |
|---|---|---|
| F-wire-1 | counters getCheckCount/getReplayCount mortos | assertions adicionadas (`*_increments_metric`) |
| F-dom-5 | `catch{}` engolia a causa do erro | `SuiteItemResult.error` carrega a razão; teste dedicado |
| F-tests-1 | mensagem "primeiro run" confundia "sem golden" | `renderDiff` golden-aware ("sem baseline aprovado") |
| F-dom-3 | gate diz `ok` p/ serviço both-broken | documentado (gate = regressão, não correção); asserts visíveis no run |
| F-dom-6/F-dom-7 | replay não persiste run; results[] fora do outputSchema | aceitos (check_scenario persiste; results no core p/ a web) |

## Cross-validation summary

6/6 tasks (T1.1-T6.1) PASS; 7/7 gaps; 6/6 ADRs; 27 acceptance criteria; sem plan drift.

### "Fechar o loop" — É REAL

O agente CONSOME a aprovação: `check_scenario` devolve `{status, runId, goldenRunId, noiseChanged}` estruturado, calculado vs o golden APROVADO (`loadVerdict==="approved"`). E2E `e2e_m6_check_scenario_gates_on_golden` verde prova: no_baseline → humano aprova → ok → serviço muda → regression → replay agrega → web diff vs golden → `verdicts/` intacto (nenhuma tool grava verdict; contrato M2 preservado).

### DoD do ROADMAP §M6 — SATISFEITO

| DoD | Evidência |
|---|---|
| #1 findGoldenRun (aprovado mais recente) | filtra `approved`; ignora rejected/outros; 4 testes |
| #2 check_scenario sem auto-aprovar | core + tool; provado em 2 níveis que não grava verdict |
| #3 replay de suíte agregado | replaySuite + tool; isolamento EC-1; uncataloguedGoldens |
| #4 web vs golden + listagem marca regressões | rota `?vs=golden` + badge ⚠ regressão |

## Quality gates summary

- npm test: PASS (217 testes, 35 arquivos)
- tsc --noEmit: PASS · npm audit: PASS (0 vulns, ZERO dep nova)
- Coverage core: checkScenario 100% · replaySuite ~100% lines · runHistory 94.23% lines
- code-quality: PASS_WITH_CAVEATS (0 HARD) · DIP limpo

## Spawned agents (audit trail)

`.claude/agents/review-m6-golden-gate-2026-06-19/` — architecture, tests, wiring, cross-validation, domain-api-design, domain-security (+ findings/*.yaml)

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER. Os 5 HIGH acionáveis (perf O(N²), gate cego a noiseChanged, gate não-acionável sem goldenRunId, falso senso de cobertura, claim D2 não-testado) foram corrigidos com código+teste e re-validados; o HIGH de segurança (SSRF via draft commitável) é um vetor conhecido documentado dentro do threat model atual, com mitigação candidata ao M7. M6 fecha o loop do V1 — o agente passa a consumir a aprovação. Próximo passo (humano): `/release`.
