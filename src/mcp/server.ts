import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { executeRequest, buildRunEnvelope, persistRun } from "../core/index.js";

/**
 * Adaptador MCP (ADR D1/D2/D5). Expõe a tool `run_request` sobre stdio,
 * delegando 100% ao core. NADA vai a stdout além do protocolo MCP — todo
 * diagnóstico vai a `console.error` (stderr).
 */

// Runtime metric (ADR D5 / wiring triad pillar c): contador de runs executados.
let runCount = 0;
export function getRunCount(): number {
  return runCount;
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
    },
    async ({ method, url, headers, body }) => {
      // Caller de produção do core (wiring triad pillar a).
      const step = await executeRequest({ method, url, headers, body });
      const env = buildRunEnvelope([step]);
      const path = await persistRun(env);
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
