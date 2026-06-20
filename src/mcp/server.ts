import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  executeRequest,
  buildRunEnvelope,
  persistRun,
  RunEnvelopeSchema,
  runScenario,
  ScenarioSchema,
  ProvenanceSchema,
  saveDraft,
  scenarioKey,
  pruneRunHistory,
  checkScenario,
  replaySuite,
  redactSecretValues,
  scrubSecretsFromText,
  type RunEnvelope,
} from "../core/index.js";
import { resolveHodorSecrets } from "./secrets.js";

/**
 * WIRE-1: error path. `executeRequest` embute a URL interpolada (segredo encodado)
 * na mensagem de erro; sem isto, um alvo caído vazaria o segredo ao agente/stderr.
 * Roda a tarefa e, em caso de erro, redige os valores de segredo da mensagem e re-lança.
 */
async function withSecretScrub<T>(secrets: Record<string, string>, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (err) {
    const values = Object.values(secrets);
    if (err instanceof Error && values.length > 0) err.message = scrubSecretsFromText(err.message, values);
    throw err;
  }
}

/** Retenção (M5 D5): poda o histórico do cenário após persistir um run. Best-effort
 * (falha de poda não derruba a tool — o run já foi gravado). */
async function pruneAfterPersist(env: RunEnvelope): Promise<void> {
  try {
    const { removed, pinned, kept } = await pruneRunHistory(scenarioKey(env));
    // Observável (pillar c, F-wire-1): a retenção (risco #2) loga no SUCESSO, não só na falha.
    console.error(JSON.stringify({ event: "prune_history", scenario: scenarioKey(env), removed, pinned, kept }));
  } catch (err) {
    console.error(JSON.stringify({ event: "prune_failed", error: String(err) }));
  }
}

/**
 * Adaptador MCP (ADR D1/D2/D5). Expõe a tool `run_request` sobre stdio,
 * delegando 100% ao core. NADA vai a stdout além do protocolo MCP — todo
 * diagnóstico vai a `console.error` (stderr).
 */

// Runtime metric (ADR D5 / wiring triad pillar c): contadores de runs executados.
let runCount = 0;
export function getRunCount(): number {
  return runCount;
}

let scenarioRunCount = 0;
export function getScenarioRunCount(): number {
  return scenarioRunCount;
}

let draftSavedCount = 0;
export function getDraftSavedCount(): number {
  return draftSavedCount;
}

let checkCount = 0;
export function getCheckCount(): number {
  return checkCount;
}

let replayCount = 0;
export function getReplayCount(): number {
  return replayCount;
}

/** Constrói o McpServer configurado (sem conectar) — permite teste in-memory. */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "hodor", version: "0.1.0" });

  server.registerTool(
    "run_request",
    {
      title: "Run HTTP request",
      description:
        "Executa um HTTP request, captura request/response/headers e persiste o run em arquivo.",
      inputSchema: {
        method: z.string(),
        url: z.string().url(),
        headers: z.record(z.string()).optional(),
        body: z.string().optional(),
      },
      // F-dom-1: declara o contrato do payload estruturado (RunEnvelope) — o SDK
      // o publica em tools/list e valida structuredContent na fronteira MCP.
      outputSchema: RunEnvelopeSchema.shape,
    },
    async ({ method, url, headers, body }) => {
      // Caller de produção do core (wiring triad pillar a).
      const step = await executeRequest({ method, url, headers, body });
      const env = buildRunEnvelope([step]);
      const path = await persistRun(env);
      await pruneAfterPersist(env); // M5: retenção last-N por cenário
      runCount += 1;
      // Runtime metric em stderr (pillar c) — stdout é do protocolo.
      console.error(
        JSON.stringify({
          event: "run_request",
          status: step.response.status,
          durationMs: step.response.timings.durationMs,
          path,
        }),
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(env, null, 2) }],
        structuredContent: env,
      };
    },
  );

  // M1 — tool de cenário multi-step (ADR D5). Delega 100% à engine do core.
  server.registerTool(
    "run_scenario",
    {
      title: "Run multi-step scenario",
      description:
        "Executa um cenário multi-step (steps com captura de variáveis + asserts), persiste o run e retorna o resultado por step.",
      inputSchema: ScenarioSchema.shape,
      outputSchema: RunEnvelopeSchema.shape,
    },
    async (scenario) => {
      // M7: resolve segredos allowlisted (HODOR_SECRET_*) do ambiente do processo.
      const secrets = resolveHodorSecrets(process.env);
      const executed = await withSecretScrub(secrets, () => runScenario(scenario, { secrets }));
      // M7 CHOKE POINT (EC-3): redige os VALORES de segredo ANTES de TODO persistRun
      // e do structuredContent — o segredo nunca toca o disco nem volta ao agente.
      const env = redactSecretValues(executed, Object.values(secrets));
      const path = await persistRun(env);
      await pruneAfterPersist(env); // M5: retenção last-N por cenário
      scenarioRunCount += 1;
      console.error(
        JSON.stringify({ event: "run_scenario", steps: env.steps.length, path }),
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(env, null, 2) }],
        structuredContent: env,
      };
    },
  );

  // M4 — tool de geração assistida (ADR D1). O AGENTE (cliente MCP) monta o
  // Scenario; esta tool VALIDA + PERSISTE como DRAFT (não executa, não aprova).
  // `provenance` é OBRIGATÓRIA aqui (um draft sempre tem origem).
  server.registerTool(
    "save_scenario_draft",
    {
      title: "Save scenario draft (agent-generated)",
      description:
        "Persiste um cenário CANDIDATO gerado pelo agente como rascunho não-aprovado em drafts/{id}.json (commitável). NÃO executa nem aprova — a aprovação é o verdict humano (M2/M3).",
      inputSchema: { ...ScenarioSchema.shape, provenance: ProvenanceSchema },
      outputSchema: { draftId: z.string(), path: z.string() },
    },
    async (scenario) => {
      // Caller de produção de saveDraft (wiring triad pillar a). Delega ao core.
      const { draftId, path } = await saveDraft(scenario);
      draftSavedCount += 1;
      console.error(
        JSON.stringify({ event: "save_scenario_draft", draftId, origin: scenario.provenance.origin, path }),
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ draftId, path }, null, 2) }],
        structuredContent: { draftId, path },
      };
    },
  );

  // M6 — gate de regressão (ADR D4). check_scenario re-roda + diff vs golden;
  // retorna veredito ESTRUTURADO (outputSchema) consumível por máquina. Persiste o
  // run novo (consistência com run_scenario) e poda. NUNCA grava verdict.
  server.registerTool(
    "check_scenario",
    {
      title: "Check scenario against approved golden",
      description:
        "Executa um cenário contra o serviço atual e compara com o último run APROVADO (golden), retornando {status: ok|regression|no_baseline}. NÃO aprova — o verdict humano (M2) é o único aprovador.",
      inputSchema: ScenarioSchema.shape,
      outputSchema: {
        status: z.enum(["ok", "regression", "no_baseline"]),
        runId: z.string(),
        goldenRunId: z.string().nullable(),
        noiseChanged: z.boolean(),
      },
    },
    async (scenario) => {
      // M7: passa segredos allowlisted; checkScenario redige o run antes do diff e do retorno (T1.3).
      const secrets = resolveHodorSecrets(process.env);
      const { status, run, goldenRunId, noiseChanged } = await withSecretScrub(secrets, () =>
        checkScenario(scenario, { deps: { secrets } }),
      );
      const path = await persistRun(run); // o run novo (já redigido) entra no histórico p/ revisão
      await pruneAfterPersist(run);
      checkCount += 1;
      // goldenRunId → o agente busca o diff completo via web (/runs/:id/diff?vs=golden);
      // noiseChanged → mesmo em `ok`, sinaliza que regras de noise divergiram (F-dom-1/D4).
      const out = { status, runId: run.runId, goldenRunId, noiseChanged };
      console.error(JSON.stringify({ event: "check_scenario", status, runId: run.runId, goldenRunId, noiseChanged, path }));
      return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }], structuredContent: out };
    },
  );

  // M6 — replay de suíte (ADR D5). Roda todos os cenários do catálogo com golden e
  // agrega pass/fail — o gate que o agente invoca antes de declarar a mudança pronta.
  server.registerTool(
    "replay_suite",
    {
      title: "Replay approved scenarios as a regression gate",
      description:
        "Roda todos os cenários do catálogo (drafts/) que têm golden aprovado contra o serviço atual e retorna um relatório agregado pass/fail. allOk=false quando há regressão ou erro.",
      inputSchema: {},
      outputSchema: {
        allOk: z.boolean(),
        total: z.number(),
        ok: z.number(),
        regression: z.number(),
        noBaseline: z.number(),
        error: z.number(),
        uncataloguedGoldens: z.number(),
      },
    },
    async () => {
      // M7: cenários autenticados do catálogo recebem os segredos; checkScenario
      // (dentro do replaySuite) redige antes de qualquer comparação. replaySuite NÃO
      // persiste runs (só agrega status) → nenhum sink de segredo aqui.
      const r = await replaySuite({ deps: { secrets: resolveHodorSecrets(process.env) } });
      replayCount += 1;
      // uncataloguedGoldens → o agente sabe quantos cenários aprovados NÃO estão na suíte (F-dom-2).
      const out = { allOk: r.allOk, total: r.total, ok: r.ok, regression: r.regression, noBaseline: r.noBaseline, error: r.error, uncataloguedGoldens: r.uncataloguedGoldens };
      console.error(JSON.stringify({ event: "replay_suite", ...out }));
      return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }], structuredContent: out };
    },
  );

  return server;
}

/** Entrypoint stdio: conecta o server ao transporte real. */
async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("hodor MCP server running on stdio");
}

// Só conecta stdio quando executado como entrypoint (não em teste/import).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error in hodor MCP server:", error);
    process.exit(1);
  });
}
