import type { AsyncState } from "../lib/useAsync";

/** Renderiza estados de loading/erro de forma explícita (DRY entre páginas). */
export function Async<T>({ state, children }: { state: AsyncState<T>; children: (data: T) => React.ReactNode }) {
  if (state.loading) return <p className="text-muted-foreground">carregando…</p>;
  if (state.error)
    return (
      <p role="alert" className="text-red-700">
        Erro: {state.error}
      </p>
    );
  if (state.data === null) return null;
  return <>{children(state.data)}</>;
}
