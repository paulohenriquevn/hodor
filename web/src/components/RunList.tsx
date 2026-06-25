import { Link } from "react-router-dom";
import type { ListingItem } from "../types";
import { Table, THead, TBody, TR, TH, TD } from "./ui/table";
import { Badge } from "./ui/badge";

/**
 * Listagem de runs (paridade com `renderListing` do SSR — DoD #2). Mostra os
 * mesmos campos + badges: golden 🏆, regressão ⚠, origem 🤖 (agente).
 */
export function RunList({ items }: { items: ListingItem[] }) {
  if (items.length === 0) return <p className="text-muted-foreground">no runs yet</p>;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Cenário</TH>
          <TH>Run</TH>
          <TH>Quando</TH>
          <TH>Steps</TH>
          <TH>Asserts</TH>
          <TH>Verdict</TH>
        </TR>
      </THead>
      <TBody>
        {items.map((it) => (
          <TR key={it.runId}>
            <TD>
              {it.name ?? <span className="text-muted-foreground">(sem nome)</span>}{" "}
              {it.isGolden && (
                <Badge variant="golden" title="golden (baseline aprovado)">
                  🏆 golden
                </Badge>
              )}{" "}
              {it.regression && (
                <Badge variant="danger" title="regride vs golden">
                  ⚠ regressão
                </Badge>
              )}{" "}
              {it.origin === "agent-generated" && (
                <Badge variant="default" title="gerado pelo agente">
                  🤖 agente
                </Badge>
              )}
            </TD>
            <TD>
              <Link className="underline" to={`/runs/${it.runId}`}>
                {it.runId.slice(0, 8)}
              </Link>
            </TD>
            <TD className="text-muted-foreground">{it.createdAt}</TD>
            <TD>{it.stepCount}</TD>
            <TD>
              {it.allAssertsPass === null ? (
                <span className="text-muted-foreground">—</span>
              ) : it.allAssertsPass ? (
                <Badge variant="success">✓ pass</Badge>
              ) : (
                <Badge variant="danger">✗ fail</Badge>
              )}
            </TD>
            <TD>
              {it.verdict ? (
                <Badge variant={it.verdict === "approved" ? "success" : "danger"}>{it.verdict}</Badge>
              ) : (
                <span className="text-muted-foreground">pendente</span>
              )}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
