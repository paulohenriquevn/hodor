# Deps Audit: m0-walking-skeleton

**Date:** 2026-06-18
**Mode:** plan-bound:m0-walking-skeleton
**Verdict:** PASS_WITH_CAVEATS
**Hard caps triggered:** [] (nenhum — após bump do vitest)

## Summary
- Ecosystems detected: npm (planejado; greenfield, sem lockfile ainda)
- Total deps audited: 6 diretas (0 existentes, 6 NEW). Transitivas: ainda não resolvidas (sem lockfile).
- Vulnerabilities found (nas versões-alvo): 1 CRITICAL — **remediada via bump antes do código**.
- Outdated: n/a (greenfield)
- Allowlist hits: 0
- Auditor coverage: { osv-scanner: instalado(1.9.2), npm: instalado(10.9.7), pip-audit: instalado(2.9.0) }; **CVE check feito via OSV API por pacote direto** — scan transitivo de lockfile DIFERIDO para T0.1 (pós `npm install`).

## Vulnerabilities (sorted by severity)

### GHSA-5xrq-8626-4rwp — CRITICAL (npm: vitest@2.x)
- **Resumo:** "When Vitest UI server is listening, arbitrary file can be read and executed" — exposição **dev-time** do servidor de UI/API do Vitest (`--ui`/`--api`), não exploitável no fluxo padrão `vitest run`.
- **Affected:** vitest 2.x (a faixa `^2.1.0` originalmente planejada incluía 2.1.9, vulnerável).
- **Fixed in:** vitest 4.x — `4.1.9` confirmado CLEAN via OSV.
- **Diff suggestion (aplicado ao plano v1.1, não ao manifest — manifest é criado na T0.1):**
  ```diff
  - "vitest": "^2.1.0"
  + "vitest": "^4.1.0"
  ```
- **Plan reference:** plano bumpou a dep para `^4.1.0` na seção `## Dependencies`. Remediação por **code fix** (bump), não por allowlist (golden rule: CRITICAL exige fix ou ADR).

## Outdated (non-vulnerable)
n/a — greenfield, sem versões instaladas a comparar.

## Plan validation (Mode 2)

| Plan dep | Section | Registry match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@modelcontextprotocol/sdk` `^1.20.0` | NEW | sim — latest 1.29.0 (v1.x, não alpha) | sim (OSV: 0 vulns @1.29.0) | sim (alternativas rejeitadas citadas) | OK |
| `zod` `^3.25.1` | NEW | sim — satisfaz peer do SDK `^3.25\|\|^4.0` | sim (OSV: 0 vulns @3.25.76) | sim | OK |
| `typescript` `^5.6.0` | NEW | sim — latest 6.0.3 (^5 ainda suportado) | sim (OSV: 0) | sim | OK |
| `vitest` `^4.1.0` | NEW | sim — latest 4.1.9 | sim após bump (4.x CLEAN; 2.x tinha CRITICAL) | sim | OK |
| `tsx` `^4.19.0` | NEW | sim — latest 4.22.4 | sim (OSV: 0) | sim | OK |
| `@types/node` `^22.0.0` | NEW | sim — latest 25.x | sim (OSV: 0) | sim | OK |

## Caveats (por que PASS_WITH_CAVEATS e não PASS)

1. **Scan transitivo pendente:** sem `package-lock.json` (deps ainda não instaladas), o CVE check cobriu apenas as 6 deps **diretas** via OSV API. O scan transitivo completo (`npm audit` no lockfile + `osv-scanner --lockfile`) DEVE rodar na T0.1 após `npm install`, e é um critério do gate de validação do `/implement`.
2. Compatibilidade de versão SDK↔zod confirmada (SDK 1.29 aceita zod 3 e 4); node engine `>=18` (fetch nativo disponível) confirmado.

## Recommended next steps
1. (Aplicado) plano bumpou vitest para `^4.1.0`.
2. Na T0.1, após `npm install`, rodar `npm audit --json` + `osv-scanner --lockfile=package-lock.json` e confirmar 0 CRITICAL/HIGH transitivos.
3. Prosseguir para `/plan-confidence`.
