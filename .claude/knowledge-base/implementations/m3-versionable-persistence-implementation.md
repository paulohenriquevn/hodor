# Implementation Summary — m3-versionable-persistence

Date: 2026-06-19
Plan: knowledge-base/plans/m3-versionable-persistence-plan.md (v1.1, SHIPPABLE_WITH_CAVEATS 89)
Promise: **IMPLEMENTATION_COMPLETE**

## Resultado

Persistência versionável do M3 (fecha o V1): ao registrar um verdict, o sistema escreve
`reviews/{runId}.json` — cenário + run normalizado + verdict — serializado deterministicamente
(`stableStringify`) com campos voláteis removidos (`normalizeRun`), validado por zod
(`artifactVersion:1`). `reviews/` é commitável; `runs/` (bruto) permanece efêmero. Métrica do Goal
(`e2e_v1_loop_writes_committable_review_artifact`) verde: dois runs do mesmo cenário com voláteis
diferentes geram artefatos com `steps` idênticos (diff estável).

## Validação (Final Phase)

| Gate | Resultado |
|---|---|
| `npx vitest run` | 108 testes, 21 arquivos — **PASS** |
| `npx tsc --noEmit` | 0 erros — **PASS** |
| `npm audit` | 0 vulnerabilidades (ZERO dep nova) — **PASS** |
| Coverage core | 98.11% lines (reviewArtifact 93.33%; stableStringify/normalizeRun testados) — **PASS** |
| `git check-ignore reviews/` | não-ignorado (commitável) — **PASS** |
| File size | máx 268 linhas (≤500) — **PASS** |
| Backward-compat M0/M1/M2 | run_request/run_scenario/listagem/verdict verdes |

## Wiring triad por task

| Task | Caller (pillar a) | Integration test (pillar b) | Observável (pillar c) |
|---|---|---|---|
| T1.1 stableStringify | reviewArtifact.save usa | stableStringify.test.ts (4) | bytes estáveis |
| T1.2 normalizeRun | buildReviewArtifact usa | normalizeRun.test.ts (5) | run normalizado |
| T1.3 reviewArtifact | POST handler chama build+save | reviewArtifact.test.ts (5) | reviews/{id}.json |
| T2.1 POST escreve artefato | POST /runs/:id/verdict (caller de produção) | server.test.ts (2 M3) | artefato persistido |
| T3.1 E2E V1 | integra web+core | v1-e2e.test.ts (1) | loadReviewArtifact + diff estável |

## DoD do ROADMAP §M3 (validado)

| DoD | Evidência |
|---|---|
| (1) Arquivos texto estáveis/diff-amigáveis, versionáveis | `stableStringify` (chaves ordenadas) + `normalizeRun` (sem voláteis) + `reviews/` não-gitignored |
| (2) Verdict gravado no artefato versionado, ligando cenário+execução | `ReviewArtifact{runId, scenarioName?, verdict, steps}`; E2E prova `loadReviewArtifact().verdict==approved` |
| (3) Loop V1 em arquivos commitáveis | E2E `e2e_v1_loop_writes_committable_review_artifact`: run→verdict→reviews/{id}.json commitável; 2 runs → diff estável |

## Edge cases / decisões honradas

- **EC-1** ordem build-antes-de-salvar: artefato montado+validado em memória ANTES de gravar (verdict inválido → 400 sem órfão).
- **EC-2** stableStringify descarta chaves undefined (semântica JSON; artefatos zod-validados).
- **EC-3** verdict em `verdicts/` (live) + `reviews/` (versionado) — propósitos distintos, intencional.
- ADRs D1–D5 honrados (artefato separado; normalizeRun strip; stableStringify nativo; artifactVersion; escrito ao registrar verdict). Comparação run-vs-run = M5 (fora de escopo).

## Backward-compatibility
- `normalizeRun`/`reviewArtifact` reusam `RunEnvelope`/`Verdict` sem mudança de schema.
- `POST /runs/:id/verdict` mantém 303; só adiciona a escrita do artefato.

## Commits (develop)
`1582c47` core (stableStringify+normalizeRun+reviewArtifact) · `f9a8f4c` web (POST escreve artefato) · `d0aaf00` e2e+CHANGELOG.
