# Edge Case Review — m2-review-webapp (implementation plan)

Date: 2026-06-18
Plan: knowledge-base/plans/m2-review-webapp-plan.md (v1.0)
Tasks analyzed: 6 (T1.1, T1.2, T1.3, T2.1, T2.2, T3.1)
Edge cases found: 4 (MUST FIX: 2, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX

### EC-1: nota do verdict (input do humano) renderizada → XSS armazenado
- **Affected task:** T2.2
- **Family:** Input / Security
- **Scenario:** o humano digita a `note` no form de verdict; ela é persistida e depois RENDERIZADA na página do run (selo de verdict) e na listagem. Se renderizada crua, `note = "<script>...</script>"` executa (stored XSS).
- **Impact:** XSS armazenado — toda vez que alguém abre o run/listagem, o script roda.
- **Suggested fix:** o render do verdict (selo + listagem) DEVE passar a `note` (e o `verdict`) por `escapeHtml` (já existe no `render.ts`). Adicionar teste `render_verdict_escapes_note`.

### EC-2: run corrompido em `runs/` quebra a listagem inteira
- **Affected task:** T2.1
- **Family:** State / Resource
- **Scenario:** `listRuns` faz `loadRun` por arquivo; `loadRun` LANÇA em JSON inválido/schema incompatível (fail-loud do M0). Um único arquivo corrompido em `runs/` faz a listagem inteira dar 500 — o revisor perde acesso a TODOS os runs.
- **Impact:** um arquivo ruim derruba a página de listagem toda (disponibilidade).
- **Suggested fix:** em `listRuns`, envolver o `loadRun` de cada arquivo em try/catch; arquivo inválido → pular (ou listar como "(inválido: {file})"), NÃO propagar. A página do run individual (`/runs/:id`) mantém o fail-loud (500) — lá o erro é específico daquele run. Adicionar teste `listing_skips_corrupt_run_file`.

## SHOULD TEST

### EC-3: POST verdict com campo `verdict` ausente/vazio
- **Affected task:** T2.2
- **Suggested test:** `post_verdict_missing_field_is_400` — body sem `verdict=` → `VerdictSchema.parse` lança (enum exige approved/rejected) → 400; nada gravado. (Cobre body vazio também.)

## DOCUMENT

### EC-4: sem CSRF token no POST de verdict
- **Affected task:** T2.2
- **Accepted risk:** já listado em `## Drawbacks & Risks` (severity Medium). Uso local single-user (ROADMAP Constraints); origem é o operador no browser local. Hardening (token CSRF / SameSite) é follow-up se a app for exposta a rede. Registrar, não bloquear.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T2.1 | 1 | 1 | 0 | 0 |
| T2.2 | 3 | 1 | 1 | 1 |

**Verdict:** PLAN NEEDS ADJUSTMENT (2 MUST FIX — EC-1 escapar note/verdict no render; EC-2 listagem tolera run corrompido; 1 SHOULD-TEST; 1 DOCUMENT já no plano)
