import { createServer, type Server } from "node:http";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { loadRun, defaultRunsDir } from "../core/index.js";
import { renderRun } from "./render.js";

/**
 * Adaptador web (ADR D2/D4): servidor HTTP nativo que LÊ um run e o renderiza.
 * Não executa requests (essa é a função do core/MCP) — fronteira mantida.
 * Caller de produção de loadRun + renderRun.
 */

// EC-1: o id da URL é input do usuário. Allowlist estrita (forma UUID) ANTES de
// montar o path → bloqueia path-traversal (`../`, `%2f`, null bytes, etc.).
const RUN_ID_RE = /^[0-9a-f-]{36}$/i;

async function latestRunId(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const jsons = entries.filter((e) => e.endsWith(".json"));
  let newest: { id: string; mtimeMs: number } | null = null;
  for (const file of jsons) {
    const s = await stat(join(dir, file));
    if (!newest || s.mtimeMs > newest.mtimeMs) {
      newest = { id: file.slice(0, -".json".length), mtimeMs: s.mtimeMs };
    }
  }
  return newest ? newest.id : null;
}

export function buildWebServer(dir: string = defaultRunsDir()): Server {
  return createServer((req, res) => {
    void handle(req.method ?? "GET", req.url ?? "/", dir)
      .then(({ status, contentType, body, location }) => {
        const headers: Record<string, string> = { "content-type": contentType };
        if (location) headers["location"] = location;
        res.writeHead(status, headers);
        res.end(body);
      })
      .catch((err: unknown) => {
        // Fail-loud (Rule 8): arquivo corrompido / erro inesperado → 500 com motivo curto.
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(`internal error: ${err instanceof Error ? err.message : "unknown"}`);
      });
  });
}

interface Reply {
  status: number;
  contentType: string;
  body: string;
  location?: string;
}

async function handle(method: string, url: string, dir: string): Promise<Reply> {
  if (method !== "GET") {
    return { status: 405, contentType: "text/plain", body: "method not allowed" };
  }

  const path = url.split("?")[0] ?? "/";

  if (path === "/") {
    const id = await latestRunId(dir);
    if (!id) return { status: 200, contentType: "text/plain", body: "no runs yet" };
    return { status: 302, contentType: "text/plain", body: "", location: `/runs/${id}` };
  }

  const match = /^\/runs\/(.+)$/.exec(path);
  if (match) {
    const id = match[1]!;
    if (!RUN_ID_RE.test(id)) {
      return { status: 400, contentType: "text/plain", body: "bad id" };
    }
    try {
      const env = await loadRun(join(dir, `${id}.json`));
      return { status: 200, contentType: "text/html; charset=utf-8", body: renderRun(env) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: 404, contentType: "text/plain", body: "run not found" };
      }
      throw err;
    }
  }

  return { status: 404, contentType: "text/plain", body: "not found" };
}

async function main(): Promise<void> {
  const port = Number(process.env.HODOR_WEB_PORT ?? 4000);
  const server = buildWebServer();
  server.listen(port, () => {
    console.error(`hodor web review app on http://127.0.0.1:${port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error in hodor web server:", error);
    process.exit(1);
  });
}
