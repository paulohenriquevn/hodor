import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { ZodError } from "zod";
import {
  loadRun,
  loadVerdict,
  saveVerdict,
  buildReviewArtifact,
  saveReviewArtifact,
  loadReviewArtifact,
  ReviewArtifactSchema,
  listDrafts,
  loadDraft,
  buildListing,
  findPreviousRun,
  findGoldenRun,
  scenarioKey,
  diffRuns,
  defaultRunsDir,
  defaultVerdictsDir,
  defaultReviewsDir,
  defaultDraftsDir,
  RUN_ID_RE,
  type RunEnvelope,
  type Verdict,
} from "../core/index.js";

/**
 * Adaptador REST (M8 ADR-1): servidor HTTP nativo que expõe o core via JSON sob
 * `/api/*`, espelhando `src/web` (SSR) e `src/mcp`. ZERO regra de negócio — delega
 * 100% ao core. A SPA React (web/) consome estes endpoints. Em produção, quando
 * `web/dist` existe, o mesmo servidor serve os estáticos da SPA + fallback de rota
 * client-side (ADR-3). Reusa a validação de fronteira do SSR (RUN_ID_RE, cap de
 * body → 413, 405 + Allow, 404) — mesmo modelo de ameaça local single-user.
 */

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
// Drafts usam ids mais largos que UUID (randomUUID OU id explícito path-safe).
const DRAFT_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

const STATIC_CT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

class PayloadTooLargeError extends Error {
  override readonly name = "PayloadTooLargeError";
}

interface Reply {
  status: number;
  contentType: string;
  body: string | Buffer;
  allow?: string;
}

const json = (status: number, data: unknown): Reply => ({
  status,
  contentType: "application/json; charset=utf-8",
  body: JSON.stringify(data),
});
const err = (status: number, message: string, allow?: string): Reply => ({
  status,
  contentType: "application/json; charset=utf-8",
  body: JSON.stringify({ error: message }),
  ...(allow ? { allow } : {}),
});

export function buildApiServer(
  runsDir: string = defaultRunsDir(),
  verdictsDir: string = defaultVerdictsDir(),
  reviewsDir: string = defaultReviewsDir(),
  draftsDir: string = defaultDraftsDir(),
  distDir?: string,
): Server {
  return createServer((req, res) => {
    void route(req, { runsDir, verdictsDir, reviewsDir, draftsDir, distDir })
      .then((reply) => send(req, res, reply))
      .catch((e: unknown) => {
        send(req, res, err(500, e instanceof Error ? e.message : "internal error"));
      });
  });
}

interface Dirs {
  runsDir: string;
  verdictsDir: string;
  reviewsDir: string;
  draftsDir: string;
  distDir?: string;
}

function send(req: IncomingMessage, res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "content-type": reply.contentType };
  if (reply.allow) headers["allow"] = reply.allow;
  res.writeHead(reply.status, headers);
  res.end(reply.body);
  // Wiring metric (M8 T1.3): uma linha estruturada por request (sem corpo/segredo).
  console.error(
    JSON.stringify({
      event: "api_request",
      method: req.method ?? "GET",
      path: (req.url ?? "/").split("?")[0],
      status: reply.status,
    }),
  );
}

async function route(req: IncomingMessage, dirs: Dirs): Promise<Reply> {
  const method = req.method ?? "GET";
  const path = (req.url ?? "/").split("?")[0] ?? "/";

  if (path.startsWith("/api/")) return apiRoute(method, path, req, dirs);

  // Não-/api: serve a SPA (estáticos + fallback). Só quando há build (prod).
  if (dirs.distDir) return serveStatic(method, path, dirs.distDir);
  return err(404, "not found");
}

async function apiRoute(method: string, path: string, req: IncomingMessage, dirs: Dirs): Promise<Reply> {
  const { runsDir, verdictsDir, reviewsDir, draftsDir } = dirs;

  if (path === "/api/runs") {
    if (method !== "GET") return err(405, "method not allowed", "GET");
    return json(200, await buildListing(runsDir, verdictsDir));
  }

  if (path === "/api/drafts") {
    if (method !== "GET") return err(405, "method not allowed", "GET");
    return json(200, await listDrafts(draftsDir));
  }

  const draftMatch = /^\/api\/drafts\/([^/]+)$/.exec(path);
  if (draftMatch) {
    const id = draftMatch[1]!;
    if (!DRAFT_ID_RE.test(id) || id === "." || id === "..") return err(400, "bad id");
    if (method !== "GET") return err(405, "method not allowed", "GET");
    const draft = await loadDraft(id, draftsDir);
    return draft ? json(200, draft) : err(404, "draft not found");
  }

  const reviewMatch = /^\/api\/reviews\/([^/]+)$/.exec(path);
  if (reviewMatch) {
    const id = reviewMatch[1]!;
    if (!RUN_ID_RE.test(id)) return err(400, "bad id");
    if (method !== "GET") return err(405, "method not allowed", "GET");
    const artifact = await loadReviewArtifact(id, reviewsDir);
    return artifact ? json(200, artifact) : err(404, "review not found");
  }

  const verdictMatch = /^\/api\/runs\/([^/]+)\/verdict$/.exec(path);
  if (verdictMatch) {
    const id = verdictMatch[1]!;
    if (!RUN_ID_RE.test(id)) return err(400, "bad id");
    if (method !== "POST") return err(405, "method not allowed", "POST");
    return postVerdict(id, req, runsDir, verdictsDir, reviewsDir);
  }

  const diffMatch = /^\/api\/runs\/([^/]+)\/diff$/.exec(path);
  if (diffMatch) {
    const id = diffMatch[1]!;
    if (!RUN_ID_RE.test(id)) return err(400, "bad id");
    if (method !== "GET") return err(405, "method not allowed", "GET");
    const vs = new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("vs");
    try {
      const curr = await loadRun(join(runsDir, `${id}.json`));
      const baseline =
        vs === "golden"
          ? await findGoldenRun(scenarioKey(curr), runsDir, verdictsDir)
          : await findPreviousRun(curr, runsDir);
      const diff = baseline ? diffRuns(baseline, curr) : null;
      return json(200, { mode: vs === "golden" ? "golden" : "previous", curr, baseline, diff });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return err(404, "run not found");
      throw e;
    }
  }

  const runMatch = /^\/api\/runs\/([^/]+)$/.exec(path);
  if (runMatch) {
    const id = runMatch[1]!;
    if (!RUN_ID_RE.test(id)) return err(400, "bad id");
    if (method !== "GET") return err(405, "method not allowed", "GET");
    try {
      const run = await loadRun(join(runsDir, `${id}.json`));
      const verdict = await loadVerdict(id, verdictsDir);
      return json(200, { run, verdict });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return err(404, "run not found");
      throw e;
    }
  }

  return err(404, "not found");
}

async function postVerdict(
  id: string,
  req: IncomingMessage,
  runsDir: string,
  verdictsDir: string,
  reviewsDir: string,
): Promise<Reply> {
  let env: RunEnvelope;
  try {
    env = await loadRun(join(runsDir, `${id}.json`));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return err(404, "run not found");
    throw e;
  }
  let raw: string;
  try {
    raw = await readBody(req);
  } catch (e) {
    if (e instanceof PayloadTooLargeError) return err(413, "payload too large");
    throw e;
  }
  let parsed: { verdict?: unknown; note?: unknown };
  try {
    parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
  } catch {
    return err(400, "invalid json body");
  }
  const verdict: Verdict = {
    runId: id,
    verdict: parsed.verdict as Verdict["verdict"],
    ...(typeof parsed.note === "string" ? { note: parsed.note } : {}),
    decidedAt: new Date().toISOString(),
  };
  // EC-1 (M3): build o artefato EM MEMÓRIA antes de gravar — verdict inválido
  // aborta ANTES de criar verdict órfão.
  let artifact;
  try {
    artifact = ReviewArtifactSchema.parse(buildReviewArtifact(env, verdict));
  } catch (e) {
    if (e instanceof ZodError) return err(400, "invalid verdict");
    throw e;
  }
  await saveVerdict(verdict, verdictsDir);
  await saveReviewArtifact(artifact, reviewsDir);
  return json(201, artifact);
}

/**
 * Serve um asset estático de `distDir` OU faz fallback para `index.html` (SPA
 * client-side routing). Path-traversal: resolve o caminho e exige que permaneça
 * sob `distDir` (EC anti `../`).
 */
async function serveStatic(method: string, path: string, distDir: string): Promise<Reply> {
  if (method !== "GET") return err(405, "method not allowed", "GET");
  const root = resolve(distDir);
  const candidate = resolve(join(root, path === "/" ? "index.html" : path.slice(1)));
  // Confina sob a raiz (anti path-traversal).
  if (candidate !== root && !candidate.startsWith(root + sep)) return err(404, "not found");
  const file = await tryReadFile(candidate);
  if (file) return staticReply(candidate, file);
  // Fallback SPA: rota desconhecida sem extensão → index.html.
  if (!extname(path)) {
    const index = await tryReadFile(join(root, "index.html"));
    if (index) return staticReply(join(root, "index.html"), index);
  }
  return err(404, "not found");
}

async function tryReadFile(p: string): Promise<Buffer | null> {
  try {
    if ((await stat(p)).isDirectory()) return null;
    return await readFile(p);
  } catch {
    return null;
  }
}

function staticReply(p: string, body: Buffer): Reply {
  return { status: 200, contentType: STATIC_CT[extname(p)] ?? "application/octet-stream", body };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        req.resume();
        reject(new PayloadTooLargeError("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    req.on("error", (e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    });
  });
}

async function main(): Promise<void> {
  const port = Number(process.env.HODOR_API_PORT ?? 4100);
  // Em prod, sirva a SPA buildada se existir.
  const distDir = process.env.HODOR_WEB_DIST ?? join(process.cwd(), "web", "dist");
  const hasDist = await tryReadFile(join(distDir, "index.html"));
  const server = buildApiServer(undefined, undefined, undefined, undefined, hasDist ? distDir : undefined);
  // Bind loopback — modelo de ameaça local single-user (alinha ao SSR M2).
  server.listen(port, "127.0.0.1", () => {
    console.error(`hodor api on http://127.0.0.1:${port}${hasDist ? ` (serving SPA from ${distDir})` : ""}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error in hodor api server:", error);
    process.exit(1);
  });
}
