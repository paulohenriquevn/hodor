import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApiServer } from "../../src/api/server.js";
import { buildRunEnvelope, persistRun, type RunStep } from "../../src/core/index.js";
import { routes } from "./App";
import { setApiBase } from "./api";

/**
 * E2E M8 (DoD #3): o loop de revisão completo roda na SPA React contra a API REST
 * REAL (porta efêmera) — lista → detalhe → registrar verdict. Prova paridade de
 * leitura (DoD #2) + verdict. O SSR nativo permanece intocado (ADR-7).
 */

const step: RunStep = {
  request: { method: "GET", url: "http://api/x", headers: {} },
  response: {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json" },
    body: '{"ok":true}',
    timings: { startedAt: "2026-06-20T00:00:00.000Z", durationMs: 1 },
  },
  asserts: [{ source: "status", op: "equals", expected: 200, actual: 200, pass: true }],
};
const UUID = "00000000-0000-0000-0000-0000000000aa";

let server: Server;
let runsDir: string, vDir: string, rDir: string, dDir: string;

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "hodor-e2e-"));
  vDir = await mkdtemp(join(tmpdir(), "hodor-e2e-v-"));
  rDir = await mkdtemp(join(tmpdir(), "hodor-e2e-r-"));
  dDir = await mkdtemp(join(tmpdir(), "hodor-e2e-d-"));
  await persistRun(buildRunEnvelope([step], { now: () => 0, newId: () => UUID }, "cenário-e2e"), runsDir);
  server = buildApiServer(runsDir, vDir, rDir, dDir);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  setApiBase(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  setApiBase("");
  for (const d of [runsDir, vDir, rDir, dDir]) await rm(d, { recursive: true, force: true });
});

describe("E2E M8 — loop de revisão na SPA contra a API real", () => {
  it("e2e_m8_review_loop_parity_in_spa", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/"] });
    render(<RouterProvider router={router} />);

    // 1. listagem carrega o run da API (paridade — DoD #2)
    const link = await screen.findByRole("link", { name: /00000000/ });
    expect(screen.getByText("cenário-e2e")).toBeInTheDocument();

    // 2. navega para o detalhe
    fireEvent.click(link);
    await screen.findByText("http://api/x"); // request renderizado
    expect(screen.getByLabelText("status 200")).toBeInTheDocument(); // response status

    // 3. registra verdict (DoD #3) — humano único aprovador
    fireEvent.click(screen.getByText("Aprovar"));

    // 4. a API persistiu o verdict + o artefato de review versionável
    await waitFor(async () => {
      const reviews = await readdir(rDir);
      expect(reviews).toContain(`${UUID}.json`);
    });
    const artifact = JSON.parse(await readFile(join(rDir, `${UUID}.json`), "utf8")) as {
      verdict: { verdict: string };
    };
    expect(artifact.verdict.verdict).toBe("approved");
  });
});
