# Implementation Summary — m0-walking-skeleton

Date: 2026-06-18
Plan: knowledge-base/plans/m0-walking-skeleton-plan.md (v1.1, SHIPPABLE 98)
Promise: **IMPLEMENTATION_COMPLETE**

## Resultado

Loop E2E do M0 funcionando: agente chama `run_request` (MCP/stdio) → core executa via
`fetch` e captura request/response/headers → run persistido em `runs/{id}.json` (envelope
`{schemaVersion:1, steps[]}`) → web app (`http` nativo) renderiza. Métrica do Goal
(`e2e_run_request_persists_and_renders`) verde.

## Validação (Final Phase)

| Gate | Resultado |
|---|---|
| `npx vitest run` | 25 testes, 7 arquivos — **PASS** |
| `npx tsc --noEmit` | 0 erros — **PASS** |
| `npm audit` | 0 vulnerabilidades — **PASS** |
| Coverage (core) | 100% lines/functions; all files 98.3% — **PASS** (alvo ≥90%) |
| File size | máx 105 linhas (≤500) — **PASS** |
| Failure scenarios | 5xx capturado / connection-refused / timeout — 3/3 exercitados |

## Wiring triad por task

| Task | Caller (pillar a) | Integration test (pillar b) | Runtime metric (pillar c) |
|---|---|---|---|
| T0.1 scaffold | n/a (build) | `npm test` roda | n/a |
| T1.1 runSchema | usado por core/mcp/web | runSchema.test.ts (3) | n/a (tipo) |
| T1.2 executeRequest | chamado pela tool MCP (T2.1) | executeRequest.test.ts (7, vs http.Server) | timings.durationMs capturado |
| T1.3 runStore | persistRun/loadRun chamados por MCP+web | runStore.test.ts (4, tmpdir) | n/a |
| T2.1 MCP tool | handler `run_request` → core | server.test.ts (3, InMemoryTransport) | `getRunCount()` + log stderr |
| T3.1 renderRun | chamado pelo web server | render.test.ts (4) | n/a (puro) |
| T3.2 web server | loadRun+renderRun servidos via http | server.test.ts (3, incl. 404 + traversal) | n/a |
| T4.1 E2E | integra todas as camadas | e2e.test.ts (1) | exercita getRunCount no loop |

## Edge cases / segurança implementados

- **EC-1** path-traversal no `GET /runs/:id` → allowlist UUID → 400 (testado).
- **EC-2** GET-com-body → body não enviado, sem TypeError vazado (testado).
- **EC-3** Set-Cookie repetido → `getSetCookie()` preserva ambos (testado).
- **EC-4** SSRF → risco aceito/documentado (M0 local single-user).
- Logs do MCP só em stderr (stdout = protocolo). Erro de rede → `RequestExecutionError` tipado (fail-loud).

## Decisões do blueprint honradas

- D1 SDK v1.x estável (1.29.0 instalada, não alpha) · D2 fronteira DIP (core sem import de mcp/web) ·
  D3 envelope N-step desde já · D4 `fetch`/`http` nativos, sem framework · D5 logs stderr + métrica.

## Commits (develop)

`93ff990` scaffold · `061638f` core · `e96e789` mcp · `8038343` web · `2a425c9` e2e.

## Tooling fixes colaterais (CHANGELOG § Fixed)

- `discover-plan-thresholds.txt` (formato de banda pipe-delimited).
- `check_evidence_citations.py` (resolução de blueprint no layout `.claude/`).
