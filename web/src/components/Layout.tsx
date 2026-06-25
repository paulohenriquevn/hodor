import { Link, Outlet } from "react-router-dom";

/** Casca da SPA: cabeçalho + navegação + área de conteúdo (Outlet das rotas). */
export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border px-6 py-3 flex items-center gap-6">
        <Link to="/" className="text-lg font-bold">
          Hodor
        </Link>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            Runs
          </Link>
          <Link to="/drafts" className="hover:text-foreground">
            Drafts
          </Link>
        </nav>
        <span className="ml-auto text-xs text-muted-foreground">revisão · hold the door</span>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
