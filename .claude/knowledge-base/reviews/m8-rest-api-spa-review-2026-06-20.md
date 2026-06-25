# Review: m8-rest-api-spa

**Date:** 2026-06-20
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-api-design, domain-security
**Findings:** BLOCKER: 0 · HIGH: 5 · MEDIUM: ~8 · LOW: vários — todos os HIGH e os MEDIUM de paridade resolvidos antes do merge
**Verdict:** READY_TO_MERGE (após corrigir 5 HIGH + 4 MEDIUM de paridade; re-validado)

## Pré-condições

- `/code-quality` (re-audit pós-fixes): **PASS_WITH_CAVEATS** (0 hard cap; só `symbol_fab_unverifiable_typescript`, limitação conhecida do D2 offline em TS).
- Branch `develop`, árvore limpa, **303 testes verdes** (node + jsdom; era 245 pré-M8), typecheck duplo limpo, `npm audit` 0 vulns, `build:web` OK, SSR/MCP intactos.

## HIGH findings — RESOLVIDOS

### F-api-1 (api-design): `?vs=` inválido coagia silenciosamente para `previous` — RESOLVIDO
- `GET /api/runs/:id/diff?vs=bananas` retornava 200 reinterpretando como `previous` (viola validação de fronteira, CLAUDE.md §8). **Fix:** `vs ∉ {golden, previous, ausente}` → 400 `bad vs`; ausente → default `previous` explícito. Teste `api_diff_bad_vs_400` + `api_diff_vs_previous_default_mode`.

### F-api-2 (api-design): validação fraca do body do POST verdict + 400 opaco — RESOLVIDO
- `parsed.verdict as ...` dependia só do Zod downstream; erro 400 sem contexto. **Fix:** `VerdictInputSchema` dedicado (`z.enum`) valida na fronteira; 400 lista os `issues` (`invalid verdict (verdict: …)`). Teste `api_post_verdict_invalid_400_has_context` + `api_post_verdict_malformed_json_400`.

### F-tests-1/2/3 (tests): casos implementados mas não testados — RESOLVIDO
- 413 (body > 1MB), métrica de wiring `api_request`, e o toggle/`vs=previous` do diff estavam no código mas sem teste (o próprio plano os nomeava no TDD). **Fix:** `api_body_too_large_413`, `api_request_emits_structured_metric` (spy em console.error), `diff_view_previous_mode_and_step_count_changed`. A métrica de wiring (pillar c) agora tem prova.

## MEDIUM — paridade de leitura (DoD #2) — RESOLVIDOS

O cross-validation pegou o ponto mais importante: o contrato de paridade é "a SPA mostra a MESMA informação que o SSR, **não menos**". A SPA omitia, sem ADR:

| Omissão (vs `render.ts` SSR) | Fix |
|---|---|
| `response.timings.durationMs` por step | RunDetail mostra "{ms}" ao lado do status |
| **Captures** (variáveis capturadas — M1) por step | RunDetail `CapturesList` (paridade `capturesList`) |
| Provenance badge no detalhe (🤖 + sourceKind/Ref) | RunDetail `ProvenanceBadge` (paridade `provenanceBadge`) |
| Aviso M6.1 "aprovar run com asserts falhando → vira golden" | VerdictForm exibe o aviso (`role=status`) quando há assert falho e sem verdict |
| `diff.stepCountChanged` no diff | DiffView badge "número de steps mudou" |

Provado por `run_detail_renders_timing_captures_provenance`, `run_detail_status_color_by_class`, `verdict_form_warns_on_failing_asserts`.

## LOW — RESOLVIDOS

- `RUN_ID_RE` duplicado em `web/server.ts` → importa do core (DRY real, fonte única com API).
- 500 vazava `e.message` ao cliente → loga `api_error` no servidor + corpo genérico "internal error".
- api-client descartava o `{error}` do servidor → agora surfaça a mensagem contextual.
- `api_client_post_verdict` agora asserta o body+headers enviados.

## MEDIUM/LOW aceitos (documentados — modelo de ameaça loopback single-user)

| ID | Finding | Decisão |
|---|---|---|
| api-design | `HEAD` em rota GET → 405 (RFC: GET implica HEAD) | aceito — a SPA só usa GET/POST; bind loopback; sem custo de produto no V3 |
| api-design | sem `OPTIONS`/preflight CORS | aceito — same-origin (prod serve a SPA do mesmo Node); `setApiBase` é só harness de teste |
| api-design | métrica em stderr (não stdout) | aceito — consistência com os outros adaptadores (mcp/web logam em stderr) |
| api-design | sem `Cache-Control` em assets hasheados | aceito — uso local; otimização é polish do M13 |
| cross-val | badge de regressão na lista não é link (SSR linka p/ diff) | aceito — o diff é alcançável do detalhe; afetação mínima |

## Avaliação positiva dos agentes

- **Security:** 0 BLOCKER/HIGH/MEDIUM. Path-traversal SAFE (verificado empiricamente: `node:http` não decoda `%2f`; `RUN_ID_RE`/`DRAFT_ID_RE` + confinamento `startsWith(root+sep)`). Sem regressão M7 (API só lê artefatos já redigidos; log sem body/segredo). Sem XSS (JSX escapa; zero `dangerouslySetInnerHTML`). Sem SSRF (API só lê do filesystem). Body cap 413. Bind loopback.
- **Architecture:** DIP limpo — API delega 100% ao core; o browser só importa `import type` + o módulo browser-safe `contentType.ts`. `buildListing` unifica `listRuns` (DRY real, sem duplicação residual). JSON vs estáticos separados (SRP).
- **Wiring:** zero export órfão — todos os 7 endpoints têm caller de produção na SPA (drafts→`DraftListPage`, reviews→`ReviewArtifactLink`); triad satisfeito.

## DoD do ROADMAP §M8 — SATISFEITO

| DoD | Evidência |
|---|---|
| #1 API REST expõe runs/diff/verdict/drafts/reviews, delega ao core | `src/api/server.ts` (7 rotas, ZERO regra de domínio); `server.test.ts` cobre 200/201/400/404/405+Allow/413/path-traversal; drafts/reviews com caller de produção |
| #2 SPA paridade de leitura (lista, detalhe req/resp/headers, asserts, golden, regressão, diff) | SPA mostra a MESMA informação do SSR — incl. timing, captures, provenance, aviso M6.1, stepCountChanged (gaps fechados) |
| #3 E2E loop de revisão na SPA; SSR vivo | `e2e_m8_review_loop_parity_in_spa` (lista→detalhe→verdict contra API real, verdict verificado no disco); `npm run web` (SSR) responde 200 |

## Quality gates summary

- npm test: PASS (303 testes, 50 arquivos — node + jsdom)
- typecheck: PASS (backend NodeNext + web bundler) · npm audit: PASS (0 vulns)
- build:web: PASS (`web/dist`) · SSR (`src/web`) + MCP (`src/mcp`) intactos
- code-quality: PASS_WITH_CAVEATS (0 hard cap)
- Wiring triad por endpoint: caller (SPA) + integration test + métrica (`api_request`) ✓

## Spawned agents (audit trail)

6 agentes (architecture, tests, wiring, cross-validation, domain-api-design, domain-security) executados em paralelo via Agent tool.

## Handoff decision

**READY_TO_MERGE.** Os 5 HIGH (validação de `vs`, validação do verdict, 3 gaps de teste) e os 4 MEDIUM de paridade (timing/captures/provenance/aviso M6.1) foram corrigidos com código + teste e re-validados; os MEDIUM/LOW de semântica HTTP foram conscientemente aceitos sob o modelo loopback single-user (documentados acima). M8 entrega a fundação do V3 — API REST + SPA React com paridade real de revisão — sem regredir segurança nem o SSR. Próximo passo (humano): `/release` (release sozinho — lição do v0.6.0/v0.7.0).
