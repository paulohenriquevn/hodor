# Deps Audit: m1-scenario-model

**Date:** 2026-06-18
**Mode:** plan-bound:m1-scenario-model
**Verdict:** PASS_WITH_CAVEATS
**Hard caps triggered:** [] (nenhum)

## Summary
- Ecosystems: npm. Deps novas: 1 (`jsonpath-plus`). Existentes reusadas: `@modelcontextprotocol/sdk`, `zod`.
- Vulnerabilities (versão-alvo): 0.
- Auditor coverage: { osv-scanner: instalado, npm: instalado }; CVE check via OSV API por pacote direto; scan transitivo completo (`npm audit`) roda na T0.1 pós-install.

## Vulnerabilities
Nenhuma na versão-alvo.

### Nota histórica — jsonpath-plus
`jsonpath-plus` teve CVEs de RCE (ex. CVE-2024-21534) em versões **< 10.0.0** (avaliação de script em expressões). A versão-alvo **`^10.4.0`** está **CLEAN no OSV** (`jsonpath-plus@10.4.0` → 0 vulns) — o eval/script é desabilitado por default em v10+. Mitigação no plano (Drawback + ADR D2): usar SÓ path queries, nunca o modo script.

## Plan validation (Mode 2)

| Plan dep | Section | Registry match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@modelcontextprotocol/sdk` `^1.20.0` | Existing | sim (instalado 1.29.0) | sim | n/a | OK |
| `zod` `^3.25.1` | Existing | sim | sim | n/a | OK |
| `jsonpath-plus` `^10.4.0` | NEW | sim — latest 10.4.0 | sim (OSV CLEAN @10.4.0) | sim (reimpl/jsonpath/jsonquery rejeitados c/ motivo) | OK |

## Caveats (por que PASS_WITH_CAVEATS)
1. Scan transitivo completo de `jsonpath-plus` (deps transitivas) roda na T0.1 via `npm audit` pós-install (critério do gate do `/implement`).
2. Constraint de uso: jsonpath-plus restrito a path queries (sem eval) — verificável no review (`evalCapture.ts` não usa o modo script).

## Recommended next steps
1. Na T0.1, `npm install` + `npm audit` → confirmar 0 CRITICAL/HIGH transitivos.
2. Prosseguir para `/plan-confidence`.
