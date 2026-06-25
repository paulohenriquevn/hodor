import { useAsync } from "../lib/useAsync";
import { fetchReview } from "../api";

/**
 * Mostra o link/resumo do artefato de review versionado (commitável) quando o run
 * já tem verdict. Caller de produção do endpoint `/api/reviews/:id` (DoD #1).
 */
export function ReviewArtifactLink({ runId, hasVerdict }: { runId: string; hasVerdict: boolean }) {
  const state = useAsync(() => (hasVerdict ? fetchReview(runId) : Promise.resolve(null)), [runId, hasVerdict]);
  if (!hasVerdict || !state.data) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Artefato versionado: <code>reviews/{runId}.json</code> (v{state.data.artifactVersion}, decidido{" "}
      {state.data.verdict.decidedAt})
    </p>
  );
}
