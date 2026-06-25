import { renderBody } from "../../../src/core/contentType.js";
import { Table, THead, TBody, TR, TH, TD } from "./ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return <p className="text-muted-foreground">(no headers)</p>;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Header</TH>
          <TH>Value</TH>
        </TR>
      </THead>
      <TBody>
        {entries.map(([k, v]) => (
          <TR key={k}>
            <TD className="font-mono text-xs">{k}</TD>
            <TD className="font-mono text-xs break-all">{v}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function BodyView({ body, contentType }: { body: string; contentType?: string }) {
  if (body.length === 0) return <p className="text-muted-foreground">(empty body)</p>;
  const r = renderBody(body, contentType);
  if (r.kind === "binary")
    return <p className="text-muted-foreground">(binary omitido — content-type: {contentType ?? "unknown"})</p>;
  return (
    <>
      <pre className="bg-muted rounded p-3 overflow-auto text-xs whitespace-pre-wrap break-all">{r.text}</pre>
      {r.truncated && (
        <p className="text-muted-foreground text-xs mt-1">
          (truncado — exibindo {r.text.length} de {r.originalLength} bytes)
        </p>
      )}
    </>
  );
}

/** Painel body/headers em tabs (ADR-5/6 — lição Bruno/Hoppscotch). */
export function ResponseView({
  body,
  headers,
  idPrefix,
}: {
  body: string;
  headers: Record<string, string>;
  idPrefix: string;
}) {
  return (
    <Tabs defaultValue={`${idPrefix}-body`}>
      <TabsList>
        <TabsTrigger value={`${idPrefix}-body`}>Body</TabsTrigger>
        <TabsTrigger value={`${idPrefix}-headers`}>Headers ({Object.keys(headers).length})</TabsTrigger>
      </TabsList>
      <TabsContent value={`${idPrefix}-body`}>
        <BodyView body={body} contentType={headers["content-type"]} />
      </TabsContent>
      <TabsContent value={`${idPrefix}-headers`}>
        <HeadersTable headers={headers} />
      </TabsContent>
    </Tabs>
  );
}
