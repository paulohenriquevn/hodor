import { RouterProvider, createBrowserRouter, type RouteObject } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RunListPage } from "./pages/RunListPage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { DiffPage } from "./pages/DiffPage";
import { DraftListPage } from "./pages/DraftListPage";

/** Rotas exportadas para o E2E montar um memory router contra a API real. */
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: "/", element: <RunListPage /> },
      { path: "/runs/:id", element: <RunDetailPage /> },
      { path: "/runs/:id/diff", element: <DiffPage /> },
      { path: "/drafts", element: <DraftListPage /> },
    ],
  },
];

export function App() {
  return <RouterProvider router={createBrowserRouter(routes)} />;
}
