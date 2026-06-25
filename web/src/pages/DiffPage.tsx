import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAsync } from "../lib/useAsync";
import { fetchDiff } from "../api";
import { Async } from "../components/Async";
import { DiffView } from "../components/DiffView";
import { Button } from "../components/ui/button";

export function DiffPage() {
  const { id = "" } = useParams();
  const [vs, setVs] = useState<"golden" | "previous">("golden");
  const state = useAsync(() => fetchDiff(id, vs), [id, vs]);
  return (
    <div className="flex flex-col gap-4">
      <Link to={`/runs/${id}`} className="text-sm underline text-muted-foreground">
        ← voltar ao run
      </Link>
      <div className="flex gap-2">
        <Button size="sm" variant={vs === "golden" ? "default" : "outline"} onClick={() => setVs("golden")}>
          vs golden
        </Button>
        <Button size="sm" variant={vs === "previous" ? "default" : "outline"} onClick={() => setVs("previous")}>
          vs anterior
        </Button>
      </div>
      <Async state={state}>{(data) => <DiffView data={data} />}</Async>
    </div>
  );
}
