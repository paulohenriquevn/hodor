import type { DiffResponse } from "../types";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "./ui/table";

/**
 * Diff vs baseline (paridade com `renderDiff` do SSR — DoD #2). Destaca campos
 * mudados por step; mensagem clara quando não há baseline.
 */
export function DiffView({ data }: { data: DiffResponse }) {
  if (!data.baseline || !data.diff) {
    return (
      <p className="text-muted-foreground">
        Sem baseline {data.mode === "golden" ? "aprovado (golden)" : "anterior"} para comparar.
      </p>
    );
  }
  const { diff } = data;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Badge variant="default">vs {data.mode === "golden" ? "golden" : "anterior"}</Badge>
        {diff.hasRegression ? (
          <Badge variant="danger">⚠ regressão</Badge>
        ) : (
          <Badge variant="success">sem regressão</Badge>
        )}
        {diff.noiseChanged && <Badge variant="warning">regras de noise diferentes</Badge>}
      </div>
      {diff.steps.map((s) => (
        <Card key={s.stepIndex}>
          <CardHeader>
            <CardTitle>
              Step {s.stepIndex + 1}{" "}
              {s.statusChanged && <Badge variant="danger">status mudou</Badge>}{" "}
              {s.bodyChanged && <Badge variant="warning">body mudou</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {s.headerDiffs.length === 0 ? (
              <p className="text-muted-foreground text-xs">sem mudança de headers</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Header</TH>
                    <TH>Antes</TH>
                    <TH>Depois</TH>
                  </TR>
                </THead>
                <TBody>
                  {s.headerDiffs.map((h) => (
                    <TR key={h.key}>
                      <TD className="font-mono text-xs">{h.key}</TD>
                      <TD className="font-mono text-xs">{h.prev ?? "—"}</TD>
                      <TD className="font-mono text-xs">{h.curr ?? "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
