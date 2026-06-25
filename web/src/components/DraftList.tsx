import type { Draft } from "../types";

/**
 * Lista read-only de drafts (cenários gerados pelo agente, pendentes de revisão —
 * M4). Caller de produção dos endpoints `/api/drafts` (DoD #1). Sem aprovação aqui
 * — o humano edita no git e aprova via verdict (contrato M2).
 */
export function DraftList({ drafts }: { drafts: Array<{ id: string; draft: Draft }> }) {
  if (drafts.length === 0) return <p className="text-muted-foreground">no drafts yet</p>;
  return (
    <ul className="flex flex-col gap-2">
      {drafts.map(({ id, draft }) => (
        <li key={id} className="border border-border rounded p-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">{draft.name ?? "(sem nome)"}</span>
            <span className="text-xs text-muted-foreground">🤖 {draft.provenance.sourceKind}</span>
            <span className="ml-auto text-xs text-muted-foreground">pendente de revisão</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {draft.steps.length} step(s) · id {id.slice(0, 8)}
          </p>
        </li>
      ))}
    </ul>
  );
}
