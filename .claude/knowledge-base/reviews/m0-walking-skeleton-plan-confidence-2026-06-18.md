# Plan-Confidence — m0-walking-skeleton

Date: 2026-06-18
Plan: knowledge-base/plans/m0-walking-skeleton-plan.md (v1.1)

## Verdict: **SHIPPABLE** (final score 98.0)

| Dimension | Score |
|---|---|
| completude | 100.0 |
| risco_estrutural | 95.0 |

- `hard_caps_triggered`: [] (none)
- Coverage Matrix: 100% (7/7 gaps), 0 orphan tasks
- Citations: 53 total, 0 fabricated (blueprint resolve via fix de layout `.claude/`)
- Acceptance criteria: acceptable_ratio 0.882 (≥0.80); 0 vague
- Concurrency tests: complete (escape `(none — single-threaded)` por task)
- Failure scenarios: complete (5xx capturado / connection-refused / timeout)
- Architecture compliance: 1.0 (cita architecture.md, testing.md, parsimony-ladder.md, etc.)
- Smells residuais: 2 (1 subjective adjective, 1 weak imperative) — não-capping

## Tooling fixes aplicados nesta fase (bugs reais, não gaming)

1. **`skills/plan-confidence/scripts/check_evidence_citations.py`** — `_scan_blueprint_refs` só procurava blueprints em `<root>/knowledge-base/discoveries/blueprints/`, ignorando o layout `.claude/knowledge-base/...` (que `_resolve_rule_file` já suportava). Resultado: blueprint REAL e existente era reportado como `fabricated_citation` → INVALID falso. Corrigido para tentar ambos os layouts. Logado em CHANGELOG `[Unreleased] § Fixed`.
2. **Diagnóstico de matching:** o checker de concorrência (`_strip_code`) apaga blocos ```fenced``` antes do match — o escape `(none — single-threaded)` precisa ser texto plano (não fenced). Ajustado no plano (não é bug, é contrato do checker; o template do skill induzia ao erro ao pôr o escape em fence).

## Melhorias reais no plano (v1.0 → v1.1)

- EC-1 (MUST-FIX): validação anti path-traversal no `GET /runs/:id`.
- EC-2/EC-3 (SHOULD-TEST): GET-com-body; headers repetidos (Set-Cookie).
- EC-4 (DOCUMENT): SSRF aceito para M0 local.
- deps-audit: vitest bumpado `^2.1.0`→`^4.1.0` (GHSA-5xrq-8626-4rwp CRITICAL em 2.x); zod alinhado ao peer do SDK.
- Coverage gap #6 mapeado a tasks concretas; typo T0.2→T0.1.
- Acceptance criteria reforçados com comandos/oracles em backtick.

## Next

Verdict ≥ SHIPPABLE_WITH_CAVEATS → pronto para `/implement m0-walking-skeleton`.
