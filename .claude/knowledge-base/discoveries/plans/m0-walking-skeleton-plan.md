# Discovery Plan: M0 Walking Skeleton — MCP `run_request` tool + run persistence + minimal review web app

> **Version 1.1** (absorveu EC-1 MUST-FIX + checkpoints EC-2/EC-3 de `knowledge-base/reviews/m0-walking-skeleton-edge-cases-2026-06-18.md`) — Esta descoberta investiga, sobre as referências locais já clonadas, **como** construir a fatia mais fina do Hodor (M0): um MCP server TS (stdio) que expõe uma tool `run_request`, persiste a execução (request+response+headers) em arquivo, e uma web app mínima que renderiza esse arquivo. O blueprint resultante deve fixar três decisões antes de qualquer código: (a) o padrão do `@modelcontextprotocol/sdk` para server stdio + tool com input/output schema; (b) o **schema do artefato de run** desenhado já para N steps (M1) e versionado (risco #2 do ROADMAP); (c) a fronteira que isola o core de execução/captura da interface (DIP, `rules/architecture.md`). Projetos em escopo: `mcp-typescript-sdk`, `bruno`, `hoppscotch`.

**Slug:** `m0-walking-skeleton`
**Owner:** paulohenriquevn
**Created:** 2026-06-18
**Time budget:** 6h (per-project breakdown in ADR D1)

## Context

Disparado pelo início do milestone **M0 — Walking skeleton** (`ROADMAP.md` §M0). O ROADMAP declara dois riscos que esta descoberta existe para mitigar **antes** de escrever código:

1. *"Escolher um formato de persistência que não escale para cenários multi-step (M1)"* — mitigar desenhando o schema do run já pensando em N steps.
2. *"Acoplar o MCP server à web app cedo demais"* — mitigar isolando o core de execução/captura como módulo independente da interface.

O macro-discovery (clonagem das referências, license-gate) já foi feito em `/roadmap-init` (ver `knowledge-base/references/_catalog.md`). Esta descoberta é **focada**: não re-documenta o landscape; fecha as lacunas de *implementação* do M0. As referências em escopo cobrem M0/M3 (bruno — runs git-native), M0/M4 (mcp-typescript-sdk — SDK oficial) e M2 (hoppscotch — UI de inspeção; aqui usado só pelos **tipos** request/response e pelo padrão de versionamento de schema).

Regras do projeto que qualquer padrão emprestado DEVE respeitar:
- `rules/architecture.md` §1–§2 — fronteiras em camadas + DIP: o domínio (core de execução/captura) define interfaces; a interface (MCP transport, web app) é adaptador. Diretamente ligado ao risco #2.
- `rules/testing.md` §2 — pirâmide: o core de execução tem testes unitários; a fronteira HTTP/stdio tem testes de integração.

## Objective

Permitir decidir, com evidência citada das referências, **a arquitetura e o schema do artefato de run do M0** de modo que M1 (multi-step) seja uma extensão aditiva, não um refactor. Critérios mensuráveis para o blueprint:

- [ ] Todas as research questions respondidas com citações a `knowledge-base/references/`
- [ ] Tabela comparativa cross-cutting populada para cada projeto em escopo
- [ ] Recommendations com ≥1 proposta concreta por research question (incl. shape do schema de run e a fronteira core↔interface)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `knowledge-base/references/mcp-typescript-sdk/` | `examples/server-quickstart/src/`, `examples/server/src/` | SDK oficial — padrão de server stdio + `registerTool` + input/output schema (M0 core) |
| `knowledge-base/references/bruno/` | `packages/bruno-cli/src/runner/`, `packages/bruno-cli/src/commands/`, `packages/bruno-cli/src/reporters/`, `packages/bruno-cli/src/utils/` | Execução de single-request + serialização do resultado de um run para arquivo (M0 persistência) |
| `knowledge-base/references/hoppscotch/` | `packages/hoppscotch-data/src/rest-request-response/`, `packages/hoppscotch-data/src/rest/v/` | Tipos request/response capturados + padrão de **versionamento de schema** (M0 risco #2) |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `knowledge-base/references/mcp-typescript-sdk/examples/client*/`, `docs/` | Cliente e docs — M0 só precisa do server; cliente é o próprio Claude Code |
| `knowledge-base/references/bruno/packages/bruno-app/`, `bruno-electron/` | UI Electron completa — M0 não constrói cliente desktop; autoria é do agente via MCP |
| `knowledge-base/references/bruno/packages/bruno-lang/`, `bruno-toml/` | DSL `.bru` — formato de *autoria* de request, fora do escopo M0 (decidimos persistência de **run**, não de coleção) |
| `knowledge-base/references/hoppscotch/packages/hoppscotch-backend/`, `hoppscotch-desktop/`, `hoppscotch-agent/`, `hoppscotch-cli/` | Backend cloud / desktop / agent — fora do alvo local single-user do V1 |
| `knowledge-base/references/{step-ci,hurl,keploy,schemathesis}/` | Suportam M1/M4/M5, não M0 (multi-step, geração, regressão) — descoberta futura |
| `knowledge-base/references/*/` build artifacts (`dist/`, `node_modules/`, `.venv/`) | Build artifacts |
| Qualquer projeto NÃO clonado em `knowledge-base/references/` | Cross-Project Rule: nunca alegar feature sem ler a fonte |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** mcp-typescript-sdk: 2.5h; bruno: 2.5h; hoppscotch: 1h.

**Rationale:** O SDK e o bruno são os dois pilares do M0 (o "como montar o server/tool" e o "como persistir o run"), logo recebem o maior orçamento. hoppscotch é consultado pontualmente (tipos + versionamento de schema), 1h basta. Baseado no `_catalog.md`: bruno é a tese mais próxima (git-native runs), SDK é fundação obrigatória.

**Alternatives considered:** split igual (3×2h) — rejeitado porque hoppscotch é uso pontual; deep-dive só no SDK — rejeitado porque o schema de persistência (bruno) é o que carrega o risco #1.

**Stop condition — per question (mandatory):** Quando a Fase A de uma pergunta retorna vazio após 3 retries com variantes de query (pattern → kind-based → caminho alternativo → escopo mais amplo), marcar a pergunta BLOCKED com motivo "Fase A exhausted — no hotspots found" e seguir. Não preencher com hotspots de outra pergunta.

**Stop condition — per project (mandatory):** Quando o orçamento de um projeto esgota com N perguntas pendentes, marcar as restantes daquele projeto como BLOCKED ("budget exhausted") e seguir. Se todo projeto restante estiver nesse estado (toda pergunta `done` ou honestamente `blocked`), emitir `<promise>BLUEPRINT_BLOCKED</promise>` com o relatório honesto. Nunca emitir `BLUEPRINT_COMPLETE` a partir de estado com perguntas bloqueadas.

**Anti-pattern:** NUNCA fabricar respostas de Fase B para fechar pergunta cuja Fase A esgotou. BLOCKED honesto com motivo é obrigatório (Regra Inquebrável 3).

**Consequences:** o halt-loop pára num projeto quando o orçamento esgota; perguntas bloqueadas viram seed da próxima descoberta.

### D2 — Investigation depth

**Decision:** Ler end-to-end os arquivos-âncora pequenos (quickstart, exemplos, reporters); para arquivos grandes (runner), Grep/ast-grep para localizar o símbolo e Read só o trecho relevante (±40 linhas).

**Rationale:** os exemplos do SDK e os reporters do bruno são pequenos e densos — leitura completa rende citação line-exact barata. O runner do bruno é grande; ler tudo estoura orçamento sem ganho.

**Consequences:** trade-off explícito: profundidade total nos âncoras, profundidade cirúrgica no runner.

### D3 — Schema de run desenhado para N steps já no M0 (anti-refactor)

**Decision:** A investigação trata o "run de 1 request" do M0 como **um run de N=1 step** dentro de um envelope que já comporta N steps, em vez de modelar "1 request isolada".

**Rationale:** Mitiga diretamente o risco #1 do ROADMAP (`YAGNI` não se aplica a uma fronteira de dados que sabemos que mudará no próximo milestone — M1 é dependência declarada de M0). `rules/architecture.md` §6 alerta contra abstração prematura; aqui a segunda forma concreta (multi-step) já é conhecida e datada (M1), então o envelope N-step não é especulativo.

**Consequences:** o blueprint precisa recomendar um envelope `{ schemaVersion, steps: [ { request, response } ] }` (ou equivalente evidenciado), não um `{ request, response }` plano.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Qual o padrão mínimo do `@modelcontextprotocol/sdk` para um server **stdio** que registra uma tool com **input schema (zod)** e retorna **conteúdo estruturado** (outputSchema/structuredContent)? | techniques | `knowledge-base/references/mcp-typescript-sdk/examples/server-quickstart/src/index.ts`, `knowledge-base/references/mcp-typescript-sdk/examples/server/src/mcpServerOutputSchema.ts` | `ast-grep run -p 'server.registerTool($$$)' --lang typescript knowledge-base/references/mcp-typescript-sdk/examples/` para mapear sites de registro de tool | Ler `server-quickstart/src/index.ts` end-to-end (server + StdioServerTransport + connect) e `mcpServerOutputSchema.ts` (inputSchema/outputSchema/structuredContent) | Esqueleto comentado: criação do `McpServer`, `registerTool` com `inputSchema` zod, retorno `{content, structuredContent}`, `transport.connect`, com `path:line` por elemento |
| Q2 | Como o bruno **executa uma single request** e qual o **shape do resultado** (request + response + headers + status + timings) que ele serializa para arquivo? | techniques | `knowledge-base/references/bruno/packages/bruno-cli/src/runner/run-single-request.js`, `knowledge-base/references/bruno/packages/bruno-cli/src/utils/sanitize-results.js`, `knowledge-base/references/bruno/packages/bruno-cli/src/commands/run.js` | `ast-grep run -p 'const $X = { request: $$$, response: $$$ }' --lang javascript knowledge-base/references/bruno/packages/bruno-cli/src/` ; fallback Grep `response\s*:` em `runner/` | Ler `run-single-request.js` (trecho que monta o objeto de resultado), `sanitize-results.js` (o que entra no arquivo), e em `commands/run.js` o ponto que grava `--output` JSON | Tabela campo→tipo→origem do objeto de resultado + onde é gravado, com citações `path:line` |
| Q3 | Como o hoppscotch **versiona** os schemas de request/response (migração entre versões) e qual o **tipo do par request+response capturado**? | techniques | `knowledge-base/references/hoppscotch/packages/hoppscotch-data/src/rest/v/`, `knowledge-base/references/hoppscotch/packages/hoppscotch-data/src/rest-request-response/index.ts` | `ast-grep run -p 'defineVersion($$$)' --lang typescript knowledge-base/references/hoppscotch/packages/hoppscotch-data/src/rest/` ; fallback Grep `version` em `rest/v/` | Ler `rest/v/0.ts` e o `index.ts` que encadeia versões (padrão de migração) + `rest-request-response/index.ts` (shape do par capturado) | Descrição do padrão de versionamento (campo `v`/`schemaVersion` + migração) + shape do par request/response, com citações |
| Q4 | Como as referências **testam** a fronteira que o M0 toca — execução de tool MCP (SDK) e execução de single-request (bruno)? | tests | `knowledge-base/references/mcp-typescript-sdk/examples/server/`, `knowledge-base/references/bruno/packages/bruno-cli/` | `ast-grep run -p 'describe($$$, $$$)' --lang typescript knowledge-base/references/mcp-typescript-sdk/` ; Glob `**/*.test.{ts,js}` e `**/*.spec.{ts,js}` nos dois projetos | Ler 1–2 arquivos de teste representativos de cada (como mockam transporte/HTTP, o que asseguram) | Tabela teste→o que mocka→o que assere, com citações; nota sobre unit vs integration (pirâmide) |
| Q5 | Quais **dependências de runtime** (e versões) um server MCP TS mínimo precisa, qual o **nome de pacote publicado + entrypoints de import reais** (não o alias do monorepo), e qual **client HTTP** o bruno usa? | deps | `knowledge-base/references/mcp-typescript-sdk/examples/server-quickstart/package.json`, `knowledge-base/references/mcp-typescript-sdk/package.json`, `knowledge-base/references/bruno/packages/bruno-cli/package.json` | SKIP Fase A — text-shape. Read direto dos `package.json` | Ler `dependencies`/`devDependencies` dos três; extrair `zod` e o HTTP client do bruno (axios?) com versões. **[EC-1] Ler `name` + mapa `exports` do `mcp-typescript-sdk/package.json`** para registrar o pacote publicado e o import path real do consumidor (o exemplo usa alias interno `@modelcontextprotocol/server` — NÃO copiar literal) | Lista dep→versão→papel (runtime vs dev) + nome do pacote publicado + import path real, com citações |
| Q6 | Qual o **tooling de build/test/lint e a história de dev local** que essas refs usam (comando de teste, runner, bundler)? | tools | `knowledge-base/references/mcp-typescript-sdk/common/vitest-config/`, `knowledge-base/references/mcp-typescript-sdk/examples/server/package.json`, `knowledge-base/references/bruno/package.json` | SKIP Fase A — text-shape. Glob `**/vitest.config.*`, `**/tsconfig.json`, `**/tsdown.config.ts` ; Read `scripts` dos package.json | Ler os scripts e configs de teste/bundle | Tabela ferramenta→papel→comando (test/build/lint), com citações |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q5 | Covered |
| Tools | Q6 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Todo `knowledge-base/references/{project}/{path}` declarado na Fase A existe | Marcar Qx BLOCKED "path not found", seguir |
| Per-question Fase A budget | Fase A retornou ≥1 hotspot OU 3 retries de variante tentados | Após 3 retries vazios, BLOCKED "Fase A exhausted"; seguir |
| After answering Qx | Seção do blueprint sob Qx tem ≥1 citação | Re-iterar Qx (máx 1 retry) |
| Mid-loop sanity | Citações a `knowledge-base/references/` ≥ N/200 palavras de prosa | Adicionar citações aos parágrafos sub-citados (máx 1 retry) |
| Per-project time budget | Orçamento do projeto não esgotado | Ao esgotar, BLOCKED "budget exhausted" para Qx restantes daquele projeto; avançar |
| [EC-2] Q3 leitura limitada | Ler apenas `rest/v/0.ts` + o `index.ts` que encadeia versões + a versão mais alta presente — NÃO ler todos os `v/N.ts` | Parar a leitura de Q3 após 3 amostras; marcar leitura exaustiva fora de escopo |
| [EC-3] Q4 fallback de testes | Se Glob `**/*.{test,spec}.ts` em `examples/server/` vier vazio, cair para testes do core do SDK (`**/*.test.ts` sob `mcp-typescript-sdk/` excluindo `examples/`) | Citar de lá; nunca alegar "sem testes" sem checar o core |
| Before promising complete | As 4 corners têm seção populada E D3 (envelope N-step) tem recomendação concreta | Recusar promise, continuar iterando |

## Acceptance Criteria

- [ ] Todas as research questions respondidas OU marcadas BLOCKED com motivo
- [ ] As quatro corners têm seção populada no blueprint
- [ ] Toda citação no blueprint aponta para `knowledge-base/references/{...}` real
- [ ] ≥1 seção ADR no blueprint sintetiza as decisões (incl. shape do envelope de run e a fronteira core↔interface)
- [ ] Time budget respeitado por projeto
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint salvo em `knowledge-base/discoveries/blueprints/m0-walking-skeleton-blueprint.md`

## Global Definition of Done

- [ ] Todas as fases completas (plan → edge-cases → execute → confidence → improve se preciso → re-score)
- [ ] Verdict final de `/discover-confidence` registrado no header do blueprint
- [ ] Sem citações fabricadas
- [ ] Coverage Matrix 100%
- [ ] ADRs referenciam ≥1 princípio das regras (`architecture.md` DIP §2; `testing.md` pirâmide §2; KISS/YAGNI per `parsimony-ladder.md`)
