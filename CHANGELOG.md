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

