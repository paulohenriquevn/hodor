# Discover Edge Case Review — m3-versionable-persistence

Date: 2026-06-19
Discovery plan analyzed: knowledge-base/discoveries/plans/m3-versionable-persistence-plan.md
Research questions analyzed: 6
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 2)

Reference-path pre-check: **10/10 cited paths exist** (verified via `test -e`). No fabricated citations.

## MUST FIX

(nenhum)

## SHOULD TEST

### EC-1: definir O QUE é versionado — artefato de review, não todo run bruto
- **Affected question:** Q6
- **Suggested halt-loop checkpoint:** o execute DEVE deixar explícito que o artefato VERSIONÁVEL é o **artefato de review** (cenário + run normalizado + verdict), NÃO todo run bruto. Commitar cada run cru geraria ruído de git (campos voláteis + volume). O blueprint recomenda: `runs/` permanece efêmero/gitignored (run bruto); um diretório commitável (ex. `reviews/`) recebe o artefato normalizado+verdict, produzido sob demanda (ex. ao registrar o verdict). Sem isso, o DoD "diff-amigável" é minado por volume/ruído.

## DOCUMENT

### EC-2: noise do keploy é p/ COMPARAÇÃO; o M3 usa o CONCEITO p/ NORMALIZAÇÃO
- **Affected question:** Q1
- **Accepted risk:** o `JSONDiffWithNoiseControl` do keploy compara dois runs ignorando noise (regressão). O M3 NÃO compara — usa o CONCEITO (lista de campos voláteis) para PRODUZIR um artefato normalizado estável. O execute deve traduzir "noise na comparação" → "strip/mask de campos voláteis na serialização do artefato", não portar o comparador. Comparação run-vs-run é M5 (D3 do plano). Registrar.

### EC-3: YAML (bruno/keploy) vs JSON (Hodor) — manter JSON
- **Affected question:** Q5
- **Accepted risk:** bruno (`yaml ^2.3.4`) e keploy (yaml.v3) serializam em YAML. O Hodor é JSON em tudo (envelope, cenário, verdict). Manter **JSON com chaves ordenadas** (texto estável, diff-amigável, `JSON.stringify` nativo — sem dep de YAML; Rule 9/parsimony rung 2). O execute recomenda JSON determinístico, não adotar YAML. Registrar.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 0 | 0 | 1 |
| Q5 | 1 | 0 | 0 | 1 |
| Q6 | 1 | 0 | 1 | 0 |

**Verdict:** DISCOVERY PLAN OK (1 checkpoint EC-1 a absorver em Q6; 2 DOCUMENT registrados)
