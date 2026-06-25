# Changelog

All notable changes to Hodor are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/) + [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.8.0] - 2026-06-20

### Added
- **M8 — Fundação V3: API REST + SPA React (paridade de revisão):** abre o V3 (UX/DX SOTA, híbrido agente-first). Uma **API REST** fina (`src/api/server.ts`, `http` nativo — sem framework) expõe o core via JSON sob `/api/*`: `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/diff?vs=golden|previous`, `POST /api/runs/:id/verdict`, `GET /api/drafts`, `GET /api/drafts/:id`, `GET /api/reviews/:id` — ZERO regra de domínio (delega ao core, espelhando os adaptadores MCP/SSR). Uma **SPA React** (`web/`, Vite + TypeScript + shadcn/ui + Tailwind) com **paridade de leitura** da web SSR: listagem (selo golden 🏆, badge regressão ⚠, origem 🤖), detalhe req/resp/headers por step com status colorido por classe HTTP + tabs body/headers, diff vs golden/anterior, e o loop de verdict humano. Em produção a própria API serve a SPA buildada (`web/dist`) + SPA fallback; em dev, Vite proxya `/api`. Scripts: `npm run api`, `npm run dev:web`, `npm run build:web`. O SSR nativo (`npm run web`) permanece funcional em paralelo. Provado pelo E2E `e2e_m8_review_loop_parity_in_spa` (lista→detalhe→verdict na SPA contra a API real). 286 testes (node + jsdom), 0 vulnerabilidades. **Humano segue único aprovador (contrato M2 intacto).**


### Changed
- **`buildListing` extraído para o core** (`src/core/listing.ts`) a partir de `web/server.ts::listRuns` — fonte única da listagem (golden/regressão/origem) consumida pelo SSR e pela API REST (DRY). `pickRenderer`/`truncate`/`renderBody` movidos para `src/core/contentType.ts` (browser-safe) — mesma lógica de dispatch por content-type no SSR e na SPA (paridade real).

## [0.7.0] - 2026-06-20

### Added
- **M7 — Injeção de env/secrets no run time (remove o teto de auth do M6):** cenários passam a testar APIs **autenticadas** — um header `Authorization: Bearer ${{ env.TOKEN }}` resolve o segredo no run time a partir de variáveis de ambiente, e executa contra a API real. Só env vars com o prefixo **`HODOR_SECRET_*`** são injetáveis (allowlist por construção, prefixo removido na exposição: `HODOR_SECRET_TOKEN` → `${{ env.TOKEN }}`) — `process.env` NUNCA é exposto inteiro. Segredo de env ausente → erro explícito (fail-fast). Reusa a interpolação `${{ }}` do M1 (sem mudança) e `process.env` (stdlib). ZERO dependência nova.


### Security
- **M7 (review) — Redação fechada em TODOS os sinks (achados do review adversarial):** além de url/headers/body/captures, `redactSecretValues` agora redige `response.statusText` (reason phrase — persistido + commitável no review) e o `name` do cenário; cobre as variantes `encodeURI` e **JSON-escaped** do valor (segredo com aspas/barras no body); e o **error path** é redigido (`scrubSecretsFromText`) — um alvo caído não vaza mais o segredo (encodado na URL) na mensagem de erro ao agente/stderr. Drop de secret inválido (curto/vazio/sem-sufixo) é diagnosticado em stderr por NOME (`secret_dropped`), nunca pelo valor.
- **M7 — Redação por VALOR de segredos em todos os sinks:** o segredo injetado (token resolvido) NUNCA é persistido. `redactSecretValues` substitui cada valor por `<redacted>` em url/headers/body/captures + response de TODO run, no **choke point** antes de qualquer `persistRun` e no `structuredContent` retornado ao agente — cobrindo o gap da redação por-nome do M3 (segredo em header não-sensível/body/url). Cobre TAMBÉM a forma `encodeURIComponent` do valor (o segredo é persistido encodado na URL — sem isso vazaria encodado). Longest-first (algoritmo do keploy) evita redação parcial. Segredos < 4 chars não são injetáveis (evita over-redaction). Mitiga o vetor SSRF+secrets: cenário não pode exfiltrar env var arbitrário (só `HODOR_SECRET_*` é injetável).

## [0.6.0] - 2026-06-19

### Added
- **M5 — Regressão: diff entre runs + anti-flaky:** o sistema compara o run atual com o anterior do mesmo cenário e destaca mudanças de comportamento (status/headers/body) na web app (`GET /runs/:id/diff`). Normalização de campos voláteis em duas camadas, com regras **inspecionáveis**: headers/timings via `normalizeRun` (M3) + **corpo da resposta** via regras de `noise` (jsonpaths) declaradas no cenário (`noise?: string[]`, aditivo) e mascaradas com sentinela visível `"<noise>"` (`maskNoise`, reusa `jsonpath-plus`). Identidade de cenário (`scenarioKey` = `name` ou hash dos `{method,url}`) agrupa o histórico comparável; retenção **last-N por cenário** (`HODOR_RUN_HISTORY_LIMIT`, default 10) evita crescimento ilimitado — e **nunca descarta um run aprovado** (com verdict). Fecha a limitação de body-noise deferida no M3. Campos opcionais (`schemaVersion:1` preservado) — cenários/runs M0-M4 seguem válidos. ZERO dependência nova.
- **M6 — Fechar o loop: golden baseline + gate de regressão (abre o V2):** o agente passa a CONSUMIR a aprovação, não só produzi-la. Novo conceito de **golden run** (`findGoldenRun`): o run mais recente do cenário com verdict `approved`. Nova tool MCP `check_scenario` que re-executa um cenário contra o serviço atual e retorna um veredito **estruturado** `{status: "ok"|"regression"|"no_baseline"}` comparando vs golden (via `diffRuns` do M5) — **nunca auto-aprova** (o verdict humano segue o único aprovador). Nova tool MCP `replay_suite` que roda todos os cenários do catálogo (`drafts/`) com golden e devolve um relatório agregado `{allOk, total, ok, regression, noBaseline, error}` — o gate que o agente invoca antes de declarar uma mudança pronta; cada cenário é isolado (um serviço-alvo caído vira `error`, não derruba a suíte). Web: `GET /runs/:id/diff?vs=golden` compara vs golden aprovado (além de vs anterior) e a listagem marca runs que regridem (badge ⚠ regressão). Cenário editado desde a aprovação → `no_baseline` (golden órfão). Teto conhecido: re-execução real ainda não injeta segredos — endpoints autenticados precisam do M7. ZERO dependência nova (composição de M1/M2/M5).


### Changed
- **M6.1 — UX do gate (surgido no dogfooding ao vivo):** a listagem agora marca com **🏆 golden** o run que É o baseline aprovado atual de cada cenário (antes não dava para saber qual dos runs aprovados era o baseline). E a página do run **avisa** quando se vai aprovar um run com **asserts falhando** ("aprová-lo o tornará o baseline de regressão (golden)") — protege o humano-no-gate de promover um comportamento quebrado por engano. Não bloqueia (o humano decide); só torna visível a consequência.


### Security
- **M6 — `replay_suite` re-executa drafts commitáveis (vetor SSRF amplificado, documentado):** `replay_suite` itera `drafts/` (commitável por design) e re-executa cada cenário contra a rede. Um draft malicioso commitado por um terceiro (via PR/merge) faria o gate disparar requests HTTP arbitrários a partir do conteúdo do repositório, sem confirmação humana no replay — amplificação do SSRF já inerente ao `run_scenario` (M1), agora a partir de conteúdo persistido. Threat model atual: uso interno single-user e o agente é confiável; mitigação técnica (allowlist de hosts opt-in via env na fronteira `executeRequest`) é candidata ao M7. **Não execute `replay_suite` sobre drafts de origem não-confiável.**
- **M6 — semântica do gate (both-broken):** o gate compara COMPORTAMENTO vs golden (regressão = mudou), não validade absoluta. Um serviço consistentemente quebrado (golden 500 + atual 500 idêntico) retorna `ok` (sem mudança). Os asserts do cenário continuam visíveis no run para o humano; o gate é especificamente sobre *regressão*, não sobre *correção*.

## [0.5.0] - 2026-06-19

### Added
- **M4 — Geração de cenários assistida pelo agente:** nova tool MCP `save_scenario_draft` — o agente monta um cenário candidato (a partir de endpoint/curl/OpenAPI que ele lê) e o submete; a tool valida (zod) e persiste como **rascunho não-aprovado** em `drafts/{draftId}.json` (commitável, para o humano editar/refinar no git antes de aprovar). Proveniência aditiva (`provenance: {origin, sourceKind, sourceRef?, generatedAt}`) propaga `Scenario → RunEnvelope → ReviewArtifact`, e a web app marca os runs gerados como **"🤖 gerado pelo agente · pendente de revisão"** na listagem e na visão do run. A aprovação continua sendo EXCLUSIVAMENTE o verdict humano (M2) → `reviews/` (M3) — a tool nunca executa nem auto-aprova. `drafts/` é commitável; `runs/`+`verdicts/` permanecem efêmeros. Campos opcionais (`schemaVersion:1` preservado) — cenários/runs M0-M3 seguem válidos. ZERO dependência nova (o agente parseia curl e gera asserts nativamente; parser de curl embutido deferido).


### Security
- **M4 — Redação de credenciais no draft commitável:** como `drafts/{id}.json` é commitável, `saveDraft` redige (`<redacted>`) os headers de request sensíveis do cenário (`authorization`, `cookie`, `x-api-key`, ...) reusando o redator do M3, e faz redação best-effort de credenciais embutidas em `provenance.sourceRef` (ex.: curl com `-H "Authorization: Bearer ..."`). `provenance.sourceRef` ganhou bound de tamanho (`max 4096`). Resíduo conhecido: segredos embutidos na URL/body do cenário não são redigidos — o agente não deve embuti-los (use interpolação `${{ var }}`). A url de cada step do draft é validada na fronteira (URL absoluta ou template) — url-lixo é rejeitada fail-fast.

## [0.4.0] - 2026-06-19

### Added
- **M3 — Persistência versionável + estado de revisão (fecha o V1):** ao registrar um verdict, o sistema escreve um **artefato de review versionável** em `reviews/{runId}.json` — cenário + run normalizado + verdict — serializado de forma **determinística** (`stableStringify`: chaves ordenadas) com os **campos voláteis de protocolo removidos** (`normalizeRun`: `response.timings` + headers voláteis de resposta como `date`/`etag`/`x-request-id` + prefixos `x-amz-`/`x-amzn-`/`cf-`), validado por zod e versionado por `artifactVersion`. Dois runs do mesmo cenário produzem `steps` byte-idênticos (diff estável). `reviews/` é commitável (diff-amigável no git); `runs/` (run bruto) e `verdicts/` (store ao-vivo da web app) permanecem efêmeros/gitignored. Fecha o critério de V1: o loop agente→execução→revisão→verdict fica registrado em arquivos commitáveis. ZERO dependência nova.


### Security
- **M3 — Redação de credenciais no artefato versionável:** como `reviews/{runId}.json` é commitável, `normalizeRun` redige (`<redacted>`) os headers de **request** sensíveis (`authorization`, `cookie`, `x-api-key`, `proxy-authorization`, `x-auth-token`, etc.) antes de gravar — a chave é preservada para o revisor, o valor nunca vai para o git. `runId` é validado como path-safe antes do path-join (defense-in-depth).

## [0.3.0] - 2026-06-19

### Added
- **M2 — Web app de review (req/resp/headers + verdict):** a web app de review (`GET /`) lista os runs (cenário/data/steps/resumo pass-fail/verdict) e, por run, exibe request/response/headers de cada step com asserts (pass/fail evidente em verde/vermelho); o humano registra um verdict (aprovado/rejeitado + nota opcional) via `POST /runs/:id/verdict`, validado e persistido em `verdicts/{runId}.json`; render robusto por content-type (`pickRenderer`: JSON pretty / texto / binário omitido) com truncamento de payloads grandes. Server-rendered nativo (HTTP + HTML, ZERO framework). O envelope de run ganhou `name` (nome do cenário) de forma aditiva/opcional — backward-compatible.

## [0.2.0] - 2026-06-18

### Added
- **M1 — Modelo de cenário multi-step + asserções:** cenário declarativo JSON (`{schemaVersion, name, steps[]}`) validado por zod; engine `runScenario` que executa os steps em ordem, propaga variáveis capturadas (jsonpath/regex via `jsonpath-plus`) e avalia asserts (`{source, op, value}` → `{pass, expected, actual}`) sobre status/headers/body; cada step do run registra request/response/headers + asserts (pass/fail) + variáveis capturadas; tool MCP `run_scenario`; web app renderiza asserts (verde/vermelho) e captures por step; loop multi-step provado por teste E2E. Reusa o envelope do M0 (RunStep estendido de forma aditiva/opcional — backward-compatible).

## [0.1.0] - 2026-06-18

### Added
- Bootstrap do repositório: tooling do ecossistema Cycle (`.claude/`), `ROADMAP.md` macro (M0–M5) e `.gitignore`.
- **M0 — Walking skeleton:** tool MCP `run_request` (stdio) que executa um HTTP request e captura request/response/headers; persistência do run num envelope versionado `{schemaVersion, steps[]}` sob `runs/`; web app mínima que lê e renderiza request/response/headers; loop E2E agente→execução→arquivo→web app provado por teste. Stack TS/Node ESM; core desacoplado dos adaptadores (DIP).


### Fixed
- `rules/discover-plan-thresholds.txt`: bandas de verdict estavam em formato `KEY = VALUE`, incompatível com o parser pipe-delimited de `run_discover_plan_score.py`; o gate `/discover-plan-confidence` retornava `INVALID` para qualquer plano (até score 100 sem hard caps). Corrigido para a convenção `BAND|threshold` (igual a `plan-confidence-thresholds.txt`).
- `skills/plan-confidence/scripts/check_evidence_citations.py`: `_scan_blueprint_refs` só resolvia blueprints em `<root>/knowledge-base/discoveries/blueprints/`, ignorando o layout `.claude/knowledge-base/...` (que `_resolve_rule_file` já suportava). Citação a blueprint existente era reportada como `fabricated_citation` → `/plan-confidence` INVALID falso. Corrigido para tentar ambos os layouts.

