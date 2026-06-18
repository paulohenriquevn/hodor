# Discover Edge Case Review — m0-walking-skeleton

Date: 2026-06-18
Discovery plan analyzed: knowledge-base/discoveries/plans/m0-walking-skeleton-plan.md
Research questions analyzed: 6
Edge cases found: 3 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 0)

Reference-path pre-check: **14/14 cited paths exist** (verified via `test -e`). No fabricated citations in the plan.

## MUST FIX

### EC-1: Import do quickstart usa alias interno do monorepo, não o pacote publicado
- **Affected question:** Q1, Q5
- **Family:** Interpretation / Citation
- **Scenario:** `examples/server-quickstart/src/index.ts` importa `from '@modelcontextprotocol/server'` e `from 'zod/v4'`. Esses são aliases do workspace do monorepo do SDK — NÃO o que um consumidor externo instala. O M0 vai `npm install @modelcontextprotocol/sdk` e importar de um caminho publicado (historicamente `@modelcontextprotocol/sdk/server/mcp.js`). Se o blueprint copiar literalmente o import do exemplo, o `npm install` do M0 quebra.
- **Impact:** Blueprint recomenda um import path inexistente para o consumidor → primeira linha de código do M0 falha no `import`.
- **Suggested fix:** Em Q5, adicionar ao método: "ler o `name` e o mapa `exports` do `knowledge-base/references/mcp-typescript-sdk/package.json` para registrar o **nome do pacote publicado e os entrypoints reais de import**, não o alias do workspace". O blueprint deve citar o import publicado, marcando o alias do exemplo como detalhe interno do monorepo.

## SHOULD TEST

### EC-2: hoppscotch-data tem ~18 schemas versionados — risco de scope creep ao ler todos
- **Affected question:** Q3
- **Suggested halt-loop checkpoint:** Antes de iterar Q3, limitar a leitura a `rest/v/0.ts` (versão base), ao `index.ts` que encadeia/migra versões, e à versão mais alta presente (para ver a forma final). NÃO ler todos os `v/N.ts` — o padrão de migração se entende com 2–3 amostras. Marcar a leitura exaustiva como fora de escopo.

### EC-3: Exemplos do SDK podem não ter teste dedicado da execução de tool
- **Affected question:** Q4
- **Suggested halt-loop checkpoint:** Se o Glob por `**/*.test.ts`/`**/*.spec.ts` em `examples/server/` retornar vazio, cair para o diretório de testes do core do SDK (procurar `**/*.test.ts` sob `knowledge-base/references/mcp-typescript-sdk/` excluindo `examples/`) e citar de lá. Bruno tem testes no `bruno-cli`/`bruno-tests`; o lado MCP é o que tem risco de exemplos sem teste.

## DOCUMENT

(nenhum)

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 (compart. c/ Q5) | 0 | 0 | 0 |
| Q2 | 0 | 0 | 0 | 0 |
| Q3 | 1 | 0 | 1 | 0 |
| Q4 | 1 | 0 | 1 | 0 |
| Q5 | 1 | 1 | 0 | 0 |
| Q6 | 0 | 0 | 0 | 0 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (1 MUST FIX — EC-1 a absorver em Q5; 2 checkpoints a adicionar)
