import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // web/server.ts entra na cobertura (F-tests-1): roteamento/validação reais,
      // exercitados por testes de integração. mcp/server.ts fica fora — é o
      // entrypoint stdio (main()+connect), não unit-testável sem subir processo.
      exclude: ["src/**/*.test.ts", "src/mcp/server.ts"],
    },
  },
});
