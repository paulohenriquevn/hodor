# Blueprint: M0 Walking Skeleton — MCP `run_request` tool + run persistence + minimal review web app

> Discovery executada sobre as referências locais para fixar, **antes de qualquer código**, a arquitetura e o schema do walking skeleton do M0. Verdict de `/discover-confidence`: **SHIPPABLE** (score 100, 19 citações verificadas, 0 hard caps — 2026-06-18). Origem do plano: `.claude/knowledge-base/discoveries/plans/m0-walking-skeleton-plan.md` (v1.1).

## Context

O milestone M0 (`ROADMAP.md` §M0) pede a fatia mais fina ponta-a-ponta: uma tool MCP executa um HTTP request, o resultado (request+response+headers) é persistido em arquivo, e uma web app mínima renderiza esse arquivo. O ROADMAP declara dois riscos que esta descoberta fechou: (#1) formato de persistência que não escale para multi-step (M1); (#2) acoplar MCP server à web app cedo demais. As regras `.claude/rules/architecture.md` (§1–§2, DIP) e `.claude/rules/testing.md` (§2, pirâmide) restringem qualquer padrão emprestado. As referências em escopo: `mcp-typescript-sdk` (SDK oficial), `bruno` (runs git-native), `hoppscotch` (tipos + versionamento de schema).

## Objective

Permitir decidir a arquitetura + o schema do artefato de run do M0 de modo que M1 (multi-step) seja extensão aditiva, não refactor — com cada decisão lastreada em evidência citada das referências.

## Coverage Corner 1 — Integration Tests

**Pergunta (Q4):** Como as referências testam a fronteira que o M0 toca (execução de tool MCP / single-request)?

Achados:

- **Exemplos do SDK MCP NÃO têm testes** (EC-3 confirmado): `find examples/server -name '*.test.ts'` retorna vazio. Os testes vivem no core — 75 arquivos `*.test.ts` sob `packages/`.
- **Padrão-chave de teste de tool sem stdio real: `InMemoryTransport`** — `.claude/knowledge-base/references/mcp-typescript-sdk/packages/core/test/inMemory.test.ts`. Permite conectar um server a um transport em memória e exercitar handlers de tool sem subir processo stdio. É o padrão para o **teste de integração** do M0: instanciar o `McpServer`, registrar `run_request`, conectar via in-memory transport e chamar a tool.
- Testes usam **vitest** (`describe/it/expect`): ex. `.claude/knowledge-base/references/mcp-typescript-sdk/packages/middleware/hono/test/hono.test.ts:8` (`describe('@modelcontextprotocol/hono', ...)` + `expect(res.status).toBe(200)`).
- **bruno** testa o runner com specs por arquivo: `.claude/knowledge-base/references/bruno/packages/bruno-cli/tests/runner/response-fields.spec.js` (campos do response capturado), `.claude/knowledge-base/references/bruno/packages/bruno-cli/tests/runner/prepare-request.spec.js`, e o HTTP client isolado em `.claude/knowledge-base/references/bruno/packages/bruno-cli/tests/utils/axios-instance.spec.js`.

**Aplicação ao M0 (pirâmide, `testing.md` §2):**
- *Unit:* o core executor — montar request, capturar response/headers/timings, montar o envelope de run — testado contra um alvo HTTP local (servidor `http` efêmero em `127.0.0.1`), sem mocks pesados.
- *Integration:* a tool MCP `run_request` exercitada via in-memory transport (padrão `inMemory.test.ts`); a persistência verificada lendo o arquivo gravado de volta.

## Coverage Corner 2 — Dependencies

**Pergunta (Q5):** Dependências de runtime + nome de pacote publicado + import path reais + HTTP client do bruno.

**ACHADO DECISÃO-CRÍTICO — versão do SDK:** o clone (`branch main`) é **v2 pré-alpha**. `.claude/knowledge-base/references/mcp-typescript-sdk/README.md:7` declara textualmente: *"v1.x remains the recommended version for production use"* (v2 estável previsto Q3/2026). Os exemplos importam de aliases de workspace do monorepo v2:

- `.claude/knowledge-base/references/mcp-typescript-sdk/examples/server-quickstart/package.json` → `"@modelcontextprotocol/server": "workspace:^"`, `"zod": "catalog:runtimeShared"` (NÃO são versões/imports instaláveis por um consumidor externo).
- `.claude/knowledge-base/references/mcp-typescript-sdk/package.json` → `name: @modelcontextprotocol/sdk`, `version: 2.0.0-alpha.0`.
- `.claude/knowledge-base/references/mcp-typescript-sdk/packages/server/package.json` → `name: @modelcontextprotocol/server` (v2), `exports`: `"."` e `"./stdio"`.

**Conclusão (EC-1):** para o M0 FAANG sem re-trabalho, o alvo é o **v1.x estável** (`npm install @modelcontextprotocol/sdk` → traz a dist-tag `latest`, que é v1.x; a alpha v2 fica sob `next`/`alpha`). Imports v1.x: `@modelcontextprotocol/sdk/server/mcp.js` (`McpServer`) e `@modelcontextprotocol/sdk/server/stdio.js` (`StdioServerTransport`). NÃO copiar o import `@modelcontextprotocol/server` do exemplo (é interno do monorepo v2). A API conceitual (`registerTool` com input/output schema zod) é a mesma e forward-compatible com v2.

**HTTP client do bruno:** **axios 1.16.0** — `.claude/knowledge-base/references/bruno/packages/bruno-cli/package.json` (`"axios": "1.16.0"`), usado em `.claude/knowledge-base/references/bruno/packages/bruno-cli/src/runner/run-single-request.js:12` (`makeAxiosInstance`) + interceptors NTLM/AWS. Para M0, axios é YAGNI: a necessidade mínima (1 request, capturar status/headers/body/timing) é coberta pelo **`fetch` nativo** do Node 18+ (o próprio quickstart do SDK usa `fetch`). Adiar axios até auth/interceptors (M4).

**Deps de runtime M0:** `@modelcontextprotocol/sdk` (v1.x, `latest`) + `zod` (v3, peer do SDK v1.x para input schema). HTTP via `fetch` nativo; web via módulo `http` nativo. Dev: `typescript`, `vitest`, `@types/node`, `tsx` (runner TS).

## Coverage Corner 3 — Tools

**Pergunta (Q6):** Tooling de build/test/lint + dev local.

Convenção observada nas referências:

- **Teste: vitest.** `.claude/knowledge-base/references/mcp-typescript-sdk/packages/server/package.json` → `"test": "vitest run"`, `"test:watch": "vitest"`. Config compartilhada em `.claude/knowledge-base/references/mcp-typescript-sdk/common/vitest-config/vitest.config.js`.
- **Typecheck:** `tsc --noEmit` (o SDK usa `tsgo` experimental; M0 usa `tsc` estável).
- **Build:** `tsdown` no SDK; para M0 (CLI Node + browser estático) o build pode ser apenas `tsc` (KISS — `tsdown`/bundler é YAGNI até publicar pacote).
- **Lint:** `eslint + prettier`.
- **ESM:** `"type": "module"` (`.claude/knowledge-base/references/mcp-typescript-sdk/examples/server-quickstart/package.json`). M0 será ESM.

**Dev local M0:** `npm test` (vitest), `npm run typecheck` (tsc --noEmit), `npm run mcp` (sobe o server stdio via tsx), `npm run web` (sobe o servidor http da review app). Sem docker no M0 (alvo local, `ROADMAP.md` Constraints).

## Coverage Corner 4 — Techniques

### T1 — Padrão MCP: stdio server + tool com input/output schema (Q1)

Do exemplo `.claude/knowledge-base/references/mcp-typescript-sdk/examples/server/src/mcpServerOutputSchema.ts` (forma idêntica em v1.x ajustando o import):

```ts
const server = new McpServer({ name: 'hodor', version: '0.1.0' });
server.registerTool(
  'run_request',
  {
    description: '...',
    inputSchema: { method: z.string(), url: z.string(), headers: z.record(z.string()).optional(), body: z.string().optional() },
    outputSchema: { /* run envelope */ },
  },
  async ({ method, url, headers, body }) => {
    const run = await core.executeAndPersist({ method, url, headers, body });
    return { content: [{ type: 'text', text: JSON.stringify(run, null, 2) }], structuredContent: run };
  },
);
// main:
const transport = new StdioServerTransport();
await server.connect(transport);   // mcpServerOutputSchema.ts:71
```

Citações: `mcpServerOutputSchema.ts:17` (registerTool), `:46` (structuredContent), `:71` (StdioServerTransport+connect); `.claude/knowledge-base/references/mcp-typescript-sdk/examples/server-quickstart/src/index.ts:212` (`async function main()` + connect).

**Detalhe de wiring crítico (stdio):** em transporte stdio, **stdout é do protocolo MCP** — todo log de diagnóstico vai para `console.error` (stderr), como o exemplo faz (`mcpServerOutputSchema.ts` usa `console.error('... running on stdio')`). Violação disso corrompe o protocolo. (Nota v1.x: em v1, `inputSchema` é um *ZodRawShape* — objeto de zod fields, como acima — não `z.object(...)`. O exemplo v2 usa `z.object(...)`; ao gerar M0 em v1.x, passar o shape direto.)

### T2 — Shape do resultado de run + persistência em arquivo (Q2)

bruno modela o resultado de uma rodada como um **array `results: [...]`**, um item por request — validando diretamente o envelope N-step (ADR D3 do plano). Cada item (`.claude/knowledge-base/references/bruno/packages/bruno-cli/src/runner/run-single-request.js:149` e `:297`):

```
{
  request:  { method, url, headers, data },
  response: { status, statusText, headers, data, responseTime, duration },
  status:   'pass' | 'fail' | 'error' | 'skipped',
  assertionResults: [], testResults: []
}
```

Persistência: `.claude/knowledge-base/references/bruno/packages/bruno-cli/src/commands/run.js:142` → flag `--output results.json` (formato default `json`; também junit/html). Normalização do que é serializado: `.claude/knowledge-base/references/bruno/packages/bruno-cli/src/utils/sanitize-results.js:9` (`skipHeaders`, `skipRequestBody`, `skipResponseBody`) — semente para o "run normalizado" diff-amigável de M3/M5.

### T3 — Versionamento de schema do artefato (Q3)

hoppscotch versiona schemas com a lib **`verzod`**: cada versão é um `defineVersion({ initial: true, schema })` (`.claude/knowledge-base/references/hoppscotch/packages/hoppscotch-data/src/rest/v/0.ts:34`) e o conjunto é montado por `createVersionedEntity({ latestVersion: 17, versionMap })` (`.claude/knowledge-base/references/hoppscotch/packages/hoppscotch-data/src/rest/index.ts:80`). O par request+response capturado é uma entidade versionada com campo `v` (`.claude/knowledge-base/references/hoppscotch/packages/hoppscotch-data/src/rest-request-response/index.ts:43`, `makeHoppRESTResponseOriginalRequest(x: Omit<..., "v">)`).

**Aplicação M0 (KISS/YAGNI):** incluir o campo **`schemaVersion: 1`** no envelope de run desde já (custo zero, forward-compat para M1 — segunda versão já é conhecida e datada). **Adiar a lib `verzod`** até existir uma v2 do schema (a lib de migração é YAGNI com uma única versão).

## Cross-cutting Comparison

| Dimensão | mcp-typescript-sdk | bruno | hoppscotch | Decisão M0 |
|---|---|---|---|---|
| Papel no M0 | server + tool (stdio) | shape+persistência de run | versionamento de schema | — |
| Versão a usar | **v1.x estável** (não o v2-alpha do clone) | — (padrão, não dep) | — (padrão, não dep) | `@modelcontextprotocol/sdk@latest` |
| HTTP client | `fetch` (exemplos) | axios 1.16.0 | — | **`fetch` nativo** (axios é YAGNI até M4) |
| Run = N itens? | n/a | **sim, `results: []`** | entidade versionada | envelope `{schemaVersion, steps:[]}` |
| Versionamento | — | — | **`verzod` + campo `v`** | campo `schemaVersion` agora; lib depois |
| Teste | InMemoryTransport (core) | specs por runner | — | unit (core) + integ (in-memory tool) |
| Tooling | vitest + tsdown + ESM | — | — | vitest + tsc + ESM |

## ADRs

### D1 — Alvo SDK = `@modelcontextprotocol/sdk` v1.x estável (não o v2-alpha do clone)

**Decisão:** instalar `@modelcontextprotocol/sdk` na dist-tag `latest` (v1.x) e importar de `@modelcontextprotocol/sdk/server/mcp.js` + `/server/stdio.js`. Tratar o clone v2-alpha das referências como leitura conceitual, não como fonte literal de import.

**Rationale:** `README.md:7` do próprio SDK recomenda v1.x para produção até v2 estável (Q3/2026). FAANG sem re-trabalho: copiar o import `@modelcontextprotocol/server` (alias de workspace) quebraria o `npm install`. (Don't-Reinvent — `parsimony-ladder.md` rung 4: usar o SDK oficial; KISS — versão estável.)

**Consequences:** em v1.x, `inputSchema` é um ZodRawShape (não `z.object`). Migração futura para v2 é aditiva (API conceitual idêntica).

### D2 — Fronteira core↔interface (DIP) isolando execução/captura

**Decisão:** um módulo `core` puro — `executeRequest` (fetch + captura) + `buildRunEnvelope` + `persistRun`/`loadRun` — sem nenhum import de `@modelcontextprotocol/sdk` nem de `http`/web. O MCP server e a web app são **adaptadores** que dependem do core; o core não depende deles.

**Rationale:** mitiga diretamente o risco #2 do ROADMAP e implementa `architecture.md` §1–§2 (domínio define, adaptadores satisfazem). Permite testar o core sem subir stdio nem browser. O array `results:[]` do bruno mostra que o core pode produzir o envelope independentemente do transporte.

**Consequences:** o core é a única fonte do schema de run; trocar transporte (stdio→HTTP em M4) ou UI (M2) não toca o core.

### D3 — Envelope de run N-step desde o M0 (anti-refactor para M1)

**Decisão:** o artefato de run é `{ schemaVersion: 1, runId, createdAt, steps: [ { request:{method,url,headers,body}, response:{status,statusText,headers,body,timings:{startedAt,durationMs}} } ] }`. M0 grava exatamente 1 step; M1 (multi-step) só faz `push` em `steps`.

**Rationale:** validado pelo `results: [...]` do bruno (`run-single-request.js:149`). M1 é dependência declarada de M0 — a segunda forma concreta (N steps) já é conhecida, então o envelope não é abstração especulativa (`architecture.md` §6 / YAGNI satisfeitos: a generalização tem caso concreto datado).

**Consequences:** o render da web app e os asserts de M1 iteram `steps`; nenhum refactor entre M0 e M1.

### D4 — `fetch` nativo + `http` nativo; sem framework no M0

**Decisão:** execução HTTP via `fetch` global (Node 18+); web app via módulo `http` nativo servindo um HTML renderizado a partir do JSON de run. Sem axios, sem React/Vue/Express.

**Rationale:** `parsimony-ladder.md` rungs 2–3 (stdlib/native primeiro). O framework web é decisão explícita do M2 (`ROADMAP.md` §M2 "framework a decidir"); antecipá-lo no M0 é YAGNI. axios (bruno) só ganha valor com interceptors de auth (M4).

**Consequences:** captura de headers usa a API `Headers` do fetch; corpos binários/grandes ficam como TODO explícito para M2 (render). Sem dependências de runtime além de SDK+zod.

### D5 — Logs em stderr; runtime metric do wiring triad

**Decisão:** no server stdio, todo diagnóstico vai para `console.error` (stderr); stdout é exclusivo do protocolo MCP. O "runtime metric" do wiring triad será uma linha de log estruturada por execução (`{event:'run_request', status, durationMs}`) em stderr + um contador em memória de runs executados.

**Rationale:** o exemplo do SDK loga em stderr (`mcpServerOutputSchema.ts`). `cycle-implement.md` exige runtime metric observável; em CLI local, log estruturado em stderr é o equivalente KISS de um counter Prometheus.

**Consequences:** observabilidade mínima presente desde o M0 sem dependência de stack de métricas.

## Recommendations

Uma proposta concreta por research question:

1. **(Q1/T1)** Implementar o server em `src/mcp/server.ts` usando `McpServer` v1.x + `registerTool('run_request', { inputSchema: <ZodRawShape> }, handler)` + `StdioServerTransport`. Handler delega 100% ao core; retorna `{content:[text], structuredContent: run}`.
2. **(Q2/T2)** O core expõe `executeRequest()` que devolve `{request, response}` no shape do bruno; `persistRun()` grava `runs/{runId}.json`. Reutilizar o conceito de `sanitize` só em M3.
3. **(Q3/T3)** Envelope com `schemaVersion: 1` literal; NÃO adicionar `verzod` agora (criar ADR de adiamento no plano de implementação).
4. **(Q4)** Testes: unit do core contra um `http.Server` efêmero local; integração da tool via in-memory transport (padrão `inMemory.test.ts`); re-leitura do arquivo persistido como asserção.
5. **(Q5)** `package.json`: deps runtime `@modelcontextprotocol/sdk` (latest) + `zod`; dev `typescript`, `vitest`, `tsx`, `@types/node`. `"type":"module"`. `npm install @modelcontextprotocol/sdk@latest` confirma que `latest` ≠ alpha.
6. **(Q6)** Scripts: `test` (vitest run), `typecheck` (tsc --noEmit), `mcp` (tsx src/mcp/server.ts), `web` (tsx src/web/server.ts). Sem bundler no M0.
7. **(Q2/D2)** Layout: `src/core/` (domínio puro), `src/mcp/` (adaptador stdio), `src/web/` (adaptador http) — package-by-layer (`architecture.md` §5), reforçando a fronteira do risco #2.

## Blocked questions (if any)

Nenhuma — todas as 6 perguntas respondidas com citações verificadas; nenhuma Fase A esgotada.
