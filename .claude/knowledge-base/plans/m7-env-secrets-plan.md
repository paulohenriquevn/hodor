---
slug: m7-env-secrets
milestone_id: M7
created_at: 2026-06-20
goal: Permitir testar APIs autenticadas injetando segredos via ${{ env.NOME }} no run time sem nunca persistir o valor, removendo o teto de auth do gate de regressão — provado por um teste E2E verde.
---

# Plan: M7 — Injeção de env/secrets no run time

> **Version 1.1** (absorveu 3 MUST-FIX de `knowledge-base/reviews/m7-env-secrets-edge-cases-2026-06-20.md`: EC-1 redação cobre TAMBÉM a forma `encodeURIComponent` do segredo — senão vaza encodado na url; EC-2 E2E usa um 2º segredo com chars especiais em query+body; EC-3 redação no CHOKE POINT único antes de todo persistRun, não em deps opcional). Baseado no blueprint SHIPPABLE `knowledge-base/discoveries/blueprints/m7-env-secrets-blueprint.md` (keploy: redação por VALOR longest-first; bruno: env vars + anti-pattern de expor process.env inteiro). Remove o teto de auth do M6: um cenário com `Authorization: Bearer ${{ env.TOKEN }}` passa a resolver o segredo NO RUN TIME e executar contra a API real. **Segurança (central):** só env vars com prefixo **`HODOR_SECRET_*`** são injetáveis (allowlist por construção — NUNCA expor `process.env` inteiro, que permitiria exfiltração via `${{ env.AWS_SECRET }}` numa URL maliciosa, combo SSRF do M6). O segredo NUNCA é persistido: `redactSecretValues` redige por VALOR (longest-first, do keploy) em url/headers/body/captures de TODO run antes de gravar e antes do diff. `drafts/` guarda só o TEMPLATE (pré-execução). ZERO dep nova (process.env é stdlib; `interpolate` do M1 já aceita `env.NOME`).

## Goal

> Entregar a injeção de segredos `${{ env.NOME }}` resolvida de env vars allowlisted (`HODOR_SECRET_*`) no run time, com o valor redigido em todos os sinks persistidos, measured by o teste E2E `e2e_m7_authenticated_scenario_never_persists_secret` retornando verde.

## Context

`ROADMAP.md` §M7 (V2; depende de M1/M3/M4) pede: (1) `${{ env.NOME }}` resolve de fonte de ambiente no run time; (2) segredos NUNCA persistidos em `runs/`/`reviews/`/`drafts/`; (3) E2E: cenário com auth via env contra endpoint autenticado real passa. Risco: segredo vazar em log/artefato.

O blueprint fixou (D1-D6 neste plano; 7 ADRs no blueprint): fonte = `process.env` lido NO ADAPTADOR (core recebe `secrets` via DIP — D1); só `HODOR_SECRET_*` injetáveis, strip do prefixo (D2 — segurança); `redactSecretValues` por valor longest-first complementa o `redactRequestHeaders` por-nome do M3 (D3); `RunScenarioDeps.secrets` semeia `variables["env."+k]`, `interpolate` reusado sem mudança (D4); `drafts/` é template, redação N/A (D5); var ausente = `ScenarioError` (D6 — fail-fast); namespace `env.*` isolado de captures, secret fora da `scenarioKey`.

## Baseline Context (deep review of current state)

> Estado real pós-M6 (v0.6.0). `runs/`+`verdicts/` gitignored; `reviews/`+`drafts/` commitáveis.

### Files that will be touched

| File | LoC hoje | Last commit | Por que existe | Invariante a preservar |
|---|---|---|---|---|
| `src/core/interpolate.ts` | 56 | `ec2928b` | `${{ var }}` substitution (M1) | reusado SEM mudança (regex `[\w.]+` já aceita `env.NOME`) |
| `src/core/runScenario.ts` | 47 | `4351af8` | engine multi-step (M1) | add `RunScenarioDeps.secrets?`; semeia `variables["env."+k]`; execução inalterada |
| `src/core/normalizeRun.ts` | 130 | `bb06e1f` | redação por NOME de header (M3) | reusado; `redactSecretValues` COMPLEMENTA (não substitui) |
| `src/core/checkScenario.ts` | 50 | `bb06e1f` | gate de regressão (M6) | redige segredos do run ANTES do diff e do retorno; aceita `secrets` via deps |
| `src/core/redactSecrets.ts` (NEW) | 0 | — | (a criar) `redactSecretValues(env, values)` por VALOR | longest-first; nunca muta input; cobre url/headers/body/captures |
| `src/core/index.ts` | 95 | `bb06e1f` | superfície pública (DIP) | add exports M7; preserva existentes |
| `src/mcp/server.ts` | 230 | `bb06e1f` | adaptador MCP | resolve `HODOR_SECRET_*`; passa `secrets` a runScenario/checkScenario; redige run antes de persistRun + no structuredContent; tools M0-M6 intactas |
| `CHANGELOG.md` | — | (release) | contrato público | entrada em `[Unreleased] § Added` + `§ Security` |

### Current callers / dependents

- **`interpolate`/`interpolateRequest`** (`interpolate.ts`): caller `runScenario.ts`. Sem mudança — `env.NOME` já casa o regex; só o map `variables` ganha as chaves `env.*`.
- **`runScenario`** (`runScenario.ts:21`): callers `mcp/server.ts` (`run_scenario`), `checkScenario.ts` (`check_scenario`/`replaySuite`). `secrets?` opcional ao final preserva os callers sem secret.
- **`redactRequestHeaders`** (`normalizeRun.ts:68`): por NOME; `redactSecretValues` cobre o gap (segredo em header não-sensível / body / url).
- **`checkScenario`** (`checkScenario.ts`): redige o run com os secret values antes do `diffRuns` (senão golden-redigido vs run-com-token daria falso diff em header não-sensível).

### Domain glossary

- **secret injetável** — env var do processo com prefixo `HODOR_SECRET_X`, exposta ao cenário como `${{ env.X }}` (strip do prefixo).
- **redação por valor** — substituir a STRING literal do segredo por `<redacted>` em todo o run (vs redação por NOME de header do M3).
- **sink** — qualquer lugar onde o run é persistido/retornado: `runs/` (persistRun), `reviews/` (buildReviewArtifact a partir do run), structuredContent do MCP.

### Architecture boundaries affected

Lógica no `src/core/` (interpolação, redactSecretValues, checkScenario). O **adaptador** `src/mcp/` é o ÚNICO que lê `process.env` (D1 — DIP: o core nunca lê env, recebe `secrets` injetado). `core` não importa de mcp/web.

## Prior Art & Related Work

- Interno: blueprint `knowledge-base/discoveries/blueprints/m7-env-secrets-blueprint.md` (7 ADRs de design); `interpolate` (M1); `redactRequestHeaders` (M3); `checkScenario` (M6).
- Externo (citado no blueprint): keploy (redação por valor longest-first em `pkg/service/tools/sanitize.go`), bruno (env vars + anti-pattern de expor process.env em `bruno-cli/src/commands/run.js`).

## ADRs

### D1 — Segredos resolvidos no ADAPTADOR; core recebe via DIP

**Decisão:** `src/mcp/server.ts` lê `process.env`, monta `secrets: Record<string,string>` e passa a `runScenario`/`checkScenario` via deps. O core NUNCA lê `process.env`.

**Rationale:** `architecture.md` §2 (DIP — domínio recebe capacidades, não acessa infra). Testabilidade: o core é testado injetando `secrets` sem mexer no ambiente. Espelha bruno (resolução na fronteira do runner).

**Alternativas rejeitadas:** core lê `process.env` (acopla domínio ao ambiente, intestável, viola DIP).

### D2 — Allowlist por prefixo `HODOR_SECRET_*` (SEGURANÇA central)

**Decisão:** apenas env vars com prefixo `HODOR_SECRET_` são injetáveis; o prefixo é removido na exposição (`HODOR_SECRET_TOKEN` → `${{ env.TOKEN }}`). `resolveHodorSecrets(process.env)` no adaptador.

**Rationale:** expor `process.env` inteiro permitiria a um cenário (potencialmente de draft commitado por terceiro — vetor SSRF do M6) exfiltrar QUALQUER env var (`${{ env.AWS_SECRET_KEY }}` numa URL atacante). bruno expõe process.env inteiro (`run.js:568`) — anti-pattern explícito. Prefixo = allowlist por construção, sem arquivo de allowlist (staleness) nem env-file (YAGNI). O operador opta-in nomeando o segredo com o prefixo.

**Alternativas rejeitadas:** expor `process.env` inteiro (exfiltração); allowlist por nome em arquivo (staleness, mais superfície); env-file declarado no cenário (YAGNI; o prefixo basta).

### D3 — `redactSecretValues` por VALOR (longest-first), complementa o por-nome do M3

**Decisão:** `redactSecretValues(env, values)` substitui cada valor-segredo por `<redacted>` em url/headers/body/captures de cada step (e response body, caso o segredo seja ecoado). Ordena os valores do MAIOR para o menor antes de substituir (evita redação parcial quando um segredo é substring de outro). NÃO muta o input.

**Rationale:** o run captura o request EXECUTADO — o token resolvido fica no header. `redactRequestHeaders` (M3) pega por NOME (Authorization), mas um segredo num header não-sensível / body / url escaparia. A redação por valor fecha o DoD #2. Longest-first é o algoritmo do keploy (`sanitize.go`). Complementa (não substitui) a redação por-nome — defesa em profundidade.

**Alternativas rejeitadas:** só redação por nome (gap: header não-sensível/body); detecção heurística tipo gitleaks (dep + falsos positivos; o Hodor CONHECE os valores que injeta).

### D4 — `RunScenarioDeps.secrets` semeia `env.*`; `interpolate` reusado sem mudança

**Decisão:** `runScenario` inicia `variables` com `env.${k} = secrets[k]` para cada secret, antes do step 1. `interpolate` (M1) é reusado SEM mudança (o regex `[\w.]+` já casa `env.NOME`). `secrets` opcional ao final dos deps (backward-compat).

**Rationale:** parsimônia máxima (rung 5/6) — o ponto de interpolação já existe; só o map ganha o namespace. Var ausente segue `ScenarioError` (D6).

**Alternativas rejeitadas:** novo mecanismo de templating para env (duplica `interpolate`); resolver env dentro do `interpolate` (acopla o core ao ambiente — viola D1).

### D5 — `drafts/` é template; redação por valor N/A ali

**Decisão:** o draft persiste o `Scenario` com `${{ env.NOME }}` literal (pré-execução, nunca o valor resolvido). `redactSecretValues` não se aplica a drafts.

**Rationale:** drafts são specs pré-execução (M4); o valor só existe no run time. O template `${{ env.X }}` é seguro de commitar.

**Alternativas rejeitadas:** resolver o env no draft (persistiria o valor → vaza no commitável; quebra a separação template/run); redigir o draft (não há valor a redigir — é template).

### D6 — Var de env ausente = `ScenarioError` (fail-fast)

**Decisão:** `${{ env.X }}` sem `HODOR_SECRET_X` no ambiente → `ScenarioError` (a mesma de captura ausente do M1), não string vazia.

**Rationale:** string vazia daria um 401 confuso ("por que falhou?"); o erro explícito aponta o segredo faltante. Mantém o fail-fast do M1 (`interpolate` já lança).

**Alternativas rejeitadas:** resolver var ausente como string vazia (401 silencioso/confuso — esconde a causa); default configurável por var (YAGNI; o erro explícito basta).

## Dependency Graph

```
P1 (core: secrets em deps + redactSecretValues + checkScenario redige) ──> P2 (adapter: resolve HODOR_SECRET_* + wire redação nos sinks) ──> P3 (E2E)
```

## Phases

### Phase 1 — Core: injeção + redação por valor

#### T1.1 — `RunScenarioDeps.secrets` + namespace `env.*`

**Why this step:** DoD #1 — `${{ env.NOME }}` resolve no run time. Ação: add `secrets?: Record<string,string>` a `RunScenarioDeps`; `runScenario` semeia `variables["env."+k]`. Raciocínio: D4; reusa `interpolate` sem mudança.

**Files to edit:** `src/core/runScenario.ts`, `src/core/runScenario.test.ts`.

**Deep file dependency analysis:** `interpolate` (M1) inalterado. Callers sem `secrets` preservados (opcional).

#### TDD
- RED `run_scenario_resolves_env_secret_in_header` — cenário com `Authorization: Bearer ${{ env.TOKEN }}` + `deps.secrets={TOKEN:"abc"}` → o request executado envia `Authorization: Bearer abc`.
- RED `run_scenario_missing_env_secret_throws` — `${{ env.MISSING }}` sem secret → `ScenarioError` (fail-fast, D6).
- RED `run_scenario_without_secrets_unchanged` — cenário sem `env.*` roda igual (backward-compat M1).

**Acceptance:** `secrets` resolve `env.*` no run time; ausência → erro; cenários M1 sem env intactos.

**DoD:** `npx vitest run src/core/runScenario.test.ts` verde; `tsc` limpo.

#### Concurrency tests
(none — single-threaded).

#### T1.2 — `redactSecretValues` (por valor, longest-first)

**Why this step:** DoD #2 — segredo nunca persistido. Ação: criar `src/core/redactSecrets.ts` — `redactSecretValues(env, values)` substitui cada valor por `<redacted>` em url/headers/body/captures (+ response body) de cada step, longest-first. Raciocínio: D3.

**Files to edit:** `src/core/redactSecrets.ts` (NEW), `src/core/redactSecrets.test.ts` (NEW), `src/core/index.ts`.

**Deep file dependency analysis:** opera sobre `RunEnvelope`; não muta input; reusa o sentinela `<redacted>` (consistente com M3). Valor vazio/ausente → no-op.

#### TDD
- RED `redact_secret_values_scrubs_request_header` — token no `Authorization` → `<redacted>`.
- RED `redact_secret_values_scrubs_non_sensitive_header_and_body_and_url` — segredo num header não-sensível, no body e na url → todos `<redacted>` (o gap que a redação por-nome do M3 não pega).
- RED `redact_secret_values_scrubs_url_encoded_form` (EC-1, MUST-FIX) — segredo com chars especiais (`a/b+c=d`) é persistido ENCODADO na url (`encodeURIComponent` do `interpolateRequest`); `redactSecretValues` redige TAMBÉM a forma `encodeURIComponent(valor)` (união {raw, encoded}) → não vaza encodado.
- RED `redact_secret_values_scrubs_response_body_and_headers` (EC-8) — segredo ecoado na response (body E headers) → redigido.
- RED `redact_secret_values_longest_first` — dois segredos onde um é substring do outro → o maior é redigido inteiro; variantes raw+encoded também ordenadas longest-first.
- RED `redact_secret_values_empty_values_noop` — `values=[]` ou `[""]` → run inalterado.
- RED `redact_secret_values_does_not_mutate_input` — input intacto.

**Acceptance:** `redactSecretValues` redige cada valor (forma crua E `encodeURIComponent`) em url/headers/body/captures + response body/headers; longest-first sobre as variantes; no-op p/ vazio; puro.

**DoD:** `npx vitest run src/core/redactSecrets.test.ts` verde.

#### Concurrency tests
(none — single-threaded).

#### T1.3 — `checkScenario` redige antes do diff e do retorno

**Why this step:** sem redigir, o golden (redigido) vs run novo (token real) daria falso diff num header não-sensível; e o run retornado/persistido vazaria. Ação: `checkScenario` aplica `redactSecretValues(run, Object.values(deps.secrets ?? {}))` após `runScenario`, antes do `diffRuns` e no `run` retornado. Raciocínio: D3 + consistência com o golden.

**Files to edit:** `src/core/checkScenario.ts`, `src/core/checkScenario.test.ts`.

**Deep file dependency analysis:** reusa `redactSecretValues`. O golden já está redigido (foi persistido redigido pelo adaptador). Diff entre dois runs redigidos → estável.

#### TDD
- RED `check_scenario_redacts_secret_before_diff_no_false_regression` — golden e run novo com o MESMO segredo (token) num header NÃO-sensível → ambos redigidos → `status:"ok"` (sem falso `regression`).
- RED `check_scenario_returns_redacted_run` — o `run` retornado tem o segredo `<redacted>` (não vaza pro caller).

**Acceptance:** `checkScenario` redige o run com os secret values antes de comparar/retornar; sem falso diff por causa do token.

**DoD:** `npx vitest run src/core/checkScenario.test.ts` verde.

#### Concurrency tests
(none — single-threaded).

### Phase 2 — Adapter: resolver allowlist + redigir nos sinks

#### T2.1 — `resolveHodorSecrets` + wire nas tools MCP

**Why this step:** DoD #1/#2 na fronteira — o processo MCP tem o `process.env`; precisa resolver allowlisted e redigir antes de persistir. Ação: `resolveHodorSecrets(env)` (pega `HODOR_SECRET_*`, strip do prefixo); `run_scenario` passa secrets + redige o run antes de `persistRun` e no `structuredContent`; `check_scenario` passa secrets (a redação interna do T1.3 cobre). Raciocínio: D1/D2.

**Files to edit:** `src/mcp/server.ts`, `src/mcp/secrets.test.ts` (NEW).

**Deep file dependency analysis:** `resolveHodorSecrets` puro (recebe um env-like). `run_scenario` redige `redactSecretValues(env, Object.values(secrets))` antes de `persistRun` + retorno. NUNCA loga o valor em stderr.

#### TDD
- RED `resolve_hodor_secrets_only_prefixed` — `{HODOR_SECRET_TOKEN:"abcd1234", PATH:"/x", AWS_SECRET:"y"}` → `{TOKEN:"abcd1234"}` (só o prefixado; AWS_SECRET e PATH IGNORADOS — segurança D2).
- RED `resolve_hodor_secrets_skips_empty_and_no_suffix` (EC-5/EC-6) — `HODOR_SECRET_X=""` e `HODOR_SECRET_=` (sem sufixo) são IGNORADOS (não injetam string vazia nem chave vazia).
- RED `resolve_hodor_secrets_skips_too_short` (EC-4) — `HODOR_SECRET_T="a"` (< MIN_SECRET_LEN) é IGNORADO — evita over-redaction (redigir "a" destruiria todo "a" do run); na prática um token real não tem 1 char, e usar `${{ env.T }}` então dá `ScenarioError` (surface da misconfig).
- RED `run_scenario_tool_does_not_persist_secret` — via InMemoryTransport + `HODOR_SECRET_TOKEN` no env, `run_scenario` de cenário com `${{ env.TOKEN }}` → o `runs/{id}.json` NÃO contém o valor do token (raw NEM encodado; contém `<redacted>`). (EC-3: a redação roda no CHOKE POINT — imediatamente antes de TODO `persistRun` no adaptador — então mesmo o caminho replaySuite→checkScenario não persiste token vivo.)
- RED `run_scenario_tool_structured_content_redacted` — o structuredContent retornado tem o token redigido.
- RED `mcp_does_not_expose_non_prefixed_env` — cenário com `${{ env.PATH }}` (não-prefixado) → `ScenarioError` (PATH não é injetável).

**Acceptance:** só `HODOR_SECRET_*` (não-vazio, ≥ MIN_SECRET_LEN, com sufixo) injetável; redação no choke point antes de todo persistRun; run + structuredContent sem o valor (raw/encoded); env não-prefixado inacessível.

**DoD:** `npx vitest run src/mcp` verde; `tsc` limpo.

#### Concurrency tests
(none — single-threaded).

### Phase 3 — Final Phase: Integration Validation (E2E M7)

#### T3.1 — E2E `e2e_m7_authenticated_scenario_never_persists_secret`

**Why this step:** prova o loop autenticado + a não-persistência (métrica do Goal). Ação: criar `src/m7-e2e.test.ts`.

**Files to edit:** `src/m7-e2e.test.ts` (NEW), `CHANGELOG.md`.

#### TDD
- RED `e2e_m7_authenticated_scenario_never_persists_secret`:
  1. servidor efêmero que EXIGE `Authorization: Bearer s3cr3t-token` (401 sem; 200 com).
  2. `HODOR_SECRET_TOKEN=s3cr3t-token`; cenário com `Authorization: Bearer ${{ env.TOKEN }}`.
  3. `run_scenario` (via core+resolveHodorSecrets) → executa contra o endpoint → **200** (auth funcionou via env — DoD #3).
  4. o `runs/{id}.json` persistido NÃO contém `s3cr3t-token` em lugar nenhum (header/body/url) — contém `<redacted>` (DoD #2).
  4b. EC-2: um 2º segredo com chars especiais (`HODOR_SECRET_QKEY="a/b+c=d"`) usado em QUERY STRING e BODY → o run persistido não contém NEM a forma crua (`a/b+c=d`) NEM a encodada (`a%2Fb%2Bc%3Dd`) — prova o invariante de encoding (sem isso o E2E daria falsa confiança).
  5. o artefato de review (após verdict) também NÃO contém o segredo.
  6. cenário com `${{ env.NAO_EXISTE }}` → `ScenarioError` (D6).
  7. um env var não-prefixado (ex.: um segredo de sistema simulado) NÃO é acessível via `${{ env.X }}`.

**Acceptance:** E2E verde; os 3 DoDs do ROADMAP §M7 demonstrados (auth via env; segredo nunca persistido; endpoint autenticado real passa).

**DoD (Final Phase):** `npx vitest run` (suíte completa) verde; `tsc --noEmit` 0 erros; `npm audit` 0 vulns (ZERO dep nova); coverage core novos ≥ 90%; backward-compat M0-M6 verde; CHANGELOG `[Unreleased] § Added` + `§ Security`.

#### Concurrency tests
(none — single-threaded).

#### Failure scenarios
- **Endpoint exige auth e o secret está ausente** (`${{ env.TOKEN }}` sem `HODOR_SECRET_TOKEN`): `ScenarioError` ANTES da execução (D6) — não dispara request sem auth. Reproduzido em T1.1/T3.1.
- **Segredo ecoado na resposta** (servidor devolve o token no body): `redactSecretValues` redige o response body também. Reproduzido em T1.2.
- **Env var não-prefixado** (`${{ env.PATH }}`): inacessível → `ScenarioError` (não vaza o PATH). Reproduzido em T2.1.
- **Segredo como substring de outro**: longest-first evita redação parcial. Reproduzido em T1.2.

## Coverage Matrix

| # | Gap / Requirement (ROADMAP §M7 DoD) | Task(s) | Resolution |
|---|---|---|---|
| 1 | DoD #1 — `${{ env.NOME }}` resolve no run time | T1.1, T2.1 | `secrets` em deps + namespace `env.*` + `resolveHodorSecrets` |
| 2 | DoD #2 — segredo NUNCA persistido em runs/reviews/drafts | T1.2, T1.3, T2.1 | `redactSecretValues` por valor antes de persist + no diff; reviews lê run já redigido; drafts é template |
| 3 | DoD #3 — E2E auth via env contra endpoint real passa | T3.1 | E2E com servidor que exige Bearer |
| 4 | Segurança — não expor `process.env` inteiro (exfiltração) | T2.1 | allowlist por prefixo `HODOR_SECRET_*` |
| 5 | Risco — segredo em header não-sensível/body/url | T1.2 | redação por VALOR (complementa o por-nome do M3) |
| 6 | Backward-compat M0-M6 + ZERO dep nova | T1.1, T3.1 | `secrets?` opcional; reusa interpolate; process.env stdlib |

**Coverage: 6/6 gaps cobertos (100%)**

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (stdlib) `process.env` | — | node | fonte de secrets no adaptador (D1) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | — | `process.env` é stdlib; `interpolate` (M1) já aceita `env.NOME`; redação é string-replace nativo. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Global DoD

- Todos os testes verdes; `tsc --noEmit` 0 erros; `npm audit` 0 vulns.
- ZERO dependência nova.
- Coverage dos arquivos core novos (`redactSecrets.ts`) + alterados ≥ 90%.
- DIP: `grep -rn 'from "../web"\|from "../mcp"' src/core/` vazio; o core NÃO lê `process.env` (`grep -rn 'process.env' src/core/` vazio).
- NENHUM valor de segredo aparece em `runs/`/`reviews/` (E2E assere) nem em log de stderr.
- CHANGELOG `[Unreleased] § Added` + `§ Security` com a entrada do M7.
- Os 3 DoDs do ROADMAP §M7 validados empiricamente pelo E2E.

## Drawbacks & Risks

| Risco | Severidade | Mitigação | Owner |
|---|---|---|---|
| Segredo vazar em sink persistido (risco #1 ROADMAP) | Alta | `redactSecretValues` por valor em TODOS os sinks (run antes de persist, diff, structuredContent); reviews lê run já redigido; E2E assere ausência | dev |
| Exfiltração de env var arbitrário via cenário malicioso (SSRF+secret do M6) | Alta | allowlist por prefixo `HODOR_SECRET_*` — só env opt-in é injetável | dev |
| Segredo em log de stderr | Média | nunca logar o valor (só nomes/contagem); revisão garante | dev |
| Redação parcial quando um segredo é substring de outro | Baixa | longest-first (algoritmo keploy) | dev |

## Unresolved Questions

(none — every decision is resolved at plan time; design fixado no blueprint e escopo de parsimônia neste plano.)
