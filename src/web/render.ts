import type {
  RunEnvelope,
  RunStep,
  CapturedRequest,
  CapturedResponse,
  AssertResult,
} from "../core/index.js";

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

export function renderRun(env: RunEnvelope): string {
  const steps = env.steps.map((s, i) => stepSection(s, i)).join("\n");
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
  </style>
</head>
<body>
  <h1>Hodor run <code>${escapeHtml(env.runId)}</code></h1>
  <p class="meta">schemaVersion ${env.schemaVersion} · ${escapeHtml(env.createdAt)} · ${env.steps.length} step(s)</p>
  ${steps}
</body>
</html>`;
}
