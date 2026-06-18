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
