# Discovery Plan: M2 — Web app de review (listagem + req/resp/headers por step + verdict humano)

> **Version 1.1** (absorveu checkpoint EC-1 + DOCUMENT EC-2/EC-3 de `knowledge-base/reviews/m2-review-webapp-edge-cases-2026-06-18.md`) — Esta descoberta investiga, sobre `hoppscotch` (referência de UI de inspeção), **como** entregar a web app de review do M2 SEM inflar para um cliente tipo Insomnia (risco #1) e SEM travar com payloads grandes/binários (risco #2). O ROADMAP defere a **decisão de framework** para o M2 — esta descoberta a resolve com evidência. O blueprint resultante deve fixar: (a) framework vs server-rendered nativo (a UI é READ + um POST de verdict, não autoria); (b) o padrão de **render por content-type** (lens) para tratar binário/grande; (c) o **modelo de persistência do verdict** humano (aprovado/rejeitado + nota); (d) a **listagem** de cenários e suas execuções. Reusa o `src/web/` do M0/M1 (server `http` nativo + `render.ts`).

**Slug:** `m2-review-webapp`
**Owner:** paulohenriquevn
**Created:** 2026-06-18
**Time budget:** 5h (per-project breakdown in ADR D1)

## Context

Disparado pelo milestone **M2 — Web app de review** (`ROADMAP.md` §M2; depende de M1 entregue em v0.2.0). DoD: (1) web app **lista cenários e suas execuções** + por step exibe request/response/headers completos + asserts e resultado; (2) humano registra **verdict por cenário** (aprovado/rejeitado + nota opcional), **persistido**; (3) pass/fail por assert **visualmente evidente**. Riscos declarados: (#1) escopo de UI inflar para cliente Insomnia — manter foco em *revisão*, não *autoria*; (#2) payloads grandes/binários travarem a UI — truncamento/lazy-load + content-types não-texto.

O M0/M1 já entregaram `src/web/server.ts` (HTTP nativo, GET-only) + `src/web/render.ts` (RunEnvelope→HTML, já renderiza asserts/captures por step). M2 ESTENDE: listagem (GET /), verdict (POST + persistência), e render robusto por content-type. **Achado de baseline:** o envelope de run (`buildRunEnvelope`) NÃO guarda o nome do cenário hoje — listar "por cenário" exige um campo aditivo.

Regras que qualquer padrão emprestado DEVE respeitar:
- `rules/architecture.md` §1–§2 — verdict store é domínio (core); o web server é adaptador. A UI não decide regra de negócio.
- `rules/parsimony-ladder.md` — rung 2/3 (native/stdlib): `http` nativo já resolve; framework é a última opção e só se houver variação real.
- `rules/public-copy.md` — sem framings exagerados na UI; foco em revisão.

## Objective

Decidir, com evidência citada, **a stack da UI (framework vs nativo)**, o **render por content-type** e o **modelo do verdict** de modo que a review app fique focada em revisão (risco #1), trate payloads não-texto sem travar (risco #2) e persista o verdict (alinhado a M3 versionável). Critérios mensuráveis para o blueprint:

- [ ] Todas as research questions respondidas com citações a `knowledge-base/references/`
- [ ] Tabela comparativa hoppscotch × Hodor-review populada (framework, render, listagem)
- [ ] Recommendations com ≥1 proposta concreta por research question (incl. shape do verdict e do listing)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `knowledge-base/references/hoppscotch/` | `packages/hoppscotch-common/src/helpers/lenses/`, `packages/hoppscotch-common/src/components/history/rest/`, `packages/hoppscotch-common/package.json` | Padrão lens (render por content-type — risco #2); listagem de execuções (history); footprint de framework (decisão risco #1) |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/components/lenses/renderers/*.vue` | Componentes Vue concretos — adotamos o CONCEITO (dispatch por content-type), não o código Vue (não temos Vue) |
| `knowledge-base/references/hoppscotch/packages/hoppscotch-{backend,desktop,agent,cli,sh-admin,selfhost-web}/` | Backend cloud / desktop / admin / CLI — fora do alvo local read-only do V1 |
| `knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/` (exceto lenses/history) | App de AUTORIA completa (editores, ambientes, real-time) — explicitamente fora (risco #1: não inflar) |
| `knowledge-base/references/{bruno,step-ci,hurl,keploy,schemathesis,mcp-typescript-sdk}/` | Serviram M0/M1; M3/M4/M5 são descobertas futuras |
| `knowledge-base/references/*/` build artifacts (`dist/`, `node_modules/`) | Build artifacts |
| Qualquer projeto NÃO clonado em `knowledge-base/references/` | Cross-Project Rule |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** hoppscotch: 5h (única referência em escopo; foco em lenses + history + package.json).

**Rationale:** hoppscotch é a referência de UI de inspeção do ROADMAP para M2. O orçamento concentra na evidência que decide os 3 pontos (framework, render por content-type, listagem).

**Stop condition — per question (mandatory):** Fase A vazia após 3 retries de variante → BLOCKED "Fase A exhausted"; seguir. Não preencher com hotspots de outra pergunta.

**Stop condition — per project (mandatory):** Orçamento esgotado com perguntas pendentes → BLOCKED "budget exhausted". Se tudo restante assim, emitir `<promise>BLUEPRINT_BLOCKED</promise>` honesto. Nunca `BLUEPRINT_COMPLETE` com perguntas bloqueadas.

**Anti-pattern:** NUNCA fabricar respostas de Fase B para fechar pergunta cuja Fase A esgotou (Regra 3).

**Consequences:** perguntas bloqueadas viram seed da próxima descoberta.

### D2 — Investigation depth

**Decision:** Ler end-to-end os arquivos pequenos (`lenses.ts`, `jsonLens.ts`, `rawLens.ts`, `history/rest/Card.vue`); para `package.json` (grande), extrair só a contagem de deps + presença de framework (Vue/Vite), não auditar a árvore inteira.

**Rationale:** o padrão lens e a listagem cabem em leitura completa; o package.json serve só para dimensionar o footprint do framework (decisão D1 do blueprint).

**Consequences:** trade-off explícito — profundidade no padrão, superfície no manifest.

### D3 — Verdict é design novo (sem referência) — decisão de plan-phase

**Decision:** nenhuma referência clonada tem o conceito de "humano aprova/rejeita uma execução de cenário". O **modelo do verdict** (shape + persistência) é design do Hodor, informado por padrões gerais; o blueprint o PROPÕE, mas o shape final é fixado no `/to-plan`.

**Rationale:** honestidade (Regra 3) — não fabricar uma citação de verdict que não existe nas refs. O verdict é a tese central do produto (revisão humana), específico do Hodor.

**Consequences:** Q sobre verdict é respondida por proposta de design, marcada explicitamente como não-citável; M3 torna o verdict versionável.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Como o hoppscotch escolhe **como renderizar uma resposta por content-type** (padrão lens) e qual o **fallback** para tipos desconhecidos/binários (risco #2)? | techniques | `knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/helpers/lenses/lenses.ts`, `knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/helpers/lenses/jsonLens.ts`, `knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/helpers/lenses/rawLens.ts` | `ast-grep run -p 'export function getSuitableLenses($$$) { $$$ }' --lang typescript knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/helpers/lenses/` ; fallback Grep `isSupportedContentType\|getSuitableLenses` | Ler `lenses.ts` (seleção + fallback raw), `jsonLens.ts`/`rawLens.ts` (`isSupportedContentType`) | Descrição do dispatch content-type→renderer + fallback raw; mapa de tipos suportados, com `path:line` |
| Q2 | Como tratar **payload grande/binário** sem travar — quais content-types o hoppscotch trata como não-texto e como sinaliza (risco #2 parte 2)? | techniques | `knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/helpers/lenses/`, `knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/components/lenses/renderers/` (só nomes, não Vue) | SKIP Fase A — Glob `*Lens.ts` e listar renderers (image/pdf/audio/video) | Ler quais lenses existem (image/pdf/audio/video/raw) e como `rawLens` é o catch-all | Lista de content-types não-texto reconhecidos + estratégia (renderer dedicado vs raw/omitido), com citações; mapeia para "truncar/omitir binário" no Hodor |
| Q3 | Como o hoppscotch **lista execuções passadas** (history) — qual o shape de um item de listagem? | techniques | `knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/components/history/rest/Card.vue` | SKIP Fase A — Read direto do `Card.vue` (template + props) | Ler `Card.vue` (que campos do request/response um card de history mostra: método, url, status, tempo) | Campos exibidos por item de listagem (método/url/status/timestamp) → mapeia para o listing de runs do Hodor, com citações |
| Q4 | Como o hoppscotch **testa** os lenses (seleção por content-type)? | tests | `knowledge-base/references/hoppscotch/packages/hoppscotch-common/src/helpers/lenses/__tests__/` | SKIP Fase A — Glob `__tests__/*.spec.ts` | **[EC-1]** o Glob retorna VAZIO (só existe `__tests__/lenses.sample`, sem `.spec.ts`). Ler `lenses.sample` e registrar HONESTAMENTE que hoppscotch cobre lens por fixture, não unit spec; NÃO fabricar padrão de teste inexistente | Constatação honesta (fixture, não spec) + recomendação OPOSTA p/ Hodor: adicionar unit test próprio de `pickRenderer` (content-type→renderer), com citação ao `lenses.sample` |
| Q5 | Qual o **footprint de framework** do hoppscotch (deps, Vue/Vite) e isso se justifica para uma UI de **revisão read-only + 1 POST de verdict** (risco #1)? | deps | `knowledge-base/references/hoppscotch/packages/hoppscotch-common/package.json` | SKIP Fase A — Read do `package.json` (contagem de deps; presença de `vue`/`vite`/state libs) | Ler `dependencies`/`devDependencies`; dimensionar o footprint e o que ele serve (autoria/real-time/estado) | Comparação footprint hoppscotch (framework pesado p/ autoria) vs necessidade do Hodor-review (read + 1 POST) → recomendação native-server-rendered, com citações |
| Q6 | Qual o **tooling de build/dev** do hoppscotch (Vite/Vue) vs a stack atual do Hodor (`tsc`/`tsx`, sem bundler)? Adotar framework introduz que pipeline? | tools | `knowledge-base/references/hoppscotch/packages/hoppscotch-common/package.json` | SKIP Fase A — Read dos `scripts` do `package.json` | Ler os scripts (dev/build/test) e o bundler | Tabela tooling hoppscotch (Vite+Vue) vs Hodor (tsc/tsx nativo) + custo de adotar framework, com citações |

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
| Before answering Qx | Todo `knowledge-base/references/{...}` declarado na Fase A existe | Marcar Qx BLOCKED "path not found", seguir |
| Per-question Fase A budget | Fase A retornou ≥1 hotspot OU 3 retries | Após 3 retries vazios, BLOCKED "Fase A exhausted"; seguir |
| Q1-Q3 leitura Vue | Ler `.vue` só para extrair o CONCEITO (campos/dispatch), NÃO para portar Vue (não temos Vue) | Parar após o conceito; marcar render Vue fora de escopo |
| [Verdict] Q ausente | Verdict NÃO é citável das refs (D3) — registrar como design de plan-phase, nunca fabricar citação | Marcar como proposta de design, não citação |
| After answering Qx | Seção do blueprint sob Qx tem ≥1 citação | Re-iterar Qx (máx 1 retry) |
| Before promising complete | As 4 corners populadas E o blueprint recomenda: (framework decision) + (render por content-type) + (modelo de verdict) + (listing + campo de nome no envelope) | Recusar promise, continuar iterando |

## Acceptance Criteria

- [ ] Todas as research questions respondidas OU BLOCKED com motivo
- [ ] As quatro corners têm seção populada no blueprint
- [ ] Toda citação aponta para `knowledge-base/references/{...}` real
- [ ] ≥1 ADR no blueprint sintetiza as decisões (framework, render por content-type, verdict, listing + campo nome no envelope)
- [ ] Time budget respeitado
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint salvo em `knowledge-base/discoveries/blueprints/m2-review-webapp-blueprint.md`

## Global Definition of Done

- [ ] Todas as fases completas (plan → edge-cases → execute → confidence → improve se preciso → re-score)
- [ ] Verdict final de `/discover-confidence` registrado no header do blueprint
- [ ] Sem citações fabricadas
- [ ] Coverage Matrix 100%
- [ ] ADRs referenciam ≥1 princípio das regras (`architecture.md` §1–§2; `parsimony-ladder.md` rung 2/3; `testing.md` §2)
