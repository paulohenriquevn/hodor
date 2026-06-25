# V3 UX Reference — "experiência Hoppscotch/Insomnia" para o Hodor

**Date:** 2026-06-20
**Source:** inspeção ao vivo de https://hoppscotch.io/ via chrome-devtools MCP (screenshot em `scratchpad/hoppscotch.png`).
**Purpose:** north-star de UX que os milestones M9–M13 do V3 perseguem. Pedido do usuário: "quero a mesma experiência". NÃO é cópia de código (Hoppscotch é Vue/MIT — estudo, não fork); é referência de layout/fluxo.

## Anatomia do cliente de 3 painéis (observada)

1. **Top bar global:** logo + workspace switcher · busca/command palette (`Ctrl K`) · import · settings · avatar.
2. **Rail de ícones (esquerda):** alterna modos (REST / realtime / GraphQL / settings). No Hodor: REST só (escopo V3).
3. **Painel central — autoria de request:**
   - **Tabs de request** (múltiplas requests abertas) + `+` nova · **seletor de ambiente** + quick-view (olho).
   - **Barra de URL:** dropdown de método + input de URL + **Send** (split: send/cancel) + **Save** (split).
   - **Tabs de config:** Parâmetros · Corpo · Cabeçalhos · Autorização · Pre-request Script · Post-request Script · Variáveis.
   - **Tabela editável** Key/Valor/Description com add/remove por linha + toggle bulk-edit.
   - **Empty state** com dicas de atalho (Send `Ctrl+Enter`, command `Ctrl+K`, help `?`) + link de Documentação.
4. **Painel de response** (após enviar): status colorido por classe · tempo · tamanho · tabs Body/Headers/Test/Console · lenses por content-type · ações copy/download.
5. **Sidebar direita — organização:** Coleções (árvore + busca + Novo + Importar) · histórico (clock) · ambientes (layers) · **code-gen** (`</>`) · share. Empty state: "Coleções estão vazias / Import or create".
6. **Bottom bar:** toggles de layout (mostrar/ocultar painéis) · help/feedback.

## Mapeamento para os milestones V3 (cada padrão → onde entregamos)

| Padrão Hoppscotch | Milestone Hodor | Observação |
|---|---|---|
| Barra de URL + método + Send + tabs de config (Params/Body/Headers/Auth) + tabela editável | **M9** — autoria visual de request | núcleo da autoria humana; reusa `executeRequest` do core |
| Tabs de request multi-step + captura de variáveis + asserts visuais | **M10** — autoria visual de cenário | eleva 1 request → cenário multi-step |
| Seletor de ambiente + Coleções (árvore/pastas) na sidebar | **M11** — ambientes & coleções | segredo só via `HODOR_SECRET_*` (M7 intacto); env-var comum ≠ segredo |
| Import (curl/OpenAPI/Postman) no empty state da sidebar | **M12** — importadores | tudo entra como draft pendente de revisão |
| Command palette (`Ctrl K`), code-gen (`</>`), histórico pesquisável, atalhos, tema, bottom-bar toggles, response lenses (syntax-highlight/folding) | **M13** — produtividade & polish | aqui mora o "feel" final SOTA |
| Shell de 3 painéis (rail + central + sidebar) + top bar | **transversal** — começa a tomar forma no M9, consolida no M13 | hoje a SPA M8 é um shell mínimo de revisão (header + nav + conteúdo) |

## Gap honesto (estado M8 → alvo Hoppscotch)

O M8 entregou a **fundação de leitura/revisão** (lista→detalhe→diff→verdict) numa SPA React mínima. Para "a mesma experiência" do Hoppscotch faltam **autoria (M9/M10), organização/ambientes (M11), import (M12) e o polish/command-palette/code-gen (M13)** — exatamente a sequência V3 já planejada. Nenhum atalho: a experiência de cliente-de-API completo é a soma de M9–M13, não um único milestone. O diferencial do Hodor permanece: o **gate de revisão humano + MCP** (Hoppscotch não tem); o humano segue único aprovador (contrato M2).

## Decisões de design herdadas (já aplicadas no M8, alinhadas ao Hoppscotch)

- Status colorido por classe HTTP (2xx/3xx/4xx-5xx) — já no M8 (`statusVariant`).
- Tabs Body/Headers + tabela Name/Value de headers — já no M8 (`ResponseView`).
- Dispatch por content-type ("lenses") — já no M8 (`contentType.ts`); syntax-highlight/folding fica p/ M13.
- Empty states explícitos ("no runs yet") — já no M8; evoluir para o estilo "import or create" no M11/M12.

## Não-fazer (escopo V3 — fora)

GraphQL/Realtime/WebSocket (rail de modos do Hoppscotch), cloud/workspaces multi-tenant, colaboração em tempo real — permanecem fora do V3 (ver ROADMAP "Explicitly out of scope" + revisão V3).
