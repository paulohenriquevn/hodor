---
slug: m3-versionable-persistence
milestone_id: M3
created_at: 2026-06-19
goal: Entregar a persistência versionável do Hodor — um artefato de review (cenário + run normalizado + verdict) determinístico e diff-amigável, commitável em reviews/, fechando o loop E2E do V1 — provado por um teste E2E verde.
---

# Plan: M3 — Persistência versionável + estado de revisão (fecha o V1)

> **Version 1.1** (absorveu EC-1 MUST-FIX ordem build-antes-de-salvar + EC-2/EC-3 DOCUMENT de `knowledge-base/reviews/m3-versionable-persistence-edge-cases-2026-06-19.md`) — Introduz o **artefato de review versionável**: ao registrar um verdict (M2), o sistema escreve `reviews/{runId}.json` = `{artifactVersion:1, scenarioName?, runId, createdAt, verdict, steps[normalizado]}`, serializado de forma **determinística** (`stableStringify` — chaves ordenadas, nativo) com os **campos voláteis normalizados** (`normalizeRun` — timings + headers voláteis removidos), validado por zod. `runs/` (run bruto, com voláteis) permanece efêmero/gitignored; `reviews/` é **commitável** (não-ignorado). Fecha o critério de V1: o loop agente→execução→revisão→verdict fica em arquivos versionáveis com diff estável. Baseado no blueprint SHIPPABLE_WITH_CAVEATS `knowledge-base/discoveries/blueprints/m3-versionable-persistence-blueprint.md`. ZERO dep nova; comparação run-vs-run é escopo M5.

## Goal

> Enable o time a versionar no git o resultado revisado de uma execução — cenário + run normalizado + verdict, em arquivo texto diff-amigável — de modo que o loop E2E do V1 fique registrado em arquivos commitáveis, measured by o teste E2E `e2e_v1_loop_writes_committable_review_artifact` retornando verde.

## Context

O `ROADMAP.md` §M3 (depende de M2 v0.3.0; **fecha o V1**) pede: (1) cenários e resultados como arquivos texto estáveis/diff-amigáveis (ordenação determinística, sem ruído volátil), versionáveis no git; (2) verdict humano (M2) gravado no artefato versionado, ligando aprovação ao cenário+execução; (3) critério de V1 demonstrado — loop completo ponta-a-ponta sobre API real, em arquivos commitáveis. Riscos: (#1) diffs ruidosos por campos voláteis; (#2) acoplar o formato.

O blueprint da fase DISCOVER (`knowledge-base/discoveries/blueprints/m3-versionable-persistence-blueprint.md`, SHIPPABLE_WITH_CAVEATS) estudou keploy (noise/normalization) e bruno (serialização git-native) e fixou: (D1) artefato `reviews/{runId}.json` separado do run bruto; (D2) `normalizeRun` strip de voláteis (lista explícita); (D3) `stableStringify` JSON chaves-ordenadas nativo; (D4) `artifactVersion:1`; (D5) o artefato é escrito ao registrar o verdict (caller = web POST).

O M0/M1/M2 entregaram: envelope `{schemaVersion:1, runId, createdAt, name?, steps[]}`, `loadRun`, verdict store (`verdict.ts`), e o `POST /runs/:id/verdict`. M3 reusa e estende.

## Baseline Context (deep review of current state)

> Estado real pós-M2 (v0.3.0). Evidência: `git log -1` + `wc -l`. `runs/` está gitignored (linha 26 do .gitignore); `reviews/` NÃO está ignorado (será committável por default).

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `src/core/index.ts` | 45 | `ec2928b` (2026-06-18) | superfície pública do core | adiciona exports de stableStringify/normalizeRun/reviewArtifact; preserva os existentes |
| `src/web/server.ts` | 248 | `fe0c25e` (2026-06-18) | adaptador HTTP (listagem + verdict POST) — M2 | `POST /runs/:id/verdict` passa a TAMBÉM escrever o artefato de review; rotas/validação existentes preservadas |
| `src/core/verdict.ts` | 49 | `ec2928b` (2026-06-18) | VerdictSchema + save/load (M2) | `Verdict`/`VerdictSchema` reusados no artefato; sem mudança de assinatura |
| `src/core/runSchema.ts` | 65 | `ec2928b` (2026-06-18) | envelope + RunStep (M0-M2) | tipos reusados pelo normalizeRun; sem mudança |
| `.gitignore` | 30 | `93ff990` (2026-06-18) | ignora runs/, verdicts não-listado | `runs/` permanece ignorado; `reviews/` NÃO entra (deve ser commitável) — adicionar comentário documentando |
| `src/core/stableStringify.ts` (NEW) | 0 | — | (a criar) JSON determinístico (chaves ordenadas) | arrays preservam ordem; nativo, sem dep |
| `src/core/normalizeRun.ts` (NEW) | 0 | — | (a criar) strip de campos voláteis do run | lista de voláteis explícita/versionada; nunca muta o input |
| `src/core/reviewArtifact.ts` (NEW) | 0 | — | (a criar) ReviewArtifactSchema + build/save/load | artifactVersion literal 1; validação zod na fronteira; escreve em reviews/ |
| `src/core/stableStringify.test.ts` (NEW) | 0 | — | RED test serialização determinística | — |
| `src/core/normalizeRun.test.ts` (NEW) | 0 | — | RED test normalização | — |
| `src/core/reviewArtifact.test.ts` (NEW) | 0 | — | RED test artefato (build/save/load) | — |
| `src/web/server.test.ts` | (M2) | `fe0c25e` | testes do web server | adiciona caso: POST verdict escreve reviews/{id}.json |
| `src/v1-e2e.test.ts` (NEW) | 0 | — | E2E do loop V1 completo + commitável | — |
| `CHANGELOG.md` | (M2) | (release) | contrato público | entradas em `[Unreleased]` |

### Current callers / dependents

- **`Verdict`/`VerdictSchema`** (`src/core/verdict.ts`): callers `web/server.ts` (POST), `web/render.ts`. Reusados pelo `ReviewArtifactSchema` (embute o verdict) — sem mudança de assinatura.
- **`RunEnvelope`/`RunStep`** (`src/core/runSchema.ts`): `normalizeRun` consome `RunEnvelope` e produz um shape normalizado; sem mudança no schema do envelope.
- **`POST /runs/:id/verdict`** (`src/web/server.ts:109`): ganha um passo adicional (escrever o artefato) após `saveVerdict`; contrato HTTP (303) inalterado.
- External (API pública de outro repo): **não**.

### Domain glossary

- **run bruto** — `runs/{id}.json` (M0): execução com campos voláteis (timings, headers Date/ETag...). Efêmero, gitignored.
- **run normalizado** — run com campos voláteis removidos (diff-estável).
- **artefato de review** — `reviews/{id}.json`: `{artifactVersion, scenarioName?, runId, createdAt, verdict, steps[normalizado]}`. Commitável, versionável.
- **stableStringify** — serialização JSON com chaves ordenadas recursivamente (texto byte-determinístico).
- **campo volátil (noise)** — campo que muda entre execuções idênticas (timing, Date header, request-id): removido na normalização.

### Architecture boundaries affected

`rules/architecture.md` §1–§2: `stableStringify`, `normalizeRun` e o `reviewArtifact` store ficam no **core** (domínio puro, validação zod na fronteira no load). O web POST handler é o **adaptador** que chama `buildReviewArtifact`+`saveReviewArtifact`. Direção `web → core`; core não importa web. NENHUMA dep nova (D3 — `JSON.stringify` nativo).

## Prior Art & Related Work

- **Internal blueprint:** `knowledge-base/discoveries/blueprints/m3-versionable-persistence-blueprint.md` — ADRs D1–D5, Coverage Corners, Recommendations 1–7. Fonte primária.
- **Internal blueprints (M0/M2):** `knowledge-base/discoveries/blueprints/m0-walking-skeleton-blueprint.md` (envelope), `knowledge-base/discoveries/blueprints/m2-review-webapp-blueprint.md` (verdict store).
- **Reference projects** (`knowledge-base/references/`):
  - `keploy/pkg/matcher/utils.go` — `buildNoiseIndex`/`JSONDiffWithNoiseControl` (noise: campos voláteis ignorados).
  - `keploy/pkg/models/testcase.go` — `TestCase{Version,...}` (artefato versionado com schema).
  - `bruno/packages/bruno-filestore/src/formats/bru/index.ts` — `stringifyBruRequest` (serialização determinística).
- **Patterns skills** (`skills/*-patterns/`): nenhum registrado.

## Objective

- [ ] Sub-goal 1 — `stableStringify(value)` produz JSON byte-determinístico (chaves ordenadas; arrays preservados).
- [ ] Sub-goal 2 — `normalizeRun(env)` remove campos voláteis (timings + headers voláteis), produzindo run diff-estável; lista de voláteis explícita.
- [ ] Sub-goal 3 — `ReviewArtifactSchema` (zod, `artifactVersion:1`) + `buildReviewArtifact(env, verdict)` + `saveReviewArtifact`/`loadReviewArtifact` em `reviews/`.
- [ ] Sub-goal 4 — `POST /runs/:id/verdict` escreve `reviews/{id}.json` (normalizado + verdict) além do verdict store.
- [ ] Sub-goal 5 — `reviews/` é commitável (NÃO gitignored); o artefato é byte-determinístico (dois runs do mesmo cenário → diff estável).
- [ ] Sub-goal 6 — E2E `e2e_v1_loop_writes_committable_review_artifact` verde.

## ADRs

### D1 — Artefato de review versionável (`reviews/{id}.json`) separado do run bruto

**Decision:** o artefato versionável é `reviews/{runId}.json` (`{artifactVersion:1, scenarioName?, runId, createdAt, verdict, steps[normalizado]}`), escrito ao registrar o verdict. `runs/` (bruto) permanece efêmero/gitignored; `reviews/` é commitável.

**Rationale:** DoD #1/#2; separar bruto de normalizado mitiga o risco #1 (commitar run cru = ruído). Blueprint ADR D1.

**Alternatives considered:** commitar `runs/` (rejeitado — ruído/voláteis); embutir verdict no run bruto (rejeitado — polui o artefato de execução, M2 D3).

**Consequences:** `reviews/` é o que entra no PR; run bruto descartável.

### D2 — `normalizeRun`: strip de voláteis (lista explícita versionada)

**Decision:** `normalizeRun(env)` remove: por step, `response.timings`; headers de resposta voláteis (`date, age, expires, last-modified, etag, x-request-id, set-cookie, cf-ray, cf-cache-status, server-timing, report-to`); `createdAt`/`runId` ficam como metadata fora dos steps comparáveis. Lista de voláteis = constante explícita inspecionável.

**Rationale:** espelha o noise do keploy (`utils.go`), traduzido p/ normalização. Mitiga risco #1 (diff estável). Lista explícita = transparência. Blueprint ADR D2.

**Alternatives considered:** comparador noise-aware (rejeitado — é M5); zerar em vez de remover (rejeitado — remover é mais diff-estável).

**Consequences:** dois runs do mesmo cenário → steps normalizados idênticos; comparação histórica fica p/ M5.

### D3 — `stableStringify`: JSON chaves-ordenadas (nativo, sem dep)

**Decision:** `stableStringify(value)` via `JSON.stringify` ordenando recursivamente chaves de objetos (arrays preservados); 2-espaços + newline final.

**Rationale:** texto estável/diff-amigável (DoD #1) com ZERO dep (Rule 9/parsimony). bruno/keploy usam YAML; o Hodor é JSON. Blueprint ADR D3.

**Alternatives considered:** YAML (rejeitado — dep + inconsistência); `json-stable-stringify` (rejeitado — nativo basta, YAGNI).

**Consequences:** artefato byte-determinístico; diff limpo.

### D4 — `artifactVersion: 1` (risco #2)

**Decision:** o artefato carrega `artifactVersion: z.literal(1)` (distinto do `schemaVersion` do run), validado por zod no load.

**Rationale:** versiona o formato versionável desde o início (risco #2), como `TestCase.Version` do keploy. Blueprint ADR D4.

**Alternatives considered:** reusar `schemaVersion` (rejeitado — artefato de review é formato distinto).

**Consequences:** evolução futura é migração explícita/aditiva.

### D5 — Artefato escrito ao registrar o verdict (loop V1 commitável)

**Decision:** `POST /runs/:id/verdict` (M2), após `saveVerdict`, chama `buildReviewArtifact(env, verdict)` + `saveReviewArtifact` em `reviews/`. Lógica no core (`reviewArtifact.ts`); web é adaptador/caller.

**Rationale:** fecha o DoD #3 (loop em arquivo commitável). `architecture.md` §1–§2. Blueprint ADR D5.

**Alternatives considered:** CLI separado p/ promover (rejeitado — gatilho natural é o verdict, YAGNI); só verdict sem normalizar (rejeitado — viola DoD #1).

**Consequences:** ao aprovar/rejeitar, `reviews/{id}.json` aparece pronto p/ `git add`.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Lista de headers voláteis incompleta deixa ruído residual no diff | Medium | Lista explícita/versionada cobrindo os voláteis comuns; ampliável; um header volátil esquecido degrada mas não quebra (o diff fica um pouco ruidoso, não inválido) | impl |
| `stableStringify` em objeto com referência cíclica lança | Low | Artefatos de run/verdict são DAGs (sem ciclos) — zod valida o shape antes; documentado | impl |
| Normalizar pode esconder uma diferença REAL de timing/header se um dia for relevante | Low | Aceito M3: timing/headers voláteis não são comportamento de API a revisar; run bruto (runs/) preserva tudo para auditoria | impl |
| Commitar artefatos acumula arquivos em reviews/ | Low | 1 arquivo por execução revisada (não por run); retenção/limpeza é política do usuário (fora do escopo M3) | impl |

## Unresolved Questions

- Q1 — O artefato embute o cenário inteiro ou só `scenarioName`? Resolução proposta: só `scenarioName` + os steps normalizados (request já está em cada step); o cenário-fonte completo é redundante com os steps — resolvido na T1.3.
- Q2 — Se já existe `reviews/{id}.json` e o verdict muda, sobrescreve? Resolução proposta: sim — last-write-wins (o verdict mais recente é o válido); o arquivo reflete o estado atual — resolvido na T2.1.
- (demais decisões resolvidas via D1–D5.)

## Dependencies

ZERO dependência nova (D3 — `JSON.stringify` nativo).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `zod` | `^3.25.1` | npm | valida ReviewArtifactSchema (reuso) |
| `@modelcontextprotocol/sdk` | `^1.20.0` | npm | (sem mudança no M3) |
| `jsonpath-plus` | `^10.4.0` | npm | (sem mudança no M3) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | — | — | Avaliado: `json-stable-stringify` (rejeitado — ~10 linhas nativas resolvem, YAGNI); `yaml` (rejeitado — Hodor é JSON, dep + inconsistência) | `JSON.stringify` nativo + ordenação recursiva de chaves basta |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Dependency Graph

```
Phase 1 (core: stableStringify → normalizeRun → reviewArtifact)
   └──▶ Phase 2 (web: POST verdict escreve o artefato) ──▶ Phase 3 (E2E V1 + validação)
```

Phase 1 internamente: stableStringify e normalizeRun são independentes; reviewArtifact depende de ambos. Phase 2 depende do core. Phase 3 depende de Phase 2.

---

## Phase 1: Core — stableStringify, normalizeRun, reviewArtifact

**Objective:** o domínio puro do artefato versionável, testável sem o web server.

### T1.1 — stableStringify (JSON determinístico)

#### Objective
`stableStringify(value): string` — JSON com chaves de objetos ordenadas recursivamente; arrays preservados; 2-espaços + newline final.

#### Why this step (action + reasoning)
1. **What:** cria `src/core/stableStringify.ts`.
2. **Why now:** é a base diff-amigável (DoD #1) que `saveReviewArtifact` usa; isolar puro torna byte-determinismo testável.

#### Evidence
Blueprint §"T3"/"D3". `knowledge-base/references/bruno/packages/bruno-filestore/src/formats/bru/index.ts:118` (serialização determinística).

#### Files to edit
```
src/core/stableStringify.ts (NEW) — stableStringify
src/core/stableStringify.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
NEW. Downstream: `reviewArtifact.saveReviewArtifact` usa. Sem dep externa.

#### Deep Dives
- Recursão: para objeto, reconstruir com `Object.keys(o).sort()` antes de `JSON.stringify`; para array, mapear recursivamente preservando ordem; primitivos inalterados.
- Implementação: um `sortKeys(value)` recursivo + `JSON.stringify(sortKeys(value), null, 2) + "\n"`.
- Invariant: byte-idêntico para objetos que diferem só na ordem de inserção; arrays NÃO reordenados.

#### Pseudo-code / Signatures
```pseudocode
function sortKeys(v):
  if Array.isArray(v): return v.map(sortKeys)
  if v is object && v !== null: return Object.keys(v).sort().reduce((o,k)=>{o[k]=sortKeys(v[k]);return o},{})
  return v
function stableStringify(v): return JSON.stringify(sortKeys(v), null, 2) + "\n"
# Example
stableStringify({b:1,a:2}) === stableStringify({a:2,b:1})  // true
```

#### Tasks
1. `sortKeys` recursivo.
2. `stableStringify`.

#### TDD
```
RED:     stable_stringify_orders_object_keys() — {b:1,a:2} e {a:2,b:1} → string idêntica
RED:     stable_stringify_preserves_array_order() — [3,1,2] mantém ordem
RED:     stable_stringify_sorts_nested_keys() — objeto aninhado tem chaves ordenadas em todos os níveis
RED:     stable_stringify_ends_with_newline() — output termina em "\n"
GREEN:   implementar até os 4 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/core/stableStringify.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 4 RED tests passam — `npx vitest run src/core/stableStringify.test.ts` verde
- [ ] Byte-idêntico independente da ordem de chaves; arrays preservados — `npx vitest run src/core/stableStringify.test.ts` verde
- [ ] Pass: coverage ≥ 90% em `stableStringify.ts`; cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/core/stableStringify.test.ts` verde

### T1.2 — normalizeRun (strip de voláteis)

#### Objective
`normalizeRun(env)` produz o run normalizado: remove timings por step + headers voláteis; sem mutar o input.

#### Why this step (action + reasoning)
1. **What:** cria `src/core/normalizeRun.ts` com `VOLATILE_HEADERS` (constante explícita) e `normalizeRun(env)`.
2. **Why now:** é o coração do risco #1 (diff estável); isolar puro torna testável que dois runs voláteis → mesmo normalizado.

#### Evidence
Blueprint §"T1"/"D2". `knowledge-base/references/keploy/pkg/matcher/utils.go:82` (buildNoiseIndex/noise).

#### Files to edit
```
src/core/normalizeRun.ts (NEW) — VOLATILE_HEADERS + normalizeRun
src/core/normalizeRun.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
NEW. Importa tipos de `runSchema.ts`. Downstream: `buildReviewArtifact` usa os steps normalizados.

#### Deep Dives
- `VOLATILE_HEADERS = new Set(["date","age","expires","last-modified","etag","x-request-id","set-cookie","cf-ray","cf-cache-status","server-timing","report-to"])` (lowercase).
- `normalizeStep(step)`: copia request as-is; response sem `timings`, e `headers` filtrados (remove os de `VOLATILE_HEADERS`); preserva asserts/captures.
- `normalizeRun(env): { scenarioName?, steps: NormalizedStep[] }` (sem runId/createdAt/timings — esses viram metadata do artefato, não do corpo comparável).
- Invariant: não muta `env` (deep copy do que altera); dois envelopes que diferem só em voláteis → `normalizeRun` igual.

#### Pseudo-code / Signatures
```pseudocode
function normalizeStep(s):
  resp = {...s.response}; delete resp.timings
  resp.headers = omit(resp.headers, VOLATILE_HEADERS lowercased)
  return { request: s.request, response: resp, asserts?: s.asserts, captures?: s.captures }
function normalizeRun(env): { ...(env.name?{scenarioName:env.name}:{}), steps: env.steps.map(normalizeStep) }
# Example: dois runs do mesmo cenário com Date/timing diferentes → normalizeRun igual
```

#### Tasks
1. `VOLATILE_HEADERS`.
2. `normalizeStep` + `normalizeRun` (sem mutação).

#### TDD
```
RED:     normalize_run_strips_timings() — step normalizado não tem response.timings
RED:     normalize_run_strips_volatile_headers() — header "date"/"etag" removido; "content-type" preservado
RED:     normalize_run_is_stable_across_volatile_diffs() — dois runs iguais exceto Date/timing → normalizeRun deep-equal
RED:     normalize_run_does_not_mutate_input() — env original mantém timings/headers após normalizeRun
RED:     normalize_run_preserves_asserts_and_captures() — asserts/captures do step sobrevivem
GREEN:   implementar até os 5 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/core/normalizeRun.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 5 RED tests passam — `npx vitest run src/core/normalizeRun.test.ts` verde
- [ ] Dois runs voláteis-diferentes → normalizeRun idêntico; input não-mutado; asserts/captures preservados — `npx vitest run src/core/normalizeRun.test.ts` verde
- [ ] Pass: coverage ≥ 90% em `normalizeRun.ts`; cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/core/normalizeRun.test.ts` verde

### T1.3 — reviewArtifact (schema + build + save/load)

#### Objective
`ReviewArtifactSchema` (zod, `artifactVersion:1`) + `buildReviewArtifact(env, verdict)` + `saveReviewArtifact`/`loadReviewArtifact` em `reviews/` (via `stableStringify`).

#### Why this step (action + reasoning)
1. **What:** cria `src/core/reviewArtifact.ts`; exporta a API no `index.ts`.
2. **Why now:** fecha os Sub-goals 3/5; é o artefato versionável que o web POST escreve (D5). Usa normalizeRun (T1.2) + stableStringify (T1.1) + Verdict (M2).

#### Evidence
Blueprint §"T2"/"D1"/"D4". `knowledge-base/references/keploy/pkg/models/testcase.go:43` (Version no artefato).

#### Files to edit
```
src/core/reviewArtifact.ts (NEW) — ReviewArtifactSchema + buildReviewArtifact + save/loadReviewArtifact + defaultReviewsDir
src/core/index.ts — exporta a API de review artifact + stableStringify + normalizeRun (aditivo)
src/core/reviewArtifact.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
NEW + index.ts. Importa runSchema (RunEnvelope), verdict (Verdict), normalizeRun, stableStringify. Downstream: `web/server.ts` POST (T2.1) chama build+save.

#### Deep Dives
- `defaultReviewsDir()` = `process.env.HODOR_REVIEWS_DIR ?? "reviews"`.
- `ReviewArtifactSchema = z.object({ artifactVersion: z.literal(1), scenarioName: z.string().optional(), runId: z.string().min(1), createdAt: z.string(), verdict: VerdictSchema, steps: z.array(NormalizedStepSchema).min(1) })`.
- `buildReviewArtifact(env, verdict)`: `{ artifactVersion:1, ...(env.name?{scenarioName:env.name}:{}), runId: env.runId, createdAt: env.createdAt, verdict, steps: normalizeRun(env).steps }`.
- `saveReviewArtifact(a, dir?)`: valida (`ReviewArtifactSchema.parse`); `mkdir -p`; grava `${dir}/${a.runId}.json` com `stableStringify(a)`; last-write-wins (Q2).
- `loadReviewArtifact(runId, dir?)`: read + JSON.parse + `ReviewArtifactSchema.parse` (fronteira); ENOENT → null.
- Invariant: o artefato é byte-determinístico (stableStringify); valida na fronteira.

#### Tasks
1. `ReviewArtifactSchema` + `NormalizedStepSchema`.
2. `buildReviewArtifact`.
3. `saveReviewArtifact`/`loadReviewArtifact`/`defaultReviewsDir`.
4. Exportar em index.ts.

#### TDD
```
RED:     build_review_artifact_embeds_verdict_and_normalized_steps() — artefato tem verdict + steps sem timings
RED:     save_review_artifact_writes_stable_bytes() — salvar o mesmo artefato 2x → bytes idênticos; chaves ordenadas
RED:     load_review_artifact_round_trips() — loadReviewArtifact(save) deep-equals
RED:     review_artifact_rejects_wrong_version() — artifactVersion:2 → parse falha
RED:     load_review_artifact_returns_null_when_absent() — runId ausente → null
GREEN:   implementar até os 5 passarem
REFACTOR: None expected
VERIFY:  npx vitest run src/core/reviewArtifact.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Os 5 RED tests passam — `npx vitest run src/core/reviewArtifact.test.ts` verde
- [ ] Artefato embute verdict + steps normalizados; bytes estáveis; valida versão na fronteira — `npx vitest run src/core/reviewArtifact.test.ts` verde
- [ ] Pass: coverage ≥ 90% em `reviewArtifact.ts`; cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/core/reviewArtifact.test.ts` verde; `src/core/index.ts` exporta a API

---

## Phase 2: Web — POST verdict escreve o artefato de review

**Objective:** ao registrar o verdict, escrever `reviews/{id}.json` (caller de produção do artefato).

### T2.1 — POST verdict escreve o artefato versionável

#### Objective
`POST /runs/:id/verdict` (M2), após `saveVerdict`, carrega o run, monta e grava o artefato de review.

#### Why this step (action + reasoning)
1. **What:** estende `postVerdict` em `src/web/server.ts`: após `saveVerdict`, `loadRun(id)` → `buildReviewArtifact(env, verdict)` → `saveReviewArtifact`. `buildWebServer` ganha `reviewsDir`.
2. **Why now:** fecha o Sub-goal 4 + DoD #2/#3 (verdict no artefato versionado; loop commitável). É o caller de produção do artefato (wiring pillar a).

#### Evidence
Blueprint §"D5". M2: `src/web/server.ts:145` (saveVerdict no POST handler).

#### Files to edit
```
src/web/server.ts — postVerdict escreve o artefato; buildWebServer(dir, verdictsDir, reviewsDir?)
src/web/server.test.ts — caso: POST verdict cria reviews/{id}.json normalizado + verdict
```

#### Deep file dependency analysis
`server.ts` (M2). Importa buildReviewArtifact+saveReviewArtifact+loadRun de `../core/index.js`. O run já foi validado existir no `postVerdict` (M2, Q2). Downstream: E2E.

#### Deep Dives
- **[EC-1] Ordem (build antes de salvar):** `const env = await loadRun(join(dir, `${id}.json`))` (já garantido existir) → `const artifact = buildReviewArtifact(env, verdict)` (em memória, PRIMEIRO) → `await saveVerdict(verdict, verdictsDir)` → `await saveReviewArtifact(artifact, reviewsDir)`. Assim um erro de build/normalize aborta ANTES de gravar qualquer coisa (→ 500, nada órfão).
- Falha de I/O ao escrever → propaga (→ 500); não engole (Rule 8). Ambas as escritas são last-write-wins (idempotente no retry).
- `buildWebServer(dir, verdictsDir, reviewsDir = defaultReviewsDir())`.
- Invariant: HTTP 303 inalterado; o artefato reflete o verdict recém-gravado.

#### Tasks
1. `buildWebServer` ganha `reviewsDir`.
2. `postVerdict`: build do artefato em memória (EC-1) → saveVerdict → saveReviewArtifact.

#### TDD
```
RED:     post_verdict_writes_review_artifact() — após POST approved, reviews/{id}.json existe; loadReviewArtifact tem verdict approved + steps sem timings
RED:     post_verdict_review_artifact_is_normalized() — o artefato gravado não contém headers voláteis (ex. "date")
GREEN:   implementar até passar
REFACTOR: None expected
VERIFY:  npx vitest run src/web/server.test.ts
```

#### Concurrency tests
(none — single-threaded)
Nota: escrita por arquivo independente (last-write-wins, single-user); sem estado mutável compartilhado.

#### Acceptance Criteria
- [ ] Os 2 RED tests passam — `npx vitest run src/web/server.test.ts` verde
- [ ] reviews/{id}.json criado com verdict + steps normalizados; POST verdict (M2) segue 303 — `npx vitest run src/web/server.test.ts` verde
- [ ] Pass: cada arquivo ≤ 500 linhas (`wc -l`); `npm run typecheck` 0 erros

#### DoD
- [ ] `npx vitest run src/web/server.test.ts` verde; postVerdict é caller de produção do artefato (wiring a)

---

## Phase 3: E2E V1 + Integration Validation

**Objective:** provar o loop V1 completo com artefato commitável e diff estável.

### T3.1 — E2E do loop V1 + commitável + CHANGELOG

#### Objective
E2E: run persistido → POST verdict → `reviews/{id}.json` escrito (normalizado + verdict) → o arquivo NÃO é gitignored → dois runs do mesmo cenário geram artefatos com steps idênticos (diff estável).

#### Why this step (action + reasoning)
1. **What:** cria `src/v1-e2e.test.ts` (`e2e_v1_loop_writes_committable_review_artifact` — métrica do Goal) + CHANGELOG; ajusta `.gitignore` (comentário documentando que `reviews/` é commitável).
2. **Why now:** prova do Sub-goal 6 e do DoD #3 (loop em arquivos commitáveis). Depende de Phase 2.

#### Evidence
ROADMAP §M3 DoD #1/#2/#3; Blueprint §"D5".

#### Files to edit
```
src/v1-e2e.test.ts (NEW) — E2E do loop V1
.gitignore — comentário: reviews/ é commitável (NÃO ignorar); runs/ permanece ignorado
CHANGELOG.md — [Unreleased] § Added (M3)
```

#### Deep file dependency analysis
NEW. Importa buildWebServer (web), buildRunEnvelope/persistRun/loadReviewArtifact (core). Sobe `buildWebServer` real + POST via fetch.

#### Deep Dives
- Persiste 2 runs do MESMO cenário (mesmos request/response/asserts) mas com `createdAt`/timings/Date-header diferentes, em tmpdir.
- POST verdict approved em cada → 2 artefatos.
- Assert: `loadReviewArtifact` de ambos tem `steps` deep-equal (normalização estável — DoD #1); `verdict.verdict === "approved"` (DoD #2).
- Assert commitável: `git check-ignore reviews/{id}.json` retorna não-ignorado (o teste pode checar via `child_process` que o path não casa o .gitignore) OU asserir que `reviews/` não está no .gitignore. (Simplificação: ler `.gitignore` e asserir que `reviews/` não consta.)

#### Tasks
1. Escrever o E2E (2 runs → normalização estável + verdict).
2. `.gitignore` comentário (reviews/ commitável).
3. CHANGELOG.

#### TDD
```
RED:     e2e_v1_loop_writes_committable_review_artifact() — run→POST verdict→reviews/{id}.json normalizado+verdict; 2 runs do mesmo cenário → steps idênticos; reviews/ não-gitignored (métrica do Goal)
GREEN:   ajustar wiring até passar
REFACTOR: None expected
VERIFY:  npx vitest run src/v1-e2e.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `e2e_v1_loop_writes_committable_review_artifact` verde (metric do Goal)
- [ ] `reviews/` NÃO está em `.gitignore` (commitável); `runs/` permanece ignorado
- [ ] CHANGELOG `[Unreleased] § Added` com o M3 (fecha V1)
- [ ] Pass: `npm test` (suíte inteira) verde; `npm run typecheck` 0 erros; cada arquivo ≤ 500 linhas (`wc -l`)

#### DoD
- [ ] `npm test` verde; CHANGELOG atualizado

---

## Coverage Matrix

| # | Gap / Requirement (ROADMAP §M3 DoD) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Cenários/resultados = arquivos texto estáveis/diff-amigáveis, versionáveis | T1.1, T1.2, T1.3, T3.1 | stableStringify + normalizeRun + artefato em reviews/ (não-gitignored) |
| 2 | Verdict gravado no artefato versionado, ligando cenário+execução | T1.3, T2.1 | ReviewArtifact embute verdict + runId + scenarioName |
| 3 | Critério V1 demonstrado: loop completo em arquivos commitáveis | T3.1 | E2E `e2e_v1_loop_writes_committable_review_artifact` |
| 4 | Risco #1: diffs ruidosos (campos voláteis) | T1.2 | normalizeRun strip de timings + headers voláteis (lista explícita) |
| 5 | Risco #2: acoplar formato | T1.3 | `artifactVersion:1` versionado desde o início |
| 6 | Reuso do core M0/M1/M2 sem refactor | T1.2, T1.3, T2.1 | reusa RunEnvelope/Verdict/loadRun; aditivo |

**Coverage: 6/6 gaps cobertos (100%)**

## Global Definition of Done

- [ ] Todas as fases completas
- [ ] Todos os testes verdes — `npm test`
- [ ] Zero erros de tipo — `npm run typecheck`
- [ ] Zero warnings de lint — `npm run typecheck` (tsc --strict)
- [ ] Budget de tamanho respeitado (≤ 500 linhas/arquivo, `rules/architecture.md`)
- [ ] CHANGELOG.md atualizado em `[Unreleased]` (Unbreakable Rule 6)
- [ ] Compatibilidade: M0/M1/M2 seguem verdes (artefato é aditivo; POST verdict mantém 303; envelope/verdict reusados sem mudança)
- [ ] Plan-specific: `reviews/` commitável; artefato byte-determinístico; verdict ligado ao cenário+execução; ZERO dep nova
- [ ] **Artefato-versionável proof** — `reviews/{id}.json` existe, valida no zod, e `reviews/` não é gitignored — exercitado no E2E
- [ ] **Plan archived** — mover para `knowledge-base/plans/completed/` após `/review` READY_TO_MERGE + merge do PR

## Failure scenarios

M3 toca I/O de arquivo (runs/ leitura, reviews/ escrita). Modos de falha:

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `reviews/` (fs, escrita) | artefato gravado lido de volta corrompido | `loadReviewArtifact` sobre arquivo JSON inválido (`review_artifact_rejects_wrong_version` + caso de JSON inválido) | `ReviewArtifactSchema.parse` lança (fail-loud, validação na fronteira) |
| `runs/` (fs, leitura) no POST | run desaparece entre validação e escrita do artefato | (coberto) `postVerdict` já valida `loadRun` existir (M2 Q2); ENOENT → 404 antes de gravar artefato | nenhum artefato órfão criado |
| normalização | run sem `name` (run_request do M0) | artefato de um run M0 (sem scenarioName) | `scenarioName` omitido; artefato válido (campo opcional) |

## Final Phase: Integration Validation (MANDATORY)

> Roda DEPOIS de todas as fases.

**Objective:** validar o loop V1 versionável num workload real.

### Execution

```
npm test                  # unit + integração + e2e (vitest run)
npm run typecheck         # 0 erros
npx vitest run --coverage # coverage (≥ 90% no core novo: stableStringify, normalizeRun, reviewArtifact)
npm audit                 # 0 CRITICAL/HIGH
git check-ignore reviews/ # confirma que reviews/ NÃO é ignorado (saída vazia)
```

### Acceptance Criteria

- [ ] Todas as suítes verdes (unit + integração + e2e), incl. M0/M1/M2 (backward-compat) — `npm test` verde
- [ ] Coverage ≥ 90% nos arquivos novos do core (stableStringify, normalizeRun, reviewArtifact)
- [ ] Zero erros de tipo
- [ ] Artefato-versionável proof — `reviews/{id}.json` válido + `reviews/` não-gitignored, no E2E
- [ ] Failure scenarios verdes — artefato corrompido lança; run M0 sem name → artefato válido — `npm test` verde
- [ ] `npm audit` 0 CRITICAL/HIGH (ZERO dep nova)

### If Validation Fails

1. Identificar falhas causadas por M3 vs M0/M1/M2 (estes devem continuar verdes).
2. Corrigir todas antes de declarar completo.
3. Re-rodar a cadeia.
