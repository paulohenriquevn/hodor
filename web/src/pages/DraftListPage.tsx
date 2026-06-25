import { useAsync } from "../lib/useAsync";
import { fetchDrafts, fetchDraft } from "../api";
import { Async } from "../components/Async";
import { DraftList } from "../components/DraftList";
import type { Draft } from "../types";

export function DraftListPage() {
  const state = useAsync(async () => {
    const ids = await fetchDrafts();
    const drafts = await Promise.all(ids.map(async (id) => ({ id, draft: await fetchDraft(id) })));
    return drafts as Array<{ id: string; draft: Draft }>;
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Drafts — gerados pelo agente (pendentes)</h1>
      <Async state={state}>{(drafts) => <DraftList drafts={drafts} />}</Async>
    </div>
  );
}
