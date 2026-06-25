import type { RunEnvelope, RunStep, Verdict } from "../types";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { ResponseView } from "./ResponseView";
import { statusVariant } from "../lib/status";

function AssertList({ step }: { step: RunStep }) {
  const asserts = step.asserts ?? [];
  if (asserts.length === 0) return null;
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold mb-1">Asserts</h4>
      <ul className="flex flex-col gap-1">
        {asserts.map((a, i) => (
          <li key={i} className="text-xs flex items-center gap-2">
            <Badge variant={a.pass ? "success" : "danger"}>{a.pass ? "✓" : "✗"}</Badge>
            <span className="font-mono">
              {a.source} {a.op} {JSON.stringify(a.expected)}
            </span>
            {!a.pass && <span className="text-muted-foreground">(atual: {JSON.stringify(a.actual)})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepCard({ step, index }: { step: RunStep; index: number }) {
  const res = step.response;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Step {index + 1}</CardTitle>
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="default">{step.request.method}</Badge>
          <span className="font-mono text-muted-foreground break-all">{step.request.url}</span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <section>
          <h3 className="text-sm font-semibold mb-2">Request</h3>
          <ResponseView body={step.request.body ?? ""} headers={step.request.headers} idPrefix={`req-${index}`} />
        </section>
        <section>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-semibold">Response</h3>
            <Badge variant={statusVariant(res.status)} aria-label={`status ${res.status}`}>
              {res.status} {res.statusText}
            </Badge>
          </div>
          <ResponseView body={res.body} headers={res.headers} idPrefix={`res-${index}`} />
        </section>
        <AssertList step={step} />
      </CardContent>
    </Card>
  );
}

/** Detalhe de um run (paridade com `renderRun` do SSR — DoD #2). */
export function RunDetail({ run, verdict }: { run: RunEnvelope; verdict: Verdict | null }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold">{run.name ?? "(sem nome)"}</h2>
        {verdict ? (
          <Badge variant={verdict.verdict === "approved" ? "success" : "danger"}>{verdict.verdict}</Badge>
        ) : (
          <Badge variant="warning">pendente</Badge>
        )}
      </div>
      {run.steps.map((step, i) => (
        <StepCard key={i} step={step} index={i} />
      ))}
    </div>
  );
}
