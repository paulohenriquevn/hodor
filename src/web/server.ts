import { createServer, type IncomingMessage, type Server } from "node:http";
import { join } from "node:path";
import { ZodError } from "zod";
import {
  loadRun,
  loadVerdict,
  saveVerdict,
  buildReviewArtifact,
  saveReviewArtifact,
  ReviewArtifactSchema,
  defaultRunsDir,
  defaultVerdictsDir,
  defaultReviewsDir,
  findPreviousRun,
  findGoldenRun,
  scenarioKey,
  diffRuns,
  buildListing,
  RUN_ID_RE,
  type RunEnvelope,
  type Verdict,
} from "../core/index.js";
import { renderRun, renderListing, renderDiff } from "./render.js";

/**
 * Adaptador web (ADR D1/D2/D5 do M2): servidor HTTP nativo, server-rendered, SEM
 * framework. Lista runs (`GET /`), exibe um run + form de verdict (`GET /runs/:id`),
 * e grava o verdict humano (`POST /runs/:id/verdict`). Delega ao core (loadRun,
 * load/saveVerdict) — fronteira mantida (web não decide regra de negócio).
 */

// EC-1 (M0): id da URL é input do usuário — allowlist UUID (RUN_ID_RE, do core)
// antes de montar path (anti path-traversal). M8: fonte única compartilhada com a API.
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB — cap do body do POST de verdict.

/** Body excedeu o limite → mapeado para 413 (F-dom-1), não 500. */
class PayloadTooLargeError extends Error {
  override readonly name = "PayloadTooLargeError";
}

const r405 = (allow: string): Reply => ({
  status: 405,
  contentType: "text/plain",
  body: "method not allowed",
  allow,
});
const r400 = (msg: string): Reply => ({ status: 400, contentType: "text/plain", body: msg });

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
  reviewsDir: string = defaultReviewsDir(),
): Server {
  return createServer((req, res) => {
    void route(req, dir, verdictsDir, reviewsDir)
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

async function route(
  req: IncomingMessage,
  dir: string,
  verdictsDir: string,
  reviewsDir: string,
): Promise<Reply> {
  const method = req.method ?? "GET";
  const path = (req.url ?? "/").split("?")[0] ?? "/";

  // Resolve a ROTA primeiro; o método é checado por rota conhecida (F-dom-2: rota
  // inexistente → 404, não 405). O `:id` é validado antes do método (F-dom-3).

  if (path === "/") {
    if (method !== "GET") return r405("GET");
    const items = await buildListing(dir, verdictsDir);
    return { status: 200, contentType: "text/html; charset=utf-8", body: renderListing(items) };
  }

  const verdictMatch = /^\/runs\/([^/]+)\/verdict$/.exec(path);
  if (verdictMatch) {
    const id = verdictMatch[1]!;
    if (!RUN_ID_RE.test(id)) return r400("bad id");
    if (method !== "POST") return r405("POST");
    return postVerdict(id, req, dir, verdictsDir, reviewsDir);
  }

  // M5 — diff de regressão vs run anterior; M6 (ADR D6) — `?vs=golden` compara vs golden aprovado.
  const diffMatch = /^\/runs\/([^/]+)\/diff$/.exec(path);
  if (diffMatch) {
    const id = diffMatch[1]!;
    if (!RUN_ID_RE.test(id)) return r400("bad id"); // EC-4: :id permanece UUID-validado
    if (method !== "GET") return r405("GET");
    const vs = new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("vs");
    try {
      const curr = await loadRun(join(dir, `${id}.json`));
      // baseline = golden aprovado (?vs=golden) OU run anterior (default M5).
      // scenarioKey vem do run carregado, NUNCA da URL (EC-4 — não reabre traversal).
      const baseline =
        vs === "golden" ? await findGoldenRun(scenarioKey(curr), dir, verdictsDir) : await findPreviousRun(curr, dir);
      const diff = baseline ? diffRuns(baseline, curr) : null;
      const body = renderDiff(curr, baseline, diff, vs === "golden" ? "golden" : "previous");
      return { status: 200, contentType: "text/html; charset=utf-8", body };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: 404, contentType: "text/plain", body: "run not found" };
      }
      throw err;
    }
  }

  const runMatch = /^\/runs\/([^/]+)$/.exec(path);
  if (runMatch) {
    const id = runMatch[1]!;
    if (!RUN_ID_RE.test(id)) return r400("bad id");
    if (method !== "GET") return r405("GET");
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
  reviewsDir: string,
): Promise<Reply> {
  if (!RUN_ID_RE.test(id)) return { status: 400, contentType: "text/plain", body: "bad id" };
  // Q2: o run precisa existir antes de registrar o verdict.
  let env: RunEnvelope;
  try {
    env = await loadRun(join(dir, `${id}.json`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: 404, contentType: "text/plain", body: "run not found" };
    }
    throw err;
  }
  let body: string;
  try {
    body = await readBody(req);
  } catch (err) {
    // F-dom-1: body grande é erro do CLIENTE → 413, não 500.
    if (err instanceof PayloadTooLargeError) {
      return { status: 413, contentType: "text/plain", body: "payload too large" };
    }
    throw err;
  }
  const params = new URLSearchParams(body);
  const note = params.get("note") ?? undefined;
  const verdict: Verdict = {
    runId: id,
    // valor cru do form; VerdictSchema valida na fronteira (approved/rejected).
    verdict: params.get("verdict") as Verdict["verdict"],
    ...(note ? { note } : {}),
    decidedAt: new Date().toISOString(),
  };
  // EC-1 (M3): build o artefato versionável EM MEMÓRIA antes de gravar qualquer
  // coisa — um erro de validação (verdict inválido) ou de normalização aborta
  // ANTES de criar verdict órfão.
  let reviewArtifact;
  try {
    reviewArtifact = ReviewArtifactSchema.parse(buildReviewArtifact(env, verdict));
  } catch (err) {
    // F-arch-1 + EC-3 do M2: verdict inválido (cliente) → 400, ANTES de qualquer
    // escrita (EC-1 do M3 — sem verdict órfão); falha inesperada sobe (→ 500).
    if (err instanceof ZodError) return r400("invalid verdict");
    throw err;
  }
  // Persiste: verdict (M2, live) + artefato versionável (M3, commitável).
  await saveVerdict(verdict, verdictsDir);
  await saveReviewArtifact(reviewArtifact, reviewsDir);
  return { status: 303, contentType: "text/plain", body: "", location: `/runs/${id}` };
}

/** Lê o body com cap de tamanho (anti-abuso). Em overflow, drena o restante
 * (sem bufferizar) para que a resposta 413 ainda possa ser escrita. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      if (done) return; // já estourou — descarta o resto
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        req.resume(); // drena o body restante para liberar o socket p/ a resposta
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
    req.on("error", (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    });
  });
}

async function main(): Promise<void> {
  const port = Number(process.env.HODOR_WEB_PORT ?? 4000);
  const server = buildWebServer();
  // F-sec-5: bind explícito em loopback — alinha ao modelo de ameaça local single-user
  // (todos os riscos aceitos — CSRF, leak no 500 — assumem que não há rede).
  server.listen(port, "127.0.0.1", () => {
    console.error(`hodor web review app on http://127.0.0.1:${port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error in hodor web server:", error);
    process.exit(1);
  });
}
