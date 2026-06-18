# Edge Case Review — m0-walking-skeleton (implementation plan)

Date: 2026-06-18
Plan: knowledge-base/plans/m0-walking-skeleton-plan.md (v1.0)
Tasks analyzed: 8 (T0.1, T1.1, T1.2, T1.3, T2.1, T3.1, T3.2, T4.1)
Edge cases found: 5 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: Path traversal em `GET /runs/:id` (web server)
- **Affected task:** T3.2
- **Family:** Input / Permission
- **Scenario:** o `:id` da URL é input do usuário e é interpolado no path do arquivo (`${dir}/${id}.json`). Um pedido `GET /runs/..%2f..%2f..%2fetc%2fpasswd%00` (ou `../../package.json`) faz `loadRun` ler/expor arquivos fora de `runs/`.
- **Impact:** leitura arbitrária de arquivos do host (information disclosure) — furo de segurança real, mesmo em uso local.
- **Suggested fix:** validar o `:id` contra um regex de UUID (`/^[0-9a-f-]{36}$/i`) antes de montar o path; id inválido → 400. (≤3 linhas: `if (!/^[0-9a-f-]{36}$/i.test(id)) { res.writeHead(400); return res.end('bad id'); }`)

## SHOULD TEST

### EC-2: `fetch` lança quando GET/HEAD recebe body
- **Affected task:** T1.2
- **Suggested test:** `test_execute_request_get_with_body_is_handled` — chamar `executeRequest({method:'GET', url, body:'x'})`; assert que ou o body é ignorado para GET/HEAD, ou um `RequestExecutionError` claro é lançado (não um `TypeError` cru do fetch vazando ao caller).

### EC-3: Headers multi-valor (ex. `Set-Cookie`) colapsam em `Record<string,string>`
- **Affected task:** T1.2, T3.1
- **Suggested test:** `test_execute_request_captures_repeated_headers` — alvo que envia dois `Set-Cookie`; assert que o valor capturado preserva ambos (a Headers API junta com `, `) e o render os mostra. Documentar a limitação se a junção for aceitável no M0.

## DOCUMENT

### EC-4: SSRF é inerente ao produto (fetch de URL arbitrária)
- **Accepted risk:** `run_request` executar qualquer URL é a função do produto (testar APIs). Em uso local single-user (ROADMAP Constraints), SSRF é risco aceito no M0; controles de egress/auth são escopo pós-V1 (out of scope declarado no ROADMAP: auth/multi-tenant). Registrar no plano, não bloquear.

### EC-5: corpo de resposta grande carregado inteiro em memória (`res.text()`)
- **Accepted risk:** já listado em `## Drawbacks & Risks` (severity Low) com mitigação em M2 (truncamento/lazy-load). Sem ação no M0.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.2 | 3 | 0 | 2 | 1 |
| T3.1 | 1 | 0 | 1 (compart.) | 0 |
| T3.2 | 1 | 1 | 0 | 0 |
| outros | 1 | 0 | 0 | 1 |

**Verdict:** PLAN NEEDS ADJUSTMENT (1 MUST FIX — EC-1 path traversal a absorver em T3.2; 2 testes SHOULD em T1.2/T3.1; 2 DOCUMENT)
