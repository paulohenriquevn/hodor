# Discover Edge Case Review — m1-scenario-model

Date: 2026-06-18
Discovery plan analyzed: knowledge-base/discoveries/plans/m1-scenario-model-plan.md
Research questions analyzed: 6
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 2)

Reference-path pre-check: **13/13 cited paths exist** (verified via `test -e`). No fabricated citations.

## MUST FIX

(nenhum — plano estruturalmente sólido)

## SHOULD TEST

### EC-1: A lib npm de jsonpath não é citável das referências (step-ci runner externo)
- **Affected question:** Q5
- **Suggested halt-loop checkpoint:** Q5 pode citar SÓ o crate jsonpath próprio do hurl (Rust) como evidência de "como" (own-impl vs lib). A escolha da **lib npm de jsonpath** para o Hodor NÃO tem citação local (o `@stepci/runner` não está vendorizado). O execute deve registrar a recomendação como **decisão de plan-phase** (a ser fixada no `/to-plan` e CVE-checada no `/deps-audit`), explicitamente NÃO como citação de referência. Nunca fabricar "step-ci usa a lib X".

## DOCUMENT

### EC-2: Não copiar a superfície completa do step-ci (plugins/grpc/graphql/fakedata)
- **Affected question:** Q1
- **Accepted risk:** step-ci tem muitos recursos (plugins, grpc, graphql, fakedata, cookies). M1 precisa só de: steps ordenados + captures(jsonpath) + asserts(status/headers/body) + interpolação de variáveis. Adotar o resto é YAGNI; o blueprint deve recomendar o subconjunto mínimo. Registrar, não bloquear.

### EC-3: hurl é Rust — padrões são conceituais, não portáveis linha-a-linha
- **Affected question:** Q2, Q3
- **Accepted risk:** o pipeline de captura e os tipos de predicado do hurl são referência de DESIGN; a implementação do Hodor é TS com lib jsonpath. O blueprint deve traduzir conceitos (query→filtros→valor; predicado→pass/fail+expected/actual), não transliterar Rust. Registrar.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 0 | 0 | 1 |
| Q2 | 1 (compart.) | 0 | 0 | 1 |
| Q3 | 0 | 0 | 0 | 0 |
| Q5 | 1 | 0 | 1 | 0 |

**Verdict:** DISCOVERY PLAN OK (1 checkpoint EC-1 a absorver; 2 DOCUMENT registrados)
