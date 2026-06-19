# Review: m2-review-webapp

**Date:** 2026-06-18
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-api-design, domain-security
**Plan:** knowledge-base/plans/m2-review-webapp-plan.md (v1.1, SHIPPABLE_WITH_CAVEATS 89)
**Code-quality gate:** PASS_WITH_CAVEATS (0 HARD)
**Verdict:** **READY_TO_MERGE**

## Findings (consolidado)

Inicial: BLOCKER 0 · HIGH 3 · MEDIUM ~6 · LOW ~12 · INFO ~8.
Após correções (commit `fe0c25e`): **BLOCKER 0 · HIGH 0** · MEDIUM/LOW restantes documentados.

### HIGH resolvidos antes do merge

| ID | Achado | Correção |
|---|---|---|
| F-arch-1 | `postVerdict` com `catch {}` cego mapeava QUALQUER falha (incl. I/O) para 400 | catch só `ZodError` → 400; erro de I/O sobe → 500 (Rule 8 — diferenciar recuperável/irrecuperável) |
| F-dom-1 | body > 1 MB → 500 (deveria 413 por RFC 9110) | `PayloadTooLargeError` → **413**; `readBody` drena o restante para a resposta sair |
| F-tests-1 | `vitest.config` excluía `src/**/server.ts` da cobertura → web/server.ts (74% branch) invisível no gate | exclusão reduzida a `src/mcp/server.ts` (entrypoint stdio); web/server.ts agora medido (83% honesto) |

### Outros corrigidos antes do merge

| ID | Sev | Achado | Correção |
|---|---|---|---|
| F-sec-5 | LOW (premissa crítica) | `server.listen(port)` bind em 0.0.0.0 — mina o threat model "local single-user" sob o qual os riscos aceitos (CSRF, leak 500) se apoiam | `listen(port, "127.0.0.1")` — bind loopback explícito |
| F-dom-2 | MED | rota inexistente retornava 405 (deveria 404) | roteamento resolve a rota antes do método; path desconhecido → 404 |
| F-dom-3 | MED | `:id` não validado no ramo 405 do verdict (contrato contraditório com POST) | `:id` validado (RUN_ID_RE) antes do método nos dois ramos |
| F-tests-2 | MED | mitigação do risco #2 (binário/truncado) só testada no helper, não no HTML | testes `render_run_omits_binary_body` + `render_run_truncates_large_text_body` |
| F-sec-1 | LOW | `escapeHtml` não escapava aspas simples (atributos single-quoted) | adiciona `'` → `&#39;` |
| F-arch-2 / F-dom-6 | LOW | CSS de listing duplicado/morto no `<style>` do renderRun | removido |

### MEDIUM/LOW aceitos como caveat / follow-up (não bloqueiam)

| ID | Achado | Decisão |
|---|---|---|
| F-wire-1/2 | `VerdictSchema`/`escapeHtml` re-exportados sem consumidor externo | Mantidos como superfície pública (consistente com RunEnvelopeSchema); cleanup opcional via code-quality D3 |
| F-tests-3/4 | branches `javascript`/`+xml` do pickRenderer; `decidedAt` wall-clock (não injetado) | Aceito M2; injeção de clock no POST é melhoria de testabilidade p/ M3 |
| F-arch-3 | `listRuns` concentra responsabilidades; `passFail` é domínio no adaptador | Aceito M2 (KISS); `passFail` sobe ao core no M3 |
| F-dom-4/5 | `URLSearchParams.get` silencioso em multi-value; textarea sem aria-label/maxlength | LOW; follow-up de a11y/robustez |
| F-sec-2, F-dom-7 | 500 ecoa `err.message`; cadeia de if de rotas não escala p/ M3/M4 | Aceito local; tabela de rotas declarativa é refactor de M3+ |

## Cross-validation (plano vs implementação)

| Métrica | Resultado |
|---|---|
| Tasks do plano | 6 (T1.1–T3.1) |
| FULLY implementadas | 6/6 |
| PARTIAL/MISSING/DIVERGED | 0 |
| Coverage Matrix | 7/7 gaps resolvidos |
| ADRs D1–D5 | 5/5 respeitados |
| Plan drift | nenhum (plano congelado antes do 1º commit) |
| Backward-compat M0/M1 | preservada (envelope name aditivo; renderRun verdict opcional; run_request/run_scenario verdes) |
| Goal (`e2e_review_lists_renders_and_records_verdict`) | verde |

## DoD do ROADMAP §M2 (validado pelo cross-validation)

| DoD | Satisfeito | Evidência |
|---|---|---|
| (1) Lista cenários/execuções + por step req/resp/headers + asserts/resultado | ✓ | `renderListing` + `renderRun` (request/response/asserts) |
| (2) Humano registra verdict (aprovado/rejeitado + nota) persistido | ✓ | `POST` → `saveVerdict` → `verdicts/{id}.json`; E2E prova `loadVerdict==approved` |
| (3) Pass/fail por assert visualmente evidente | ✓ | `assertsTable` ✓/✗ verde/vermelho + selo de resumo na listagem |

## Quality gates (re-validação)

| Gate | Resultado |
|---|---|
| `npx vitest run` | 91/91 — **PASS** |
| `npx tsc --noEmit` | 0 erros — **PASS** |
| Coverage | overall 91.13% · verdict.ts 92.3% · render.ts 95.2% (server.ts 83% honesto, antes oculto) — **PASS** |
| `npm audit` | 0 vulnerabilidades (ZERO dep nova) — **PASS** |
| XSS | todo `${}` dinâmico (note, name, headers, body de API externa) escapado — **PASS** |
| Fronteira DIP | verdict store no core; web não importa core→web; ZERO framework — **PASS** |

## Spawned agents (audit trail)

- .claude/agents/review-m2-review-webapp-2026-06-18/{architecture,tests,wiring,cross-validation,domain-api-design,domain-security}.md

## Handoff decision

**READY_TO_MERGE** — 0 BLOCKER, 0 HIGH (3 HIGH + F-sec-5 crítico + MEDIUMs de roteamento corrigidos antes do merge). MEDIUM/LOW restantes são caveats explícitos aceitos (M2 local single-user) ou follow-ups M3+. Próximo passo: `/release` (corte develop→main, gate de aprovação humana — Regra 4).
