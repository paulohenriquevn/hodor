import { useAsync } from "../lib/useAsync";
import { fetchRuns } from "../api";
import { Async } from "../components/Async";
import { RunList } from "../components/RunList";

export function RunListPage() {
  const state = useAsync(() => fetchRuns(), []);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Execuções para revisão</h1>
      <Async state={state}>{(items) => <RunList items={items} />}</Async>
    </div>
  );
}
