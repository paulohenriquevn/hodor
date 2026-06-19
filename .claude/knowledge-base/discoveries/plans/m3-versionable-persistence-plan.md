# Discovery Plan: M3 — Persistência versionável + estado de revisão (fecha o V1)

> **Version 1.1** (absorveu checkpoint EC-1 + DOCUMENT EC-2/EC-3 de `knowledge-base/reviews/m3-versionable-persistence-edge-cases-2026-06-19.md`) — Esta descoberta investiga, sobre `bruno` (git-native serialization) e `keploy` (field-normalization / noise), **como** tornar cenários/execuções/verdicts artefatos texto diff-amigáveis e versionáveis no git, fechando o critério de V1. O blueprint resultante deve fixar: (a) o **artefato versionável de revisão** (cenário + run normalizado + verdict, em arquivo texto commitável) — separando "run bruto" (efêmero) de "run normalizado para revisão" (risco #1); (b) a **serialização determinística** (ordenação estável, sem ruído volátil); (c) o **versionamento do schema** do artefato (risco #2); (d) o **layout de diretórios** versionável (hoje `runs/` é gitignored). Reusa o core do M0/M1/M2 (envelope, verdict store).

**Slug:** `m3-versionable-persistence`
**Owner:** paulohenriquevn
**Created:** 2026-06-19
**Time budget:** 6h (per-project breakdown in ADR D1)

## Context

Disparado pelo milestone **M3 — Persistência versionável + estado de revisão** (`ROADMAP.md` §M3; depende de M2 entregue em v0.3.0; **fecha o V1**). DoD: (1) cenários e resultados são arquivos texto estáveis/diff-amigáveis (ordenação determinística, sem ruído volátil), versionáveis no git; (2) o verdict humano (M2) é gravado no artefato versionado, ligando a aprovação ao cenário+execução; (3) critério de V1 demonstrado — loop completo agente→execução→revisão→verdict ponta-a-ponta sobre API real, tudo em arquivos commitáveis. Riscos: (#1) diffs ruidosos (campos voláteis) tornarem a revisão por PR inútil — separar run bruto de run normalizado; (#2) acoplar o formato à implementação atual — versionar o schema do artefato desde o início.

**Baseline:** o M0/M1/M2 entregaram o envelope `{schemaVersion:1, runId, createdAt, name?, steps[]}` (com timings/headers voláteis), o verdict store (`verdicts/{runId}.json`), e a web app de review. **Hoje `runs/` está gitignored** (efêmero) — o oposto do DoD #1. M3 introduz o artefato versionável.

Regras que qualquer padrão emprestado DEVE respeitar:
- `rules/architecture.md` §1–§2 — a normalização e a serialização determinística ficam no **core** (domínio puro); web/MCP são adaptadores.
- `rules/parsimony-ladder.md` — rung 2/3 (native): ordenação estável de JSON pode ser nativa (sem lib); normalização é regra de domínio.
- `rules/testing.md` §6 — determinismo já é cidadão de primeira classe (clock/id injetáveis do M0).

## Objective

Decidir, com evidência citada, **o artefato versionável de revisão + a normalização determinística + o versionamento do schema** de modo que dois runs do mesmo cenário gerem um diff estável (risco #1), o formato evolua sem quebrar (risco #2), e o verdict fique ligado ao artefato commitável — fechando o V1. Critérios para o blueprint:

- [ ] Todas as research questions respondidas com citações a `knowledge-base/references/`
- [ ] Tabela comparativa bruno × keploy populada (serialização, noise, versionamento)
- [ ] Recommendations com ≥1 proposta concreta por research question (incl. shape do artefato + lista de campos voláteis + layout de dirs)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `knowledge-base/references/keploy/` | `pkg/matcher/` (risk.go, utils.go, tests), `pkg/models/testcase.go` | Field-normalization (noise: campos voláteis excluídos do diff) + modelo de artefato versionado com schema (`Version`) |
| `knowledge-base/references/bruno/` | `packages/bruno-lang/src/index.js`, `packages/bruno-filestore/src/formats/` (bru, yml) | Serialização git-native determinística (texto estável, diff-amigável) |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `knowledge-base/references/keploy/pkg/agent/`, `pkg/service/replay/` (replay engine), `pkg/proxy/` | Record/replay + proxy de tráfego — anti-flaky completo é escopo M5; M3 usa só o CONCEITO de noise/normalização |
| `knowledge-base/references/keploy/pkg/matcher/grpc/`, `pkg/matcher/schema/` | gRPC e schema-inference — fora do HTTP/REST do V1 |
| `knowledge-base/references/bruno/packages/{bruno-app,bruno-electron,bruno-js}/` | UI/electron/script-engine — M3 é sobre formato de arquivo, não UI |
| `knowledge-base/references/{hoppscotch,step-ci,hurl,schemathesis,mcp-typescript-sdk}/` | Serviram M0/M1/M2; M4/M5 são descobertas futuras |
| `knowledge-base/references/*/` build artifacts (`dist/`, `node_modules/`, `vendor/`) | Build artifacts |
| Qualquer projeto NÃO clonado em `knowledge-base/references/` | Cross-Project Rule |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** keploy: 3.5h (normalization + versioned model); bruno: 2.5h (serialização determinística).

**Rationale:** o risco #1 (diffs ruidosos) é o núcleo do M3 e a técnica está no keploy (noise) — maior orçamento. bruno fornece o padrão de serialização git-native determinística.

**Stop condition — per question (mandatory):** Fase A vazia após 3 retries de variante → BLOCKED "Fase A exhausted"; seguir. Não preencher com hotspots de outra pergunta.

**Stop condition — per project (mandatory):** Orçamento esgotado com perguntas pendentes → BLOCKED "budget exhausted". Se tudo restante assim, emitir `<promise>BLUEPRINT_BLOCKED</promise>` honesto. Nunca `BLUEPRINT_COMPLETE` com perguntas bloqueadas.

**Anti-pattern:** NUNCA fabricar respostas de Fase B para fechar pergunta cuja Fase A esgotou (Regra 3).

**Consequences:** perguntas bloqueadas viram seed da próxima descoberta.

### D2 — Investigation depth

**Decision:** Ler em profundidade `keploy/pkg/matcher/utils.go` (buildNoiseIndex/JSONDiffWithNoiseControl) + `risk.go` (contrato de noise) + `models/testcase.go` (campos do artefato versionado); para `bruno-lang/src/index.js` (grande), Grep/Read cirúrgico de `jsonToBruV2`/`stringify*` (ordem das seções), não auditar o parser inteiro.

**Rationale:** o conceito de noise e o modelo versionado são o coração do M3; o serializador do bruno é referência de design (vamos serializar JSON determinístico em TS, não portar o `.bru`).

**Consequences:** profundidade na normalização/modelo; superfície no serializador.

### D3 — Normalização é CONCEITO do keploy, não código portado; full anti-flaky é M5

**Decision:** o M3 adota o CONCEITO de noise/normalização do keploy (campos voláteis excluídos do diff) para produzir um artefato de review estável, mas o **diff entre runs + anti-flaky completo é escopo declarado do M5**. M3 entrega a normalização determinística do artefato, não a comparação histórica.

**Rationale:** honestidade de escopo (Regra 3) + ROADMAP (keploy é referência de M4/M5; M3 usa só a semente). Evita inflar o M3 (YAGNI).

**Consequences:** o blueprint recomenda a lista de campos voláteis a normalizar + serialização estável; a comparação run-vs-run fica para M5.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Como o keploy **exclui campos voláteis do diff** (noise) — `buildNoiseIndex` + `JSONDiffWithNoiseControl`, noise por path (`body.user.id`) — e quais campos são tipicamente noise (timestamps, ids)? | techniques | `knowledge-base/references/keploy/pkg/matcher/utils.go`, `knowledge-base/references/keploy/pkg/matcher/risk.go` | `ast-grep run -p 'func buildNoiseIndex($$$) $$$' --lang go knowledge-base/references/keploy/pkg/matcher/` ; fallback Grep `noise\|Noise\|JSONDiffWithNoiseControl` | Ler `utils.go` (buildNoiseIndex + JSONDiffWithNoiseControl — noise por path) e `risk.go` (como noise entra no assessment) | Descrição do mecanismo de noise (path → regex; campos voláteis ignorados) + lista típica de campos voláteis → mapeia para a normalização do Hodor, com `path:line` |
| Q2 | Como o keploy **versiona o artefato** de gravação — o modelo `TestCase` (`Version`, `Kind`, `HTTPReq`, `HTTPResp`, `Created/Updated`) que vira YAML git-committable? | techniques | `knowledge-base/references/keploy/pkg/models/testcase.go` | `ast-grep run -p 'type TestCase struct { $$$ }' --lang go knowledge-base/references/keploy/pkg/models/` ; fallback Grep `Version\|Kind\|json:` | Ler o struct `TestCase` (campos + tags yaml/json; presença de `Version`) | Shape do artefato versionado (Version/Kind/req/resp) → mapeia para o `schemaVersion` do artefato de review do Hodor (risco #2), com citações |
| Q3 | Como o bruno **serializa de forma git-native determinística** — `jsonToBruV2`/`stringifyBruRequest` (ordem fixa de seções) e a serialização yml (`stringifyItem`)? | techniques | `knowledge-base/references/bruno/packages/bruno-lang/src/index.js`, `knowledge-base/references/bruno/packages/bruno-filestore/src/formats/yml/stringifyItem.ts`, `knowledge-base/references/bruno/packages/bruno-filestore/src/formats/bru/index.ts` | `ast-grep run -p 'const jsonToBruV2 = ($$$) => { $$$ }' --lang javascript knowledge-base/references/bruno/packages/bruno-lang/src/` ; fallback Grep `jsonToBruV2\|stringifyBruRequest\|export const stringify` | Ler `jsonToBruV2` (ordem determinística das seções) e `stringifyItem.ts` (serialização estável por tipo) | Padrão de serialização determinística (ordem fixa, texto estável) → mapeia para "stable key order" do Hodor, com citações |
| Q4 | Como o keploy **testa** a exclusão de noise no diff (campos voláteis não reportados)? | tests | `knowledge-base/references/keploy/pkg/matcher/risk_fielddiffs_test.go` | `ast-grep run -p 'func Test$NAME(t *testing.T) { $$$ }' --lang go knowledge-base/references/keploy/pkg/matcher/` ; Glob `pkg/matcher/*_test.go` | Ler `risk_fielddiffs_test.go` (o caso "noised path body.ts must not be reported") | Padrão de teste de normalização (campo volátil → não aparece no diff) → mapeia para o teste de `normalizeRun` do Hodor, com citações |
| Q5 | Cada projeto usa **lib de serialização estável** ou rola a própria? Implicação para o Hodor (stable JSON stringify nativo vs lib npm)? | deps | `knowledge-base/references/bruno/packages/bruno-filestore/package.json`, `knowledge-base/references/keploy/go.mod` | SKIP Fase A — text-shape. Read direto dos manifests | Ler deps do bruno-filestore (yaml lib? stringify lib?) e do keploy (yaml.v3?) | Comparação: serialização própria/lib → recomendação p/ Hodor (JSON.stringify nativo com chaves ordenadas vs lib), com citações |
| Q6 | Qual o **layout de arquivos versionável** — bruno (coleção como árvore de arquivos) vs keploy (yaml por testcase) — e como organizar cenário/run-normalizado/verdict commitáveis no Hodor? | tools | `knowledge-base/references/bruno/packages/bruno-filestore/src/formats/`, `knowledge-base/references/keploy/pkg/models/testcase.go` | SKIP Fase A — Glob/ls dos `formats/` do bruno; Read do testcase.go (Kind/Name → nome de arquivo) | Ler como bruno organiza formats (bru/yml por item) e como keploy nomeia testcases | Tabela layout (bruno árvore-de-arquivos vs keploy yaml-por-caso) + proposta de dir versionável do Hodor (ex. `reviews/{name}.json`), com citações |

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
| Per-question Fase A budget | Fase A retornou ≥1 hotspot OU 3 retries | Após 3 retries vazios, BLOCKED "Fase A exhausted"; seguir |
| [D3] escopo anti-flaky | A comparação run-vs-run / anti-flaky completo é M5 — o blueprint registra só a normalização determinística do artefato, NÃO a comparação histórica | Marcar comparação histórica como fora de escopo (M5) |
| Q3 leitura do bruno-lang | Ler só `jsonToBruV2`/`stringify*` (ordem das seções) — NÃO auditar o parser `.bru` inteiro | Parar após o padrão de ordenação |
| [EC-1] Q6 unidade de versionamento | O artefato VERSIONÁVEL é o de review (cenário + run normalizado + verdict), NÃO todo run bruto; `runs/` segue efêmero/gitignored; diretório commitável (ex. `reviews/`) recebe o normalizado+verdict sob demanda | Registrar explicitamente; commitar run cru geraria ruído de git |
| After answering Qx | Seção do blueprint sob Qx tem ≥1 citação | Re-iterar Qx (máx 1 retry) |
| Before promising complete | As 4 corners populadas E o blueprint recomenda: (artefato versionável) + (lista de campos voláteis a normalizar) + (serialização determinística) + (schemaVersion do artefato) + (layout de dirs) | Recusar promise, continuar iterando |

## Acceptance Criteria

- [ ] Todas as research questions respondidas OU BLOCKED com motivo
- [ ] As quatro corners têm seção populada no blueprint
- [ ] Toda citação aponta para `knowledge-base/references/{...}` real
- [ ] ≥1 ADR no blueprint sintetiza as decisões (artefato + normalização + schema + layout)
- [ ] Time budget respeitado por projeto
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint salvo em `knowledge-base/discoveries/blueprints/m3-versionable-persistence-blueprint.md`

## Global Definition of Done

- [ ] Todas as fases completas (plan → edge-cases → execute → confidence → improve se preciso → re-score)
- [ ] Verdict final de `/discover-confidence` registrado no header do blueprint
- [ ] Sem citações fabricadas
- [ ] Coverage Matrix 100%
- [ ] ADRs referenciam ≥1 princípio das regras (`architecture.md` §1–§2; `parsimony-ladder.md`; `testing.md` §6)
