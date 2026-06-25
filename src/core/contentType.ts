/**
 * Dispatch de renderização por content-type (M8 ADR-5). Funções PURAS e
 * browser-safe (sem imports Node) — a ÚNICA parte do core que a SPA importa como
 * VALOR (não só `import type`). Fonte única: o SSR (`src/web/render.ts`) e a SPA
 * (`web/src/`) usam exatamente o mesmo dispatch, garantindo paridade real.
 *
 * Espelha o sistema de "lenses" do hoppscotch (getSuitableLenses): JSON → pretty;
 * textual → cru; binário → metadados (nunca embute).
 */

const JSON_CT = /(application\/json|\+json)/i;
const TEXTUAL = /(text\/|application\/(json|xml|javascript|x-www-form-urlencoded)|\+json|\+xml)/i;

/** Limite de body acima do qual truncamos (risco de payload gigante travar a UI). */
export const MAX_BODY = 64 * 1024; // 64 KB

/**
 * "json" → pretty-print; "text" → cru; "binary" → metadados (NÃO embute).
 * Case-insensitive; content-type ausente → "binary" (fallback seguro).
 */
export function pickRenderer(contentType?: string): "json" | "text" | "binary" {
  if (!contentType) return "binary";
  if (JSON_CT.test(contentType)) return "json";
  if (TEXTUAL.test(contentType)) return "text";
  return "binary";
}

/** Trunca texto acima de `max` — não embute body gigante na UI. */
export function truncate(
  s: string,
  max = MAX_BODY,
): { text: string; truncated: boolean; originalLength: number } {
  if (s.length <= max) return { text: s, truncated: false, originalLength: s.length };
  return { text: s.slice(0, max), truncated: true, originalLength: s.length };
}

/**
 * Aplica o dispatch e devolve o texto pronto para exibir + metadados. Para "json"
 * tenta pretty-print; se o body não parsear como JSON apesar do content-type,
 * cai para o texto cru. Para "binary" devolve `kind:"binary"` e o chamador decide
 * a mensagem (o core não conhece HTML nem JSX).
 */
export function renderBody(
  body: string,
  contentType?: string,
): { kind: "json" | "text" | "binary"; text: string; truncated: boolean; originalLength: number } {
  const kind = pickRenderer(contentType);
  if (kind === "binary") return { kind, text: "", truncated: false, originalLength: body.length };
  const { text, truncated, originalLength } = truncate(body);
  if (kind === "json") {
    try {
      return { kind, text: JSON.stringify(JSON.parse(text), null, 2), truncated, originalLength };
    } catch {
      return { kind: "text", text, truncated, originalLength };
    }
  }
  return { kind, text, truncated, originalLength };
}
