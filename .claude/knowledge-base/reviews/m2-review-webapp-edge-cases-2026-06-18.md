# Discover Edge Case Review — m2-review-webapp

Date: 2026-06-18
Discovery plan analyzed: knowledge-base/discoveries/plans/m2-review-webapp-plan.md
Research questions analyzed: 6
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 2)

Reference-path pre-check: **7/7 cited paths exist** (verified via `test -e`). No fabricated citations.

## MUST FIX

(nenhum)

## SHOULD TEST

### EC-1: hoppscotch NÃO tem unit spec dos lenses — só `lenses.sample` (fixture)
- **Affected question:** Q4 (tests corner)
- **Suggested halt-loop checkpoint:** o Glob `__tests__/*.spec.ts` retornará VAZIO (só existe `__tests__/lenses.sample`, 2KB). Q4 deve então: (a) ler `lenses.sample` para entender a forma do fixture, e (b) registrar HONESTAMENTE que a seleção de lens do hoppscotch é coberta por fixture/snapshot, não por unit spec dedicado. NÃO fabricar um "padrão de teste de lens" inexistente. A recomendação para o Hodor é o oposto: adicionar um unit test próprio de `pickRenderer` (content-type → renderer), já que a ref não tem.

## DOCUMENT

### EC-2: renderers são `.vue` (framework-bound) — adotar conceito, não código
- **Affected question:** Q1, Q2, Q3
- **Accepted risk:** os renderers (`components/lenses/renderers/*.vue`) e o `Card.vue` são Vue. O Hodor não tem Vue (e a decisão D1 do blueprint provavelmente será native-server-rendered). O execute deve extrair o CONCEITO (dispatch por content-type; campos de um item de listagem), traduzindo para o `render.ts` server-side — nunca portar/transliterar Vue. Já coberto nos checkpoints do plano; reafirmado.

### EC-3: verdict não tem citação de referência
- **Affected question:** (transversal)
- **Accepted risk:** nenhuma ref clonada tem "humano aprova/rejeita execução". O modelo do verdict é design do Hodor (ADR D3 do plano), proposto no blueprint e fixado no `/to-plan` — marcado como NÃO-citável. Honestidade (Regra 3): não inventar citação de verdict.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1/Q2/Q3 | 1 | 0 | 0 | 1 (EC-2 compart.) |
| Q4 | 1 | 0 | 1 | 0 |
| (verdict) | 1 | 0 | 0 | 1 |

**Verdict:** DISCOVERY PLAN OK (1 checkpoint EC-1 a absorver em Q4; 2 DOCUMENT reafirmados)
