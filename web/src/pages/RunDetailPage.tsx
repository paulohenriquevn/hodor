import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAsync } from "../lib/useAsync";
import { fetchRun } from "../api";
import { Async } from "../components/Async";
import { RunDetail } from "../components/RunDetail";
import { VerdictForm } from "../components/VerdictForm";
import { ReviewArtifactLink } from "../components/ReviewArtifactLink";

export function RunDetailPage() {
  const { id = "" } = useParams();
  const [reload, setReload] = useState(0);
  const state = useAsync(() => fetchRun(id), [id, reload]);
  return (
    <div className="flex flex-col gap-4">
      <Link to="/" className="text-sm underline text-muted-foreground">
        ← voltar
      </Link>
      <Async state={state}>
        {(data) => (
          <>
            <div className="flex gap-3 text-sm">
              <Link className="underline" to={`/runs/${id}/diff`}>
                ver diff
              </Link>
            </div>
            <RunDetail run={data.run} verdict={data.verdict} />
            <ReviewArtifactLink runId={id} hasVerdict={data.verdict !== null} />
            <VerdictForm
              runId={id}
              hasFailingAsserts={
                data.verdict === null &&
                data.run.steps.some((s) => (s.asserts ?? []).some((a) => !a.pass))
              }
              onDecided={() => setReload((n) => n + 1)}
            />
          </>
        )}
      </Async>
    </div>
  );
}
