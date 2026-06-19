# Edge Case Review — m6-golden-gate

Date: 2026-06-19
Tasks analyzed: 6 (T1.1, T2.1, T3.1, T4.1, T5.1, T6.1)
Edge cases found: 6 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 3)

> Scope: real boundary edges only. Verified against `src/core/runHistory.ts` (M5).
> The plan already covers golden-órfão (D1/T2.1), serviço fora do ar (T2.1/T6.1
> failure scenarios), e a interação de poda — ver § Não-achados confirmados.

## MUST FIX

### EC-1: `replaySuite` derruba a suíte inteira quando um cenário-alvo lança
- **Affected task:** T3.1
- **Family:** Resource / State
- **Scenario:** `replaySuite` itera o catálogo e roda `checkScenario` por draft. `checkScenario` chama `runScenario`→`executeRequest`, que propaga `RequestExecutionError` (M0) quando o serviço-alvo está fora do ar / DNS falha / conexão recusada. O plano declara explicitamente (T2.1 failure scenarios) que `checkScenario` **não mascara** esse erro — ele sobe. Num loop `for ... await checkScenario(...)` sem isolamento, a primeira exceção aborta `replaySuite` e perde os resultados dos demais cenários do catálogo. Um único serviço caído invalida toda a suíte.
- **Impact:** o gate de suíte (DoD #3) fica não-confiável: um cenário cujo backend está indisponível impede a avaliação dos cenários saudáveis. Resultado parcial perdido; `allOk` nunca é computado.
- **Suggested fix:** isolar cada item: `try { results.push(await checkScenario(...)) } catch (e) { results.push({scenarioKey, status:"error", error: String(e)}); }` e agregar `error` separado de `regression` (`allOk = regression===0 && error===0`). Adicionar status `"error"` ao schema 4-way (ok/regression/no_baseline/error).

## SHOULD TEST

### EC-2: colisão de `scenarioKey` por `name` igual com requests diferentes → golden de outro cenário
- **Affected task:** T2.1
- **Suggested test:** `test_check_scenario_does_not_match_golden_of_different_requests_same_name` — dois cenários com o MESMO `name` mas `steps[].request` distintos. `scenarioKey` usa `name` quando presente (confirmado em `runHistory.ts:26`), então ambos colidem na mesma key → `findGoldenRun` devolve o golden do cenário errado e `diffRuns` compara peças incomparáveis (falso `regression` ou falso `ok`). Assert: ou documentar que `name` é a identidade canônica (responsabilidade do agente), ou o teste fixa o comportamento atual para que ninguém o quebre silenciosamente. Herdado do M5; o M6 amplifica porque o resultado vira veredito de gate.

### EC-3: ordem de `checkScenario` — o próprio run novo não pode virar seu baseline
- **Affected task:** T2.1
- **Suggested test:** `test_check_scenario_excludes_own_run_from_golden_lookup` — confirmar que `findGoldenRun` é chamado com runs que NÃO incluem o run recém-executado (o core não persiste — só o adaptador T4.1 persiste DEPOIS). Como o run novo não tem verdict, ele jamais seria `approved`, mas o teste trava a ordem (achar golden sobre o estado pré-persistência) e protege contra uma futura refatoração que persista antes de comparar e crie um auto-baseline degenerado.

## DOCUMENT

### EC-4: cenário autenticado no replay → falso `regression` (401) indistinguível de regressão real
- **Accepted risk:** teto declarado (risco #2 do plano, D2, Drawbacks). `checkScenario` re-roda vivo; sem env/secrets (M7) um endpoint autenticado devolve 401 e o diff marca `regression` indistinguível de regressão verdadeira. Já documentado no plano; o E2E usa endpoint sem auth. M7 remove o teto. Reforço: a mensagem/relatório do gate deveria, quando viável, sinalizar "possível teto de auth" em 401 — mas isso é melhoria de M7, não bloqueia M6.

### EC-5: `check_scenario` persiste o run a cada invocação → infla `runs/`
- **Accepted risk:** D4 decide persistir o run novo no adaptador (consistência com `run_scenario`, permite revisão posterior de uma regressão). Cada check vira histórico — um gate rodado em loop pelo agente acumula runs. Mitigado pela retenção M5 (`pruneAfterPersist`, last-N por cenário), que o adaptador já chama (T4.1). Aceito: o crescimento é bounded por cenário; runs não-aprovados são podados. Sem ação.

### EC-6: run aprovado e depois run mais novo REJEITADO — golden é o aprovado, correto
- **Accepted risk:** confirmado por design. `findGoldenRun` filtra `loadVerdict==="approved"` e pega o mais recente APROVADO (D1, RED `find_golden_run_ignores_rejected`). Um run posterior `rejected` tem verdict-file (logo é PINNED pela poda M5 — `hasVerdict`, `runHistory.ts:99`) mas NÃO é golden. O golden permanece o último aprovado. Comportamento correto e já coberto pelos testes de T1.1. Sem ação — registrado para fechar a pergunta da interação M5↔M6.

## Não-achados confirmados (verificados, sem flag)

- **Golden podado pela retenção M5:** `pruneRunHistory` pina todo run com verdict-file presente (`hasVerdict`, `runHistory.ts:97-100`). Um golden é `approved` ⇒ tem verdict-file ⇒ é PINNED ⇒ nunca podado. A interação EC-1-do-M5 cobre exatamente isto. **Não é edge case** — está garantido.
- **Golden corrompido em `runs/`:** `loadAllRuns` tolera/pula JSON inválido (`runHistory.ts:50-56`). Golden inválido não derruba o gate. Já no plano (T2.1 failure scenarios).
- **Catálogo vazio:** coberto por `replay_suite_empty_catalog_is_allOk` (T3.1).

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 0 | 1 (EC-6) |
| T2.1 | 3 | 0 | 2 (EC-2, EC-3) | 1 (EC-4) |
| T3.1 | 1 | 1 (EC-1) | 0 | 0 |
| T4.1 | 1 | 0 | 0 | 1 (EC-5) |
| T5.1 | 0 | 0 | 0 | 0 |
| T6.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — EC-1 (isolamento por item em `replaySuite`) é um MUST FIX: um único serviço-alvo caído derruba toda a suíte hoje. Absorver como sub-task de T3.1 (status 4-way com `error`; `allOk = regression===0 && error===0`) e adicionar um RED `replay_suite_isolates_failing_scenario`. EC-2/EC-3 entram como testes nas TDDs existentes de T2.1. EC-4/5/6 já estão (ou devem entrar) como notas no plano.
