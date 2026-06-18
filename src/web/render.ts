import type {
  RunEnvelope,
  RunStep,
  CapturedRequest,
  CapturedResponse,
  AssertResult,
  Verdict,
} from "../core/index.js";

/** Item da listagem de runs (GET /). */
export interface ListingItem {
  runId: string;
  name?: string;
  createdAt: string;
  stepCount: number;
  allAssertsPass: boolean | null;
  verdict: Verdict["verdict"] | null;
}

/**
 * Render puro (ADR D2): RunEnvelope → HTML. Sem I/O. Itera `steps` (suporta N — D3).
 * Todo conteúdo dinâmico é escapado (anti-XSS). Corpos não-texto são omitidos
 * explicitamente (tratamento binário completo é escopo M2).
 */

const JSON_CT = /(application\/json|\+json)/i;
const TEXTUAL = /(text\/|application\/(json|xml|javascript|x-www-form-urlencoded)|\+json|\+xml)/i;
const MAX_BODY = 64 * 1024; // 64 KB — acima disso, trunca (risco #2)

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Dispatch por content-type (ADR D2, espelha `getSuitableLenses` do hoppscotch):
 * "json" → pretty; "text" → <pre> escapado; "binary" → metadados (NÃO embute).
 * Case-insensitive; content-type ausente → "binary" (fallback seguro).
 */
export function pickRenderer(contentType?: string): "json" | "text" | "binary" {
  if (!contentType) return "binary";
  if (JSON_CT.test(contentType)) return "json";
  if (TEXTUAL.test(contentType)) return "text";
  return "binary";
}

/** Trunca texto acima de `max` (risco #2) — não embute body gigante no HTML. */
export function truncate(s: string, max = MAX_BODY): { text: string; truncated: boolean; originalLength: number } {
  if (s.length <= max) return { text: s, truncated: false, originalLength: s.length };
  return { text: s.slice(0, max), truncated: true, originalLength: s.length };
}

function headersTable(headers: Record<string, string>): string {
  const rows = Object.entries(headers)
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
    .join("");
  if (!rows) return "<p class='muted'>(no headers)</p>";
  return `<table class='headers'><thead><tr><th>Header</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function bodyBlock(body: string, contentType: string | undefined): string {
  if (body.length === 0) return "<p class='muted'>(empty body)</p>";
  const kind = pickRenderer(contentType);
  if (kind === "binary") {
    return `<p class='muted'>(binary omitted — content-type: ${escapeHtml(contentType ?? "unknown")})</p>`;
  }
  const { text, truncated, originalLength } = truncate(body);
  let rendered = text;
  if (kind === "json") {
    try {
      rendered = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      rendered = text; // body não-parseável como JSON apesar do content-type → cru (escapado)
    }
  }
  const notice = truncated
    ? `<p class='muted'>(truncado — exibindo ${MAX_BODY} de ${originalLength} bytes)</p>`
    : "";
  return `<pre class='body'>${escapeHtml(rendered)}</pre>${notice}`;
}

function requestSection(req: CapturedRequest): string {
  return `
    <h3>Request</h3>
    <p class='line'><span class='method'>${escapeHtml(req.method)}</span> <span class='url'>${escapeHtml(req.url)}</span></p>
    ${headersTable(req.headers)}
    ${bodyBlock(req.body ?? "", req.headers["content-type"])}`;
}

function responseSection(res: CapturedResponse): string {
  return `
    <h3>Response</h3>
    <p class='line'><span class='status status-${Math.floor(res.status / 100)}xx'>${res.status} ${escapeHtml(res.statusText)}</span>
      <span class='muted'>${res.timings.durationMs.toFixed(1)} ms</span></p>
    ${headersTable(res.headers)}
    ${bodyBlock(res.body, res.headers["content-type"])}`;
}

function assertsTable(asserts: AssertResult[]): string {
  if (asserts.length === 0) return "";
  const rows = asserts
    .map(
      (a) =>
        `<tr class='${a.pass ? "pass" : "fail"}'>
        <td>${a.pass ? "✓ PASS" : "✗ FAIL"}</td>
        <td>${escapeHtml(a.source)}</td>
        <td>${escapeHtml(a.op)}</td>
        <td>${escapeHtml(String(a.expected ?? ""))}</td>
        <td>${escapeHtml(String(a.actual ?? ""))}</td>
      </tr>`,
    )
    .join("");
  return `
    <h3>Asserts</h3>
    <table class='asserts'><thead><tr><th>Result</th><th>Source</th><th>Op</th><th>Expected</th><th>Actual</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function capturesList(captures: Record<string, unknown>): string {
  const entries = Object.entries(captures);
  if (entries.length === 0) return "";
  const items = entries
    .map(([k, v]) => `<li><code>${escapeHtml(k)}</code> = ${escapeHtml(String(v))}</li>`)
    .join("");
  return `
    <h3>Captures</h3>
    <ul class='captures'>${items}</ul>`;
}

function stepSection(step: RunStep, index: number): string {
  return `<section class='step'>
    <h2>Step ${index + 1}</h2>
    ${requestSection(step.request)}
    ${responseSection(step.response)}
    ${step.asserts && step.asserts.length > 0 ? assertsTable(step.asserts) : ""}
    ${step.captures && Object.keys(step.captures).length > 0 ? capturesList(step.captures) : ""}
  </section>`;
}

/** Selo do verdict atual (EC-1: escapa `note`, input do humano). */
function verdictBadge(verdict: Verdict | null): string {
  if (!verdict) return `<p class='verdict pending'>Verdict: <strong>pendente</strong></p>`;
  const cls = verdict.verdict === "approved" ? "approved" : "rejected";
  const note = verdict.note ? ` — <span class='note'>${escapeHtml(verdict.note)}</span>` : "";
  return `<p class='verdict ${cls}'>Verdict: <strong>${escapeHtml(verdict.verdict)}</strong>${note} <span class='muted'>(${escapeHtml(verdict.decidedAt)})</span></p>`;
}

/** Form de verdict (POST). Radio approved/rejected + nota opcional. */
function verdictForm(runId: string): string {
  return `<form class='verdict-form' method='post' action='/runs/${escapeHtml(runId)}/verdict'>
    <label><input type='radio' name='verdict' value='approved' required /> Aprovar</label>
    <label><input type='radio' name='verdict' value='rejected' /> Rejeitar</label>
    <textarea name='note' rows='2' placeholder='nota (opcional)'></textarea>
    <button type='submit'>Registrar verdict</button>
  </form>`;
}

export function renderRun(env: RunEnvelope, verdict: Verdict | null = null): string {
  const steps = env.steps.map((s, i) => stepSection(s, i)).join("\n");
  const title = env.name ? escapeHtml(env.name) : escapeHtml(env.runId);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Hodor run ${escapeHtml(env.runId)}</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem; color: #1a1a1a; }
    h1 { font-size: 1.1rem; }
    .meta { color: #666; font-size: .85rem; }
    section.step { border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.25rem; margin: 1rem 0; }
    .line { font-size: .95rem; }
    .method { font-weight: 700; }
    .url { color: #0b66c3; word-break: break-all; }
    .status-2xx { color: #137333; font-weight: 700; }
    .status-3xx { color: #8a6d00; font-weight: 700; }
    .status-4xx, .status-5xx { color: #b00020; font-weight: 700; }
    table.headers { border-collapse: collapse; font-size: .8rem; margin: .5rem 0; }
    table.headers td, table.headers th { border: 1px solid #e0e0e0; padding: 2px 8px; text-align: left; }
    pre.body { background: #f6f8fa; padding: .75rem; border-radius: 6px; overflow-x: auto; font-size: .8rem; }
    .muted { color: #888; font-size: .8rem; }
    table.asserts { border-collapse: collapse; font-size: .8rem; margin: .5rem 0; }
    table.asserts td, table.asserts th { border: 1px solid #e0e0e0; padding: 2px 8px; text-align: left; }
    table.asserts tr.pass td:first-child { color: #137333; font-weight: 700; }
    table.asserts tr.fail td:first-child { color: #b00020; font-weight: 700; }
    table.asserts tr.fail { background: #fdecef; }
    ul.captures { font-size: .8rem; margin: .25rem 0; }
    .verdict { font-size: .9rem; padding: .5rem .75rem; border-radius: 6px; }
    .verdict.approved { background: #e6f4ea; color: #137333; }
    .verdict.rejected { background: #fdecef; color: #b00020; }
    .verdict.pending { background: #f6f8fa; color: #666; }
    .verdict-form { margin: 1rem 0; display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
    .verdict-form textarea { font-family: inherit; flex: 1; min-width: 200px; }
    a { color: #0b66c3; }
    table.listing { border-collapse: collapse; width: 100%; font-size: .85rem; }
    table.listing td, table.listing th { border: 1px solid #e0e0e0; padding: 4px 10px; text-align: left; }
    .pf-pass { color: #137333; font-weight: 700; } .pf-fail { color: #b00020; font-weight: 700; }
  </style>
</head>
<body>
  <p class="meta"><a href="/">← todos os runs</a></p>
  <h1>Hodor run <code>${escapeHtml(env.runId)}</code>${env.name ? ` — ${title}` : ""}</h1>
  <p class="meta">schemaVersion ${env.schemaVersion} · ${escapeHtml(env.createdAt)} · ${env.steps.length} step(s)</p>
  ${verdictBadge(verdict)}
  ${verdictForm(env.runId)}
  ${steps}
</body>
</html>`;
}

const LISTING_STYLE = `body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem; color: #1a1a1a; }
    h1 { font-size: 1.1rem; } a { color: #0b66c3; }
    table.listing { border-collapse: collapse; width: 100%; font-size: .85rem; }
    table.listing td, table.listing th { border: 1px solid #e0e0e0; padding: 4px 10px; text-align: left; }
    .pf-pass { color: #137333; font-weight: 700; } .pf-fail { color: #b00020; font-weight: 700; }
    .v-approved { color: #137333; } .v-rejected { color: #b00020; } .v-pending { color: #888; }
    .muted { color: #888; }`;

/** Página de listagem (GET /) — runs mais recentes primeiro. */
export function renderListing(items: ListingItem[]): string {
  const rows = items
    .map((it) => {
      const pf =
        it.allAssertsPass === null
          ? `<span class='muted'>—</span>`
          : it.allAssertsPass
            ? `<span class='pf-pass'>✓ pass</span>`
            : `<span class='pf-fail'>✗ fail</span>`;
      const v = it.verdict
        ? `<span class='v-${it.verdict}'>${escapeHtml(it.verdict)}</span>`
        : `<span class='v-pending'>pendente</span>`;
      return `<tr>
        <td><a href='/runs/${escapeHtml(it.runId)}'>${it.name ? escapeHtml(it.name) : "(sem cenário)"}</a></td>
        <td><code>${escapeHtml(it.runId)}</code></td>
        <td>${escapeHtml(it.createdAt)}</td>
        <td>${it.stepCount}</td>
        <td>${pf}</td>
        <td>${v}</td>
      </tr>`;
    })
    .join("");
  const table =
    items.length === 0
      ? `<p class='muted'>no runs yet</p>`
      : `<table class='listing'><thead><tr><th>Cenário</th><th>Run</th><th>Quando</th><th>Steps</th><th>Asserts</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Hodor — runs</title>
  <style>${LISTING_STYLE}</style>
</head>
<body>
  <h1>Hodor — execuções para revisão</h1>
  ${table}
</body>
</html>`;
}
