# Review: m3-versionable-persistence

**Date:** 2026-06-19
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-data-pipeline, domain-security
**Findings:** 18 total (BLOCKER: 0, HIGH: 6, MEDIUM: 5, LOW: 7, INFO: muitos)
**Verdict:** READY_TO_MERGE (todos os 6 HIGH + MEDIUMs relevantes resolvidos; re-validado)

## Pré-condições

- `/code-quality` (re-audit pós-fixes): **PASS_WITH_CAVEATS** (0 HARD; só `symbol_fab_unverifiable_typescript` — falso-positivo conhecido de subpath do SDK MCP).
- Branch `develop`, árvore limpa, 113 testes verdes, `tsc` limpo, `npm audit` 0 vulns.

## HIGH findings — todos RESOLVIDOS antes do merge

### F-sec-1 (domain-security): vazamento de credencial no artefato commitável
- **File:** `src/core/normalizeRun.ts` · **Risco:** request headers (Authorization/Cookie/x-api-key) iam verbatim para `reviews/{id}.json` commitável → segredo no git/PR.
- **Resolução:** `redactRequestHeaders` + `SENSITIVE_REQUEST_HEADERS` redigem o VALOR (`<redacted>`), preservando a chave. Teste `normalize_run_redacts_sensitive_request_headers`. CHANGELOG § Security.

### F-xval-1 (cross-validation): leak de teste poluindo `reviews/` real
- **File:** `src/review-e2e.test.ts:27` · **Risco:** `buildWebServer` sem `reviewsDir` → POST verdict escrevia no `reviews/` do repo; `...aa.json` foi commitado; cada `npm test` sujava a árvore (viola pré-condição de RELEASE).
- **Resolução:** teste isola `reviewsDir` em tmpdir; `git rm --cached reviews/...aa.json`; `verdicts/`+`reviews/` confirmados fora da árvore suja.

### F-dom-1 (domain-data-pipeline): ruído de body não normalizado
- **File:** `src/core/normalizeRun.ts:56` · **Risco:** timestamp/uuid DENTRO do `response.body` quebra "diff estável" para JSON real.
- **Resolução:** **documentado** como limitação consciente (Implementation § Limitações conhecidas) — body-noise path-based exige config por-cenário inexistente, escopo M5. Wording do CHANGELOG ajustado (`steps` byte-idênticos, não o arquivo). Sem scope-creep (YAGNI).

### F-tests-1 (tests): artefato corrompido não exercido
- **Resolução:** `load_review_artifact_throws_on_corrupt_file` — cobre o branch de rethrow não-ENOENT (fail-loud).

### F-tests-2 (tests): `scenarioName` opcional sem cobertura
- **Resolução:** `build_review_artifact_omits_scenario_name_for_unnamed_run` — compat com run M0 sem `name`.

### F-tests-3 (tests): EC-1 (build antes de salvar) sem regressão
- **Resolução:** `post_verdict_invalid_value_is_400` reforçado — verdict inválido → 400 sem órfão de verdict NEM de artefato.

## MEDIUM findings

| ID | Finding | Resolução |
|---|---|---|
| F-sec-2 | runId do conteúdo do run não revalidado path-safe | `assertSafeRunId` antes do path-join + teste de traversal |
| F-dom-2 | VOLATILE_HEADERS incompleto (cloud/CDN/tracing) | ampliado + prefixos `x-amz-`/`x-amzn-`/`cf-` + teste |
| F-arch-5 | verdicts/ vs reviews/ ambos commitáveis | `verdicts/` gitignored; `reviews/` é o único canônico |
| F-dom-4 | "byte-determinístico" falso no nível de arquivo | wording honesto (steps byte-idênticos) |
| F-wire-2 | NormalizedStepSchema duplica tipo NormalizedStep | DRY leve; deferido (regra-de-3 não atingida) |

## LOW / INFO (aceitos)

- F-arch-6/7/8, F-wire-1/3/4/5, F-tests-4, F-dom-5/6, F-sec-3: itens informativos ou aceitos (export-for-test de `loadReviewArtifact` é o reader exercitado no E2E; `stableStringify` verificado genuinamente determinístico; prototype-pollution seguro; validação de fronteira no load OK).

## Cross-validation summary

5/5 tasks (T1.1–T3.1) FULLY_IMPLEMENTED; 17/17 acceptance criteria; 5/5 ADRs (D1–D5); 6/6 gaps da Coverage Matrix; sem plan drift.

### DoD do ROADMAP §M3 (FECHA O V1) — SATISFEITO

| DoD | Evidência |
|---|---|
| #1 arquivos texto estáveis/diff-amigáveis versionáveis | `stableStringify` (chaves ordenadas) + `normalizeRun` (timings + headers voláteis + prefixos); `reviews/` commitável; E2E prova `steps` idênticos |
| #2 verdict no artefato ligando cenário+execução | `ReviewArtifact{runId, scenarioName?, verdict, steps}`; E2E `verdict==approved` |
| #3 loop V1 em arquivos commitáveis | `e2e_v1_loop_writes_committable_review_artifact` verde; cadeia real run→POST→loadReviewArtifact |

## Quality gates summary

- npm test: PASS (113 testes, 21 arquivos)
- tsc --noEmit: PASS (0 erros)
- npm audit: PASS (0 vulnerabilidades, ZERO dep nova)
- Coverage core: 98.25% lines / 91.52% branch
- code-quality: PASS_WITH_CAVEATS (0 HARD)
- `git check-ignore`: reviews/ commitável ✓, verdicts/ + runs/ ignorados ✓

## Spawned agents (audit trail)

`.claude/agents/review-m3-versionable-persistence-2026-06-19/` — architecture, tests, wiring, cross-validation, domain-data-pipeline, domain-security (+ findings/*.yaml)

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER. Os 6 HIGH foram corrigidos (4 com código+teste, 1 documentado como limitação consciente de escopo M5, 1 leak de teste sanado) e re-validados. M3 fecha o V1: o loop agente→execução→revisão→verdict está em arquivos commitáveis com diff estável na camada de protocolo. Próximo passo (humano): `/release` (v0.4.0, fecha o V1).
