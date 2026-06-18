---
slug: agent-api-validator
date: 2026-06-18
generated_by: roadmap-init (manual, executed from plan repo)
questions_answered: 7
unresolved_dims: []
status: completed
---

# Roadmap grill: agent-api-validator (produto: Hodor)

Produto: um "Insomnia/Postman para agentes" focado em **validar** o que agentes
(Claude Code et al.) fazem, via cenários de API. O agente cria as requests e os
cenários de teste; o humano revisa e aprova numa UI web que mostra request,
response e headers completos.

### Q1/7: Root problem — CONFIRMED

**User answer:** Quando um agente de código altera um serviço, não há forma rápida e
confiável de *provar* que a API ainda se comporta como deveria. O humano revisa diff
de código (não comportamento real da API) e os agentes podem alegar "funciona" sem
evidência observável. Dói para quem revisa trabalho de agentes: falta um artefato
executável + inspecionável (request/response/headers) que comprove a alteração antes
do merge.

### Q2/7: Primary users — CONFIRMED

**User answer:** Time de engenharia que usa agentes. Dois papéis: **agente-autor**
(Claude Code monta/roda os cenários via MCP) e **humano-revisor** (aprova/rejeita
na UI). Uso interno na Theo primeiro.

### Q3/7: In scope (V1 must-have) — CONFIRMED

**User answer:**
- MCP server com tools: criar request HTTP, executar, capturar request/response/headers completos.
- Cenários multi-step encadeados (extrair variáveis da resposta anterior) + asserções (status/headers/body).
- Web app de review: visualizar request/response/headers completos + aprovar/rejeitar o cenário.
- Persistência mínima é pré-requisito implícito para o web app; formato decidido no M0.

### Q4/7: Out of scope (V1) — CONFIRMED

**User answer:**
- Cloud / colaboração em tempo real / importadores (Postman/Insomnia).
- Integração CI/pipeline e mocking/server stub.

**Assumed (default, confirmar antes do milestone relevante):**
- Auth / multi-tenant / contas — fora do V1 (uso interno single-user/local).
- Protocolos além de HTTP/REST (gRPC/GraphQL/WS) — fora do V1.

### Q5/7: Hard constraints — CONFIRMED

**User answer:**
- Stack: **TypeScript/Node**.
- Interface do agente: **MCP server** (tools nativas para agentes).
- Interface do humano: **web app de review**.
- Requisito firme: a UI **mostra todas as informações de request, response e headers**.

### Q6/7: Measurable success criterion (V1 ship) — CONFIRMED

**User answer:** Fluxo **E2E completo**: agente cria um cenário via MCP → executa →
humano abre o web app, vê request/response/headers completos e aprova/rejeita.
O loop inteiro funciona ponta a ponta contra uma API real.

### Q7/7: North-star metric — CONFIRMED

**User answer:** % de alterações feitas por agentes que entram com um cenário de API
revisado-e-aprovado anexado (cobertura de validação por agente). Sobe → o time confia
mais no trabalho dos agentes porque cada mudança vem com prova comportamental inspecionada.
