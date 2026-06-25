import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Build/dev da SPA (M8 ADR-2/3). Root = `web/`. Em dev, `/api` é proxyado para a
 * API REST Node (porta 4100) — a SPA fala SÓ HTTP com o backend (fronteira DIP).
 * Em prod, `vite build` gera `web/dist`, servido pela própria API Node.
 */
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4100",
    },
    // Permite importar o módulo browser-safe `src/core/contentType.ts` (1 fonte
    // SSR+SPA — ADR-5). Apenas type-imports do resto do core (erased no build).
    fs: { allow: [".."] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
