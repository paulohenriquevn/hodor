import { createServer, type IncomingMessage, type Server } from "node:http";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  loadRun,
  loadVerdict,
  saveVerdict,
  defaultRunsDir,
  defaultVerdictsDir,
  type RunEnvelope,
  type Verdict,
} from "../core/index.js";
import { renderRun, renderListing, type ListingItem } from "./render.js";

/**
 * Adaptador web (ADR D1/D2/D5 do M2): servidor HTTP nativo, server-rendered, SEM
 * framework. Lista runs (`GET /`), exibe um run + form de verdict (`GET /runs/:id`),
 * e grava o verdict humano (`POST /runs/:id/verdict`). Delega ao core (loadRun,
 * load/saveVerdict) — fronteira mantida (web não decide regra de negócio).
 */

// EC-1 (M0): id da URL é input do usuário — allowlist UUID antes de montar path (anti path-traversal).
const RUN_ID_RE = /^[0-9a-f-]{36}$/i;
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB — cap do body do POST de verdict.

interface Reply {
  status: number;
  contentType: string;
  body: string;
  location?: string;
  allow?: string;
}

export function buildWebServer(
  dir: string = defaultRunsDir(),
  verdictsDir: string = defaultVerdictsDir(),
): Server {
  return createServer((req, res) => {
    void route(req, dir, verdictsDir)
      .then(({ status, contentType, body, location, allow }) => {
        const headers: Record<string, string> = { "content-type": contentType };
        if (location) headers["location"] = location;
        if (allow) headers["allow"] = allow; // RFC 9110 §15.5.6 (405 MUST)
        res.writeHead(status, headers);
        res.end(body);
      })
      .catch((err: unknown) => {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(`internal error: ${err instanceof Error ? err.message : "unknown"}`);
      });
  });
}

async function route(req: IncomingMessage, dir: string, verdictsDir: string): Promise<Reply> {
  const method = req.method ?? "GET";
  const path = (req.url ?? "/").split("?")[0] ?? "/";

  // POST /runs/:id/verdict — registro do verdict humano.
  const verdictMatch = /^\/runs\/([^/]+)\/verdict$/.exec(path);
  if (verdictMatch) {
    if (method !== "POST") {
      return { status: 405, contentType: "text/plain", body: "method not allowed", allow: "POST" };
    }
    return postVerdict(verdictMatch[1]!, req, dir, verdictsDir);
  }

  if (method !== "GET") {
    return { status: 405, contentType: "text/plain", body: "method not allowed", allow: "GET" };
  }

  if (path === "/") {
    const items = await listRuns(dir, verdictsDir);
    return { status: 200, contentType: "text/html; charset=utf-8", body: renderListing(items) };
  }

  const runMatch = /^\/runs\/(.+)$/.exec(path);
  if (runMatch) {
    const id = runMatch[1]!;
    if (!RUN_ID_RE.test(id)) return { status: 400, contentType: "text/plain", body: "bad id" };
    try {
      const env = await loadRun(join(dir, `${id}.json`));
      const verdict = await loadVerdict(id, verdictsDir);
      return { status: 200, contentType: "text/html; charset=utf-8", body: renderRun(env, verdict) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: 404, contentType: "text/plain", body: "run not found" };
      }
      throw err;
    }
  }

  return { status: 404, contentType: "text/plain", body: "not found" };
}

async function postVerdict(
  id: string,
  req: IncomingMessage,
  dir: string,
  verdictsDir: string,
): Promise<Reply> {
  if (!RUN_ID_RE.test(id)) return { status: 400, contentType: "text/plain", body: "bad id" };
  // Q2: o run precisa existir antes de registrar o verdict.
  try {
    await loadRun(join(dir, `${id}.json`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: 404, contentType: "text/plain", body: "run not found" };
    }
    throw err;
  }
  const body = await readBody(req);
  const params = new URLSearchParams(body);
  const note = params.get("note") ?? undefined;
  const verdict: Verdict = {
    runId: id,
    // valor cru do form; VerdictSchema valida na fronteira (approved/rejected).
    verdict: params.get("verdict") as Verdict["verdict"],
    ...(note ? { note } : {}),
    decidedAt: new Date().toISOString(),
  };
  try {
    await saveVerdict(verdict, verdictsDir);
  } catch {
    // EC-3: verdict inválido/ausente → 400 (não grava).
    return { status: 400, contentType: "text/plain", body: "invalid verdict" };
  }
  return { status: 303, contentType: "text/plain", body: "", location: `/runs/${id}` };
}

/** Lê o body com cap de tamanho (anti-abuso). */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Lista os runs (mais recente primeiro). EC-2: um run corrompido é PULADO (não
 * derruba a listagem inteira) — o fail-loud fica na página do run individual.
 */
async function listRuns(dir: string, verdictsDir: string): Promise<ListingItem[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const files = entries.filter(
    (e) => e.endsWith(".json") && RUN_ID_RE.test(e.slice(0, -".json".length)),
  );
  const items: Array<ListingItem & { mtimeMs: number }> = [];
  for (const file of files) {
    const id = file.slice(0, -".json".length);
    let env: RunEnvelope;
    try {
      env = await loadRun(join(dir, file));
    } catch {
      continue; // EC-2: pula arquivo corrompido
    }
    const s = await stat(join(dir, file));
    const verdict = await loadVerdict(id, verdictsDir);
    items.push({
      runId: id,
      name: env.name,
      createdAt: env.createdAt,
      stepCount: env.steps.length,
      allAssertsPass: passFail(env),
      verdict: verdict?.verdict ?? null,
      mtimeMs: s.mtimeMs,
    });
  }
  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items.map(({ mtimeMs: _omit, ...item }) => item);
}

/** ✓ se todos os asserts de todos os steps passaram; null se não há asserts (run M0). */
function passFail(env: RunEnvelope): boolean | null {
  const asserts = env.steps.flatMap((s) => s.asserts ?? []);
  if (asserts.length === 0) return null;
  return asserts.every((a) => a.pass);
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
