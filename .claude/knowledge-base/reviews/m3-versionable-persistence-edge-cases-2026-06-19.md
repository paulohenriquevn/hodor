# Edge Case Review — m3-versionable-persistence (implementation plan)

Date: 2026-06-19
Plan: knowledge-base/plans/m3-versionable-persistence-plan.md (v1.0)
Tasks analyzed: 5 (T1.1, T1.2, T1.3, T2.1, T3.1)
Edge cases found: 3 (MUST FIX: 1, SHOULD TEST: 0, DOCUMENT: 2)

## MUST FIX

### EC-1: ordem no POST pode deixar verdict órfão se o build/normalize do artefato falhar
- **Affected task:** T2.1
- **Family:** State
- **Scenario:** o plano faz `saveVerdict` → depois `loadRun` + `buildReviewArtifact` + `saveReviewArtifact`. Se `buildReviewArtifact`/`normalizeRun` lançar (bug ou run inesperado), o verdict JÁ foi gravado em `verdicts/` mas o artefato versionado NÃO existe — estado inconsistente (DoD #2 quer o verdict NO artefato versionado).
- **Impact:** verdict registrado sem o artefato versionável correspondente; o loop V1 fica "meio gravado".
- **Suggested fix:** reordenar — `loadRun` + `buildReviewArtifact(env, verdict)` **em memória PRIMEIRO** (o verdict já está montado antes de qualquer escrita); só então `saveVerdict` e `saveReviewArtifact`. Assim um erro de build/normalize aborta ANTES de gravar qualquer coisa (→ 500, nada órfão). Adicionar nota na T2.1.

## SHOULD TEST

(nenhum — EC-1 vira fix de ordem; os demais são DOCUMENT)

## DOCUMENT

### EC-2: `stableStringify` descarta chaves com valor `undefined` (semântica JSON)
- **Affected task:** T1.1
- **Accepted risk:** `JSON.stringify` ignora chaves `undefined`; o `sortKeys` reduce pode incluir a chave mas o stringify a descarta. Os artefatos são validados por zod (campos opcionais são omitidos, não `undefined`), então não há surpresa. Registrar.

### EC-3: verdict existe em DOIS lugares — `verdicts/` (M2, live) e `reviews/` (M3, versionado)
- **Affected task:** T1.3, T2.1
- **Accepted risk:** intencional. `verdicts/{id}.json` (M2) alimenta a UI ao vivo (selo/listagem via `loadVerdict`); `reviews/{id}.json` (M3) é o artefato versionável commitável que embute o verdict. Propósitos distintos; a fonte canônica versionada é `reviews/`. Registrar para não confundir como duplicação acidental.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 0 | 1 |
| T1.3 | 1 (compart.) | 0 | 0 | 1 |
| T2.1 | 1 | 1 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT (1 MUST FIX — EC-1 reordenar build-antes-de-salvar em T2.1; 2 DOCUMENT)
