---
generated_by: roadmap-init (manual)
generated_on: 2026-06-18
slug: agent-api-validator
peer_count_cloned: 7
peer_count_skipped: 0
---

# References catalog

State-of-the-art peer projects gathered at project inception for **Hodor** (agent-driven API validator).
This file is the contract `/discover-plan` reads when investigating a peer.

> **Lifecycle:** every peer below has lifecycle `cloned` (folder present under this directory).
> All clones are shallow + blob-filtered (`--depth 1 --filter=blob:none`) for study only.

---

## bruno

- **Folder:** `knowledge-base/references/bruno/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/usebruno/bruno
- **License:** `MIT`
- **License-gate decision:** auto-approved-permissive
- **Last commit (proxy):** 2026-06-18
- **Stars at clone time:** ~44,997

### Why this peer is here

A tese de Hodor (cliente de API local, git-friendly, alternativa a Postman/Insomnia) é exatamente o que o Bruno entrega para humanos. É a referência mais próxima do produto, especialmente no armazenamento local versionável.

### What to study in it

- Modelo de armazenamento local e como collections viram arquivos versionáveis.
- Formato `.bru` (e por que um formato próprio vs YAML — trade-off de reviewability).
- CLI runner (`@usebruno/cli`) para execução headless.

### Supports ROADMAP milestone(s)

- M0 — *because:* captura de request/response e modelo de execução.
- M3 — *because:* persistência git-friendly de cenários e resultados.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/usebruno/bruno knowledge-base/references/bruno/
```

---

## hoppscotch

- **Folder:** `knowledge-base/references/hoppscotch/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/hoppscotch/hoppscotch
- **License:** `MIT`
- **License-gate decision:** auto-approved-permissive
- **Last commit (proxy):** 2026-06-18
- **Stars at clone time:** ~79,577

### Why this peer is here

API client open-source baseado na **web** — referência direta para a web app de review que precisa mostrar request/response/headers completos.

### What to study in it

- UI de inspeção de request/response/headers (o requisito firme do usuário).
- Render de diferentes content-types e payloads grandes.
- Organização do front-end TS para uma ferramenta de API.

### Supports ROADMAP milestone(s)

- M2 — *because:* web app de review (inspeção completa de req/resp/headers).

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/hoppscotch/hoppscotch knowledge-base/references/hoppscotch/
```

---

## step-ci

- **Folder:** `knowledge-base/references/step-ci/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/stepci/stepci
- **License:** `MPL-2.0`
- **License-gate decision:** clone-anyway-study-only (MPL-2.0 é copyleft fraco file-level — estudar o design, NÃO copiar arquivos para o produto)
- **Last commit (proxy):** 2024-08-03 (⚠️ ~2 anos sem atividade — projeto aparentemente estagnado)
- **Stars at clone time:** ~1,860

### Why this peer is here

Design maduro de **cenário multi-step declarativo em YAML** com captures e checks — o coração do M1. Mesmo estagnado, o formato é uma excelente referência de design.

### What to study in it

- Estrutura YAML de workflow: steps, captures, checks.
- Como variáveis fluem entre steps.
- Geração de testes a partir de OpenAPI.

### Supports ROADMAP milestone(s)

- M1 — *because:* modelo declarativo de cenário multi-step + asserções.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/stepci/stepci knowledge-base/references/step-ci/
```

---

## hurl

- **Folder:** `knowledge-base/references/hurl/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/Orange-OpenSource/hurl
- **License:** `Apache-2.0`
- **License-gate decision:** auto-approved-permissive
- **Last commit (proxy):** 2026-06-18
- **Stars at clone time:** ~19,010

### Why this peer is here

Abordagem alternativa (plain-text, curl-like) ao formato de cenário — contraste de design contra o YAML do Step CI para decidir o formato de Hodor.

### What to study in it

- Sintaxe plain-text para chain de requests + asserts.
- Modelo de captura de valores e queries sobre headers/body.
- Relatórios (JUnit/TAP/HTML) — inspiração para o registro de resultados.

### Supports ROADMAP milestone(s)

- M1 — *because:* modelo de asserções e captura entre requests.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/Orange-OpenSource/hurl knowledge-base/references/hurl/
```

---

## keploy

- **Folder:** `knowledge-base/references/keploy/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/keploy/keploy
- **License:** `Apache-2.0`
- **License-gate decision:** auto-approved-permissive
- **Last commit (proxy):** 2026-06-18
- **Stars at clone time:** ~17,629

### Why this peer is here

Pioneiro em record/replay + regressão de API com geração assistida e **revisão humana** — diretamente alinhado com a tese de validação e com os milestones de geração e regressão.

### What to study in it

- Normalização de campos voláteis (anti-flaky) — técnica chave para M5.
- Modelo de regressão (diff entre runs).
- Geração de testes a partir de tráfego real e de OpenAPI (caveat: precisa de revisão humana).

### Supports ROADMAP milestone(s)

- M4 — *because:* geração de cenários assistida.
- M5 — *because:* diff entre runs + anti-flaky.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/keploy/keploy knowledge-base/references/keploy/
```

---

## schemathesis

- **Folder:** `knowledge-base/references/schemathesis/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/schemathesis/schemathesis
- **License:** `MIT`
- **License-gate decision:** auto-approved-permissive
- **Last commit (proxy):** 2026-06-16
- **Stars at clone time:** ~3,388

### Why this peer is here

Geração de cenários a partir de OpenAPI/GraphQL com property-based testing e workflows stateful — referência para o agente propor cenários e edge cases.

### What to study in it

- Geração de casos a partir de schema (boundary values, tipos errados, campos faltando).
- Testing stateful (sequências de operações).
- Checks de conformidade contra a spec.

### Supports ROADMAP milestone(s)

- M4 — *because:* geração de cenários e edge cases a partir de spec.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/schemathesis/schemathesis knowledge-base/references/schemathesis/
```

---

## mcp-typescript-sdk

- **Folder:** `knowledge-base/references/mcp-typescript-sdk/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/modelcontextprotocol/typescript-sdk
- **License:** `Apache-2.0` (em transição a partir de `MIT`; ambas permissivas — ver `LICENSE` no clone)
- **License-gate decision:** auto-approved-permissive (GitHub API reportou NOASSERTION por ser licença mista; verificado: MIT→Apache-2.0)
- **Last commit (proxy):** 2026-06-18
- **Stars at clone time:** ~12,690

### Why this peer is here

SDK oficial para construir o MCP server em TypeScript — a interface primária do agente em Hodor. Referência canônica de como expor tools, resources e transports.

### What to study in it

- Definição de tools (schema de input, handlers) e design de tools por objetivo.
- Transports (stdio, Streamable HTTP) e lifecycle do server.
- Padrões de teste de MCP server (incl. MCP Inspector).

### Supports ROADMAP milestone(s)

- M0 — *because:* base do MCP server e da tool `run_request`.
- M4 — *because:* tools de geração de cenário.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/modelcontextprotocol/typescript-sdk knowledge-base/references/mcp-typescript-sdk/
```

---

## Skipped peers (license gate)

> Nenhum peer foi pulado. Todos os 7 candidatos aprovados pelo usuário foram clonados com sucesso.

| Peer | Repo | License | Reason for skip |
|---|---|---|---|
| (none) | — | — | — |

---

## Cleanup protocol

- **Remove a peer:** delete its folder under this directory AND remove its entry from this catalog in the same commit.
- **Update a peer (refresh clone):** `cd knowledge-base/references/{peer}/ && git pull` — record the new commit SHA in this catalog.
- **Replace a peer with a better one:** treat as remove + add. Do NOT rename folders; symbolic continuity is meaningless when the underlying repo changed.
