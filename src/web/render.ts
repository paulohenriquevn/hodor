import type {
  RunEnvelope,
  RunStep,
  CapturedRequest,
  CapturedResponse,
  AssertResult,
  Verdict,
  RunDiff,
} from "../core/index.js";

/** Item da listagem de runs (GET /). */
export interface ListingItem {
  runId: string;
  name?: string;
  createdAt: string;
  stepCount: number;
  allAssertsPass: boolean | null;
  verdict: Verdict["verdict"] | null;
  // M4: origem do cenário (badge "gerado pelo agente"). Ausente em runs M0-M3.
  origin?: "agent-generated" | "human-authored";
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
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;"); // F-sec-1: escapa também aspas simples (atributos single-quoted)
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

/**
 * Selo de proveniência (M4, DoD #2). Só aparece para cenários GERADOS pelo agente.
 * "· pendente de revisão" enquanto não há verdict (estado derivado — ADR D3).
 * Escapa `sourceRef` (input não-confiável — herda o anti-XSS do M2).
 */
function provenanceBadge(env: RunEnvelope, verdict: Verdict | null): string {
  const prov = env.provenance;
  if (!prov || prov.origin !== "agent-generated") return "";
  const pending = verdict ? "" : " · <strong>pendente de revisão</strong>";
  const src = prov.sourceRef ? ` <span class='muted'>(${escapeHtml(prov.sourceKind)}: ${escapeHtml(prov.sourceRef)})</span>` : ` <span class='muted'>(${escapeHtml(prov.sourceKind)})</span>`;
  return `<p class='provenance agent'>🤖 gerado pelo agente${pending}${src}</p>`;
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
    .provenance.agent { font-size: .85rem; background: #eef3fb; color: #0b66c3; padding: .4rem .75rem; border-radius: 6px; }
    .verdict-form { margin: 1rem 0; display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
    .verdict-form textarea { font-family: inherit; flex: 1; min-width: 200px; }
    a { color: #0b66c3; }
  </style>
</head>
<body>
  <p class="meta"><a href="/">← todos os runs</a> · <a href="/runs/${escapeHtml(env.runId)}/diff">ver diff vs anterior</a></p>
  <h1>Hodor run <code>${escapeHtml(env.runId)}</code>${env.name ? ` — ${title}` : ""}</h1>
  <p class="meta">schemaVersion ${env.schemaVersion} · ${escapeHtml(env.createdAt)} · ${env.steps.length} step(s)</p>
  ${provenanceBadge(env, verdict)}
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
    .agent-tag { font-size: .75rem; background: #eef3fb; color: #0b66c3; padding: 1px 6px; border-radius: 4px; }
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
      // M4: badge "gerado pelo agente · pendente" na listagem (DoD #2).
      const agent =
        it.origin === "agent-generated"
          ? ` <span class='agent-tag'>🤖 gerado${it.verdict ? "" : " · pendente"}</span>`
          : "";
      return `<tr>
        <td><a href='/runs/${escapeHtml(it.runId)}'>${it.name ? escapeHtml(it.name) : "(sem cenário)"}</a>${agent}</td>
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

/**
 * Render do diff de regressão (M5, ADR D6): destaca status/headers/body mudados
 * entre o run atual e o anterior do mesmo cenário, APÓS normalização (voláteis +
 * noise já suprimidos pelo core). Sem run anterior → mensagem "primeiro run".
 * Todo conteúdo dinâmico escapado (anti-XSS, herdado do M2).
 */
export function renderDiff(curr: RunEnvelope, prev: RunEnvelope | null, diff: RunDiff | null): string {
  const title = curr.name ? escapeHtml(curr.name) : escapeHtml(curr.runId);
  let bodyHtml: string;
  if (!prev || !diff) {
    bodyHtml = `<p class='muted'>Primeiro run deste cenário — não há execução anterior para comparar.</p>`;
  } else {
    const banner = diff.hasRegression
      ? `<p class='diff-changed'>⚠ Mudança de comportamento detectada vs run anterior.</p>`
      : `<p class='diff-same'>✓ Sem mudança de comportamento (após normalização de voláteis + noise).</p>`;
    const countNote = diff.stepCountChanged
      ? `<p class='diff-changed'>Número de steps mudou: ${prev.steps.length} → ${curr.steps.length}.</p>`
      : "";
    const rows = diff.steps
      .map((s) => {
        const headerCell =
          s.headerDiffs.length === 0
            ? `<span class='muted'>—</span>`
            : s.headerDiffs
                .map((h) => `<code>${escapeHtml(h.key)}</code>: ${escapeHtml(h.prev ?? "(ausente)")} → ${escapeHtml(h.curr ?? "(ausente)")}`)
                .join("<br/>");
        const cell = (changed: boolean, label: string) =>
          changed ? `<td class='diff-changed'>${label}</td>` : `<td class='diff-same'>—</td>`;
        return `<tr>
          <td>${s.stepIndex + 1}</td>
          ${cell(s.statusChanged, "status mudou")}
          <td>${headerCell}</td>
          ${cell(s.bodyChanged, "body mudou")}
        </tr>`;
      })
      .join("");
    bodyHtml = `${banner}${countNote}
    <p class='meta'>atual <code>${escapeHtml(curr.runId)}</code> vs anterior <code>${escapeHtml(prev.runId)}</code></p>
    <table class='diff'><thead><tr><th>Step</th><th>Status</th><th>Headers (não-voláteis)</th><th>Body</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Hodor — diff ${escapeHtml(curr.runId)}</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem; color: #1a1a1a; }
    h1 { font-size: 1.1rem; } a { color: #0b66c3; } code { word-break: break-all; }
    .meta { color: #666; font-size: .85rem; }
    table.diff { border-collapse: collapse; width: 100%; font-size: .85rem; margin-top: 1rem; }
    table.diff td, table.diff th { border: 1px solid #e0e0e0; padding: 4px 10px; text-align: left; vertical-align: top; }
    .diff-changed { color: #b00020; font-weight: 700; }
    .diff-same { color: #137333; }
    .muted { color: #888; }
  </style>
</head>
<body>
  <p class="meta"><a href="/">← todos os runs</a> · <a href="/runs/${escapeHtml(curr.runId)}">ver run</a></p>
  <h1>Diff de regressão — ${curr.name ? title : `run <code>${escapeHtml(curr.runId)}</code>`}</h1>
  ${bodyHtml}
</body>
</html>`;
}
