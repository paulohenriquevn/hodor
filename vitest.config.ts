import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * M8: dois ambientes de teste no mesmo `vitest run`.
 * - `node` → backend puro (`src/**`), ambiente node (como sempre foi); mantém a
 *   cobertura do core/adaptadores.
 * - `web`  → SPA React (`web/**`), ambiente jsdom + plugin react + jest-dom.
 * A fronteira DIP fica clara também nos testes: core/adaptadores não dependem do
 * DOM; a SPA não roda em node.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          include: ["web/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          globals: true,
          setupFiles: ["./web/src/setupTests.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // web/server.ts (SSR) e api/server.ts entram na cobertura: roteamento/validação
      // reais exercitados por integração. mcp/server.ts e api main() ficam fora —
      // entrypoints (main()+connect/listen) não unit-testáveis sem subir processo.
      exclude: ["src/**/*.test.ts", "src/mcp/server.ts"],
    },
  },
});
