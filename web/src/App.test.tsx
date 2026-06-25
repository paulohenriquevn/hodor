import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { routes } from "./App";

describe("App (M8 — smoke)", () => {
  it("app_renders_title_hodor", () => {
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/"] })} />);
    expect(screen.getByText("Hodor")).toBeInTheDocument();
  });
});
