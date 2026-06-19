# Blueprint: M3 — Persistência versionável + estado de revisão (fecha o V1)

> Discovery executada sobre `keploy` (field-normalization / noise) e `bruno` (serialização git-native) para fixar, antes de codar, o artefato versionável de review (cenário + run normalizado + verdict), a normalização determinística (sem ruído volátil — risco #1) e o versionamento do schema (risco #2). Verdict de `/discover-confidence`: **SHIPPABLE** (score 100, 0 hard caps — 2026-06-19). Plano: `.claude/knowledge-base/discoveries/plans/m3-versionable-persistence-plan.md` (v1.1).

## Context

M3 (`ROADMAP.md` §M3, depende de M2 v0.3.0; **fecha o V1**) pede: (1) cenários e resultados como arquivos texto estáveis/diff-amigáveis (ordenação determinística, sem ruído volátil), versionáveis no git; (2) verdict humano (M2) gravado no artefato versionado, ligando aprovação ao cenário+execução; (3) critério de V1 demonstrado — loop completo agente→execução→revisão→verdict ponta-a-ponta sobre API real, tudo em arquivos commitáveis. Riscos: (#1) diffs ruidosos por campos voláteis; (#2) acoplar o formato à implementação. **Baseline:** `runs/` está gitignored (efêmero); o verdict mora em `verdicts/{runId}.json` separado. Restrições: `architecture.md` §1–§2 (normalização no core), `parsimony-ladder` (JSON nativo, sem YAML).

## Objective

Decidir o artefato versionável + a normalização determinística + o schemaVersion de modo que dois runs do mesmo cenário gerem diff estável, o formato evolua sem quebrar, e o verdict fique ligado ao artefato commitável — fechando o V1.

## Coverage Corner 1 — Integration Tests

**Pergunta (Q4):** Como o keploy testa a exclusão de campos voláteis (noise) no diff?

`.claude/knowledge-base/references/keploy/pkg/matcher/risk_fielddiffs_test.go:9` (`TestJSONFieldDiffs_KindsValuesAndNoise`) prova o contrato central: dado `exp={"id":"a","ts":"1",...}` vs `act={"id":"b","ts":"2",...}` e a noise `{"ts": {}}`, o diff reporta `body.id` (mudou) mas **NÃO reporta `body.ts`** (`"noised path body.ts must not be reported"`, `:33`). Ou seja: campos voláteis declarados como noise são EXCLUÍDOS do diff. Também valida tipos de diff (ValueChanged/MissingInLive/TypeChanged/MissingInMock).

**Aplicação ao Hodor (testing.md §2/§6):** teste `normalize_run_strips_volatile_fields` — dois runs do mesmo cenário com `createdAt`/`timings`/headers voláteis diferentes produzem o MESMO artefato normalizado (diff vazio); e `stable_stringify_is_byte_identical_across_key_order` — o serializador determinístico produz bytes idênticos independente da ordem de inserção das chaves.

## Coverage Corner 2 — Dependencies

**Pergunta (Q5):** Lib de serialização estável vs própria? Implicação p/ o Hodor.

- **bruno** serializa em **YAML** (`.claude/knowledge-base/references/bruno/packages/bruno-filestore/package.json` → `"yaml": "^2.3.4"`) e em formato `.bru` próprio.
- **keploy** serializa em **YAML** (`.claude/knowledge-base/references/keploy/go.mod` → `github.com/invopop/yaml`, `sigs.k8s.io/yaml`).
- **Decisão Hodor (Rule 9 / parsimony rung 2):** o Hodor é **JSON** em tudo (envelope, cenário, verdict). Para um artefato texto estável/diff-amigável, **JSON com chaves ordenadas** via `JSON.stringify` nativo (serializador recursivo que ordena chaves) basta — texto, diff-friendly, ZERO dep nova. NÃO adotar YAML (introduziria dep + inconsistência com o resto do produto). zod (já dep) valida o artefato.

## Coverage Corner 3 — Tools

**Pergunta (Q6):** Layout de arquivos versionável + o que é versionado.

- **bruno**: coleção como **árvore de arquivos** (um arquivo por request), serializados deterministicamente (`stringifyBruRequest`, `.claude/knowledge-base/references/bruno/packages/bruno-filestore/src/formats/bru/index.ts:118` — despacho por tipo + `jsonToBruV2`).
- **keploy**: **um YAML por testcase** (`TestCase` com `Name` → nome de arquivo).
- **Decisão Hodor (EC-1):** o artefato VERSIONÁVEL é o **artefato de review** (cenário + run normalizado + verdict), NÃO todo run bruto. `runs/` permanece **efêmero/gitignored** (run bruto, com voláteis); um diretório **commitável** `reviews/` recebe um arquivo por execução revisada (`reviews/{runId}.json`), produzido sob demanda (ao registrar o verdict). Commitar cada run cru geraria ruído de git (volume + voláteis) — o `reviews/` é o que entra no PR.

## Coverage Corner 4 — Techniques

### T1 — Normalização de campos voláteis (Q1, risco #1)

keploy modela os campos voláteis como **noise** (`.claude/knowledge-base/references/keploy/pkg/matcher/utils.go:82` `buildNoiseIndex` + `:111` `JSONDiffWithNoiseControl`): a noise é dividida em **path-based** (com pontos, ex. `body.user.id`) e **global** (sem pontos, ex. `timestamp` — ignorado em qualquer profundidade). Um índice (`noiseIndex.match`, `:101`) marca chaves como noisy por substring. O `TestCase` carrega a noise junto do artefato (`.claude/knowledge-base/references/keploy/pkg/models/testcase.go` — campo `AllKeys map[string][]string`).

**Aplicação ao Hodor:** `normalizeRun(env)` produz o run normalizado para review removendo/mascarando campos voláteis: **timings** (`startedAt`, `durationMs`) por step; **headers de resposta voláteis** (global noise: `date`, `age`, `expires`, `last-modified`, `etag`, `x-request-id`, `set-cookie`, `cf-ray`, `cf-cache-status`, `report-to`, `server-timing`); e o `createdAt`/`runId` do envelope (substituídos por marcadores estáveis ou movidos para metadata fora do corpo comparável). A lista de voláteis é **explícita e versionada** (inspecionável — alinha o risco #1 do ROADMAP e a transparência que o M5 exige).

### T2 — Artefato versionado com schema (Q2, risco #2)

keploy versiona o artefato pelo campo `Version` no struct `TestCase` (`.claude/knowledge-base/references/keploy/pkg/models/testcase.go:43` — `Version Version`), além de `Kind`, `Name`, `Created/Updated`, `HTTPReq`, `HTTPResp`. O schema é declarado no próprio arquivo, permitindo migração.

**Aplicação ao Hodor:** o artefato de review é `{ artifactVersion: 1, scenarioName, runId, createdAt, verdict: {verdict,note?,decidedAt}, steps: [normalizado] }`. O `artifactVersion` (risco #2) permite evoluir o formato sem quebrar artefatos antigos — versionado desde o início, como o `Version` do keploy.

### T3 — Serialização determinística git-native (Q3)

bruno serializa deterministicamente: `stringifyBruRequest` (`.claude/knowledge-base/references/bruno/packages/bruno-filestore/src/formats/bru/index.ts:118`) despacha por tipo e delega a `jsonToBruV2` com ordem FIXA de seções (meta→http→headers→body→...); a serialização yml (`.claude/knowledge-base/references/bruno/packages/bruno-filestore/src/formats/yml/stringifyItem.ts:8`) é estável por tipo de item.

**Aplicação ao Hodor:** `stableStringify(obj)` — `JSON.stringify` com um replacer/recursão que **ordena as chaves de todo objeto** (arrays preservam ordem — são significativos: steps são ordenados). Produz bytes idênticos independente da ordem de inserção → diff-amigável. Nativo, sem dep (a ordem das seções do bruno equivale à ordenação de chaves no JSON).

## Cross-cutting Comparison

| Dimensão | keploy | bruno | Decisão M3 (Hodor) |
|---|---|---|---|
| Campos voláteis | noise (path + global) ignorados no diff | n/a | `normalizeRun`: strip timings + headers voláteis (lista versionada) |
| Artefato versionado | `TestCase{Version,...}` YAML | request por arquivo | `reviews/{runId}.json` `{artifactVersion, scenario, run normalizado, verdict}` |
| Schema versioning | campo `Version` | — | `artifactVersion: 1` (risco #2) |
| Serialização | YAML (yaml.v3) | YAML/.bru determinístico | **JSON chaves-ordenadas** (`stableStringify` nativo) |
| Layout | yaml por testcase | árvore de arquivos | `reviews/` commitável (1 arquivo/run); `runs/` efêmero gitignored |
| Comparação run-vs-run | sim (regressão) | — | **fora do escopo M3** (é M5) — M3 só normaliza |
| Teste | noise não-reportado | — | normalize estável + stableStringify byte-idêntico |

## ADRs

### D1 — Artefato de review versionável (`reviews/{runId}.json`), separado do run bruto

**Decision:** o artefato VERSIONÁVEL é `reviews/{runId}.json` = `{ artifactVersion:1, scenarioName, runId, createdAt, verdict, steps[normalizado] }`, validado por zod, escrito sob demanda (ao registrar o verdict). `runs/` (run bruto, com voláteis) permanece efêmero/gitignored; `reviews/` é commitável.

**Rationale:** DoD #1/#2 (resultados+verdict versionáveis ligados ao cenário+execução). Separar bruto de normalizado mitiga o risco #1 (commitar run cru = ruído). EC-1 do plano. keploy guarda o artefato versionado (`testcase.go`), bruno guarda por arquivo.

**Alternatives considered:** commitar todo run em `runs/` (rejeitado — ruído de git, voláteis); embutir verdict no run bruto (rejeitado — polui o artefato de execução, M2 D3).

**Consequences:** `reviews/` sai do gitignore; um arquivo por execução revisada; o run bruto continua descartável.

### D2 — `normalizeRun`: strip de campos voláteis (lista explícita versionada)

**Decision:** `normalizeRun(env)` remove/mascara os voláteis: por step, `response.timings` (startedAt, durationMs); headers de resposta voláteis (`date, age, expires, last-modified, etag, x-request-id, set-cookie, cf-ray, cf-cache-status, server-timing, report-to`); no envelope, `createdAt`/`runId` movidos para metadata (fora do corpo diff-comparável). A lista de voláteis é uma constante explícita e inspecionável.

**Rationale:** espelha o noise do keploy (`utils.go` global + path), traduzido para normalização (não comparação — D3 do plano). Mitiga o risco #1 (diff estável). Lista explícita = transparência (o M5 exigirá regras inspecionáveis).

**Alternatives considered:** comparador noise-aware como keploy (rejeitado M3 — é M5; M3 só normaliza); zerar timings em vez de remover (rejeitado — remover é mais diff-estável).

**Consequences:** dois runs do mesmo cenário → artefato normalizado idêntico (exceto o que mudou de verdade); a comparação run-vs-run fica para M5.

### D3 — `stableStringify`: JSON com chaves ordenadas (nativo, sem dep)

**Decision:** `stableStringify(value)` serializa via `JSON.stringify` ordenando recursivamente as chaves de todo objeto (arrays preservam ordem — steps são significativos). Indentação fixa (2 espaços) + newline final.

**Rationale:** texto estável/diff-amigável (DoD #1) com ZERO dep (Rule 9/parsimony rung 2). bruno/keploy usam YAML; o Hodor é JSON — manter JSON evita dep + inconsistência. Espelha a ordem-fixa-de-seções do bruno (`stringifyBruRequest`).

**Alternatives considered:** YAML como bruno/keploy (rejeitado — dep + inconsistência); `json-stable-stringify` npm (rejeitado — ~10 linhas nativas resolvem, YAGNI).

**Consequences:** o artefato é byte-determinístico; o diff por PR é limpo.

### D4 — `artifactVersion: 1` no artefato (risco #2)

**Decision:** o artefato de review carrega `artifactVersion: z.literal(1)` (distinto do `schemaVersion` do run). Validado por zod no load.

**Rationale:** versiona o formato do artefato versionável desde o início (risco #2), como o `Version` do `TestCase` do keploy. Evolução futura é migração explícita.

**Alternatives considered:** reusar o `schemaVersion` do envelope (rejeitado — o artefato de review é um formato distinto do run; merece sua própria versão).

**Consequences:** migração futura do artefato é aditiva/versionada; sem ambiguidade.

### D5 — Loop V1 commitável: artefato escrito ao registrar o verdict

**Decision:** quando o humano registra o verdict (M2 `POST /runs/:id/verdict`), além de gravar `verdicts/{id}.json`, o sistema escreve `reviews/{id}.json` (normalizado + verdict embutido). Uma função `core/reviewArtifact.ts` (`buildReviewArtifact(env, verdict)` + `saveReviewArtifact`/`loadReviewArtifact`) no domínio; o web handler é o caller.

**Rationale:** fecha o DoD #3 (loop agente→execução→revisão→verdict em arquivo commitável). `architecture.md` §1–§2 (lógica no core; web é adaptador). Reusa o envelope (M0) + verdict (M2).

**Alternatives considered:** comando CLI separado p/ promover (rejeitado M3 — o gatilho natural é o verdict; YAGNI); escrever só no verdict sem normalizar (rejeitado — viola DoD #1).

**Consequences:** ao aprovar/rejeitar, o artefato versionável aparece em `reviews/` pronto para `git add`; demonstração do V1 é `git diff` limpo.

## Recommendations

1. **(Q1/T1/D2)** `core/normalizeRun.ts`: `normalizeRun(env)` com lista explícita de headers voláteis + remoção de timings; metadata (runId/createdAt) fora do corpo comparável.
2. **(Q3/T3/D3)** `core/stableStringify.ts`: `stableStringify(value)` ordena chaves recursivamente (arrays preservados); 2-espaços + newline final; nativo.
3. **(Q2/T2/D4)** `core/reviewArtifact.ts`: `ReviewArtifactSchema = {artifactVersion:1, scenarioName?, runId, createdAt, verdict, steps[normalizado]}` (zod); `buildReviewArtifact(env, verdict)`.
4. **(Q6/D1/D5)** `saveReviewArtifact`/`loadReviewArtifact` em `reviews/` (via `HODOR_REVIEWS_DIR`, default `reviews/`); `reviews/` REMOVIDO do gitignore (commitável); `runs/`/`verdicts/` seguem gitignored.
5. **(D5)** `POST /runs/:id/verdict` (M2) passa a também escrever o artefato de review (caller de produção de `buildReviewArtifact`+`saveReviewArtifact`).
6. **(Q4)** Testes: `normalizeRun` estável (dois runs com voláteis diferentes → mesmo normalizado); `stableStringify` byte-idêntico independente da ordem de chaves; round-trip do artefato; E2E que escreve `reviews/{id}.json` e prova `git add` (arquivo não-ignorado) + diff estável.
7. **(escopo)** Comparação run-vs-run / anti-flaky completo NÃO entra no M3 — é M5 (D3 do plano).

## Blocked questions (if any)

Nenhuma — as 6 perguntas respondidas com citações verificadas; a comparação run-vs-run é escopo M5 declarado (não pergunta bloqueada).
