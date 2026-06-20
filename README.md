# Hodor

> Hold the door: prova comportamental inspecionável de uma API antes do merge.

Um agente de código executa um HTTP request e captura request/response/headers
completos; o resultado vira um arquivo versionável que um humano abre numa web app
para revisar — antes de confiar na mudança do agente.

Este repositório está no **M0 (walking skeleton)**: a fatia mais fina ponta-a-ponta
— uma tool MCP executa uma request, persiste o run e a web app o renderiza.

## O que você consegue fazer hoje (M0)

- Expor uma tool MCP `run_request` (method/url/headers/body) a um agente.
- Executar a request, capturar request + response + headers e persistir o run em `runs/{id}.json`.
- Abrir uma web app mínima que renderiza request/response/headers de cada step.

## Pré-requisitos

- Node.js ≥ 18 (testado em v22).

## Instalação

```bash
npm install
```

## Uso

Subir o MCP server (stdio) para um agente/cliente MCP consumir:

```bash
npm run mcp
```

Subir a web app de review (lê os runs em `runs/`):

```bash
npm run web
# abre em http://127.0.0.1:4000  (override: HODOR_WEB_PORT)
# / → run mais recente · /runs/:id → run específico
```

O diretório de runs é `runs/` por padrão (override: `HODOR_RUNS_DIR`).

## Segredos / APIs autenticadas (M7)

Para testar uma API que exige autenticação, injete o segredo via variável de ambiente
**com o prefixo `HODOR_SECRET_`** — só essas são acessíveis ao cenário (allowlist por
construção; o resto do `process.env` nunca é exposto). O prefixo é removido na referência:

```bash
export HODOR_SECRET_TOKEN="seu-bearer-token"   # vira ${{ env.TOKEN }} no cenário
npm run mcp
```

No cenário, referencie como `${{ env.NOME }}`:

```jsonc
{ "request": { "method": "GET", "url": "https://api.exemplo.com/me",
  "headers": { "Authorization": "Bearer ${{ env.TOKEN }}" } } }
```

- O valor do segredo **nunca é persistido**: é redigido (`<redacted>`) em `runs/`, `reviews/`
  e no que volta ao agente — incluindo a forma codificada na URL e em mensagens de erro.
- Se uma var referenciada não existir (ou tiver < 4 chars), o run falha com erro explícito
  e o motivo é logado em stderr (`secret_dropped`, só o nome — nunca o valor).
- Já tem uma var como `API_TOKEN`? Exporte como `HODOR_SECRET_API_TOKEN` e use `${{ env.API_TOKEN }}`.

## Testes

```bash
npm test          # vitest (unit + integração + e2e)
npm run typecheck # tsc --noEmit
npm run coverage  # cobertura
```

## How it works

Arquitetura em camadas com fronteira DIP (ver `.claude/rules/architecture.md`):

- `src/core/` — domínio puro: execução HTTP (`fetch` nativo), captura e persistência
  do run num envelope versionado `{ schemaVersion, steps[] }` (desenhado já para
  cenários multi-step do M1). Não conhece MCP nem HTTP server.
- `src/mcp/` — adaptador: MCP server (stdio) que expõe `run_request`, delegando ao core.
- `src/web/` — adaptador: servidor HTTP nativo que lê um run e o renderiza.

As decisões de design estão registradas no blueprint de descoberta
(`.claude/knowledge-base/discoveries/blueprints/m0-walking-skeleton-blueprint.md`)
e no plano (`.claude/knowledge-base/plans/m0-walking-skeleton-plan.md`).

## Roadmap

Ver [`ROADMAP.md`](./ROADMAP.md). M0 é a fundação; M1–M3 fecham o V1 (cenários
multi-step, web app de review completa, persistência versionável com verdict humano).
