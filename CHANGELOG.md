# Changelog

All notable changes to Hodor are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/) + [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Bootstrap do repositório: tooling do ecossistema Cycle (`.claude/`), `ROADMAP.md` macro (M0–M5) e `.gitignore`.
- **M0 — Walking skeleton:** tool MCP `run_request` (stdio) que executa um HTTP request e captura request/response/headers; persistência do run num envelope versionado `{schemaVersion, steps[]}` sob `runs/`; web app mínima que lê e renderiza request/response/headers; loop E2E agente→execução→arquivo→web app provado por teste. Stack TS/Node ESM; core desacoplado dos adaptadores (DIP).

### Fixed
- `rules/discover-plan-thresholds.txt`: bandas de verdict estavam em formato `KEY = VALUE`, incompatível com o parser pipe-delimited de `run_discover_plan_score.py`; o gate `/discover-plan-confidence` retornava `INVALID` para qualquer plano (até score 100 sem hard caps). Corrigido para a convenção `BAND|threshold` (igual a `plan-confidence-thresholds.txt`).
- `skills/plan-confidence/scripts/check_evidence_citations.py`: `_scan_blueprint_refs` só resolvia blueprints em `<root>/knowledge-base/discoveries/blueprints/`, ignorando o layout `.claude/knowledge-base/...` (que `_resolve_rule_file` já suportava). Citação a blueprint existente era reportada como `fabricated_citation` → `/plan-confidence` INVALID falso. Corrigido para tentar ambos os layouts.
