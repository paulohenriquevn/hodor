import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResponseView } from "./ResponseView";

describe("ResponseView (M8 — viewer por content-type, paridade ADR-5)", () => {
  it("response_view_renders_json_pretty", () => {
    render(<ResponseView body='{"a":1}' headers={{ "content-type": "application/json" }} idPrefix="t" />);
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument(); // pretty-printed
  });

  it("response_view_omits_binary_body", () => {
    render(<ResponseView body={"\x00\x01"} headers={{ "content-type": "image/png" }} idPrefix="t" />);
    expect(screen.getByText(/binary omitido/)).toBeInTheDocument();
  });

  it("response_view_empty_body_message", () => {
    render(<ResponseView body="" headers={{}} idPrefix="t" />);
    expect(screen.getByText("(empty body)")).toBeInTheDocument();
  });

  it("response_view_headers_table", () => {
    render(<ResponseView body="x" headers={{ "x-custom": "v" }} idPrefix="t" />);
    // a aba Headers mostra a contagem; ativar a aba (role=tab) revela a tabela Name/Value
    const tab = screen.getByRole("tab", { name: /Headers \(1\)/ });
    expect(tab).toBeInTheDocument();
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    expect(screen.getByText("x-custom")).toBeInTheDocument();
  });
});
