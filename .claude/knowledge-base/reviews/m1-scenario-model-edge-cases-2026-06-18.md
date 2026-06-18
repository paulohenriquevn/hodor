# Edge Case Review — m1-scenario-model (implementation plan)

Date: 2026-06-18
Plan: knowledge-base/plans/m1-scenario-model-plan.md (v1.0)
Tasks analyzed: 8 (T0.1, T1.1–T1.5, T2.1, T3.1, T4.1)
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: assert `header:<name>` deve casar case-insensitive (headers do fetch são lowercased)
- **Affected task:** T1.4
- **Family:** Input / Format
- **Scenario:** o M0 captura headers via `Object.fromEntries(res.headers)` → nomes **lowercased** (`content-type`). Um assert `{source:"header:Content-Type"}` faria `extractActual` procurar a chave `Content-Type` no mapa lowercased → `undefined` → assert SEMPRE falha (falso-negativo).
- **Impact:** todo assert de header com capitalização ≠ lowercase falha indevidamente — quebra o DoD "asserts sobre headers".
- **Suggested fix:** em `extractActual`, para `source` começando com `header:`, fazer `response.headers[name.toLowerCase()]` (lowercase do nome antes do lookup). Adicionar teste `eval_assert_header_case_insensitive`.

## SHOULD TEST

### EC-2: ops `contains`/`matches` sobre actual não-string (ex.: status numérico)
- **Affected task:** T1.4
- **Suggested test:** `eval_assert_contains_coerces_to_string` — `applyOp` deve `String(actual)` antes de `includes`/`RegExp.test`; assert `contains` sobre actual numérico não deve lançar.

### EC-3: `interpolate` em segmento de URL com valor que precisa de encoding
- **Affected task:** T1.2
- **Suggested test:** já previsto (`interpolate_request_encodes_url_value`) — garantir que valor capturado com `/`, espaço ou `?` seja `encodeURIComponent` ao entrar na URL, evitando quebrar a rota/abrir query. Confirmar que o teste cobre `/` e espaço.

## DOCUMENT

### EC-4: jsonpath multi-match → primeiro valor; variáveis flat (sem prefixo `captures.`)
- **Affected task:** T1.3, T1.2
- **Accepted risk:** (a) `evalCapture` pega o primeiro match do jsonpath (`[0]`) — suficiente para o caso dominante (id único); múltiplos matches → primeiro, documentado. (b) Variáveis são **flat** no M1 (`${{ id }}`, não `${{ captures.id }}` do step-ci) — KISS; o escopo de variáveis é o mapa de capturas top-level. Documentar no schema/README.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.2 | 2 | 0 | 1 | 1 (compart.) |
| T1.3 | 1 | 0 | 0 | 1 |
| T1.4 | 2 | 1 | 1 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT (1 MUST FIX — EC-1 header case-insensitive a absorver em T1.4; 2 SHOULD-TEST; 1 DOCUMENT)
