# Changelog

All notable changes to Hodor are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/) + [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Bootstrap do repositório: tooling do ecossistema Cycle (`.claude/`), `ROADMAP.md` macro (M0–M5) e `.gitignore`.

### Fixed
- `rules/discover-plan-thresholds.txt`: bandas de verdict estavam em formato `KEY = VALUE`, incompatível com o parser pipe-delimited de `run_discover_plan_score.py`; o gate `/discover-plan-confidence` retornava `INVALID` para qualquer plano (até score 100 sem hard caps). Corrigido para a convenção `BAND|threshold` (igual a `plan-confidence-thresholds.txt`).
