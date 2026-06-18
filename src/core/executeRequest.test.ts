import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { executeRequest } from "./executeRequest.js";
import { RequestExecutionError } from "./errors.js";

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler);
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe("executeRequest", () => {
  it("execute_request_captures_status_headers_body", async () => {
    const url = await listen((_req, res) => {
      res.setHeader("content-type", "text/plain");
      res.statusCode = 200;
      res.end("hi");
    });
    const step = await executeRequest({ method: "GET", url });
    expect(step.response.status).toBe(200);
    expect(step.response.body).toBe("hi");
    expect(step.response.headers["content-type"]).toContain("text/plain");
    expect(step.request.method).toBe("GET");
    expect(step.request.url).toBe(url);
  });

  it("execute_request_captures_5xx_as_response", async () => {
    const url = await listen((_req, res) => {
      res.statusCode = 503;
      res.end("down");
    });
    const step = await executeRequest({ method: "GET", url });
    expect(step.response.status).toBe(503);
    expect(step.response.body).toBe("down");
  });

  it("execute_request_throws_typed_error_on_connection_refused", async () => {
    // Port 1 on loopback is not listening — connection refused.
    await expect(
      executeRequest({ method: "GET", url: "http://127.0.0.1:1/nope" }),
    ).rejects.toBeInstanceOf(RequestExecutionError);
  });

  it("execute_request_records_nonnegative_duration", async () => {
    const url = await listen((_req, res) => res.end("ok"));
    const step = await executeRequest({ method: "GET", url });
    expect(step.response.timings.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof step.response.timings.startedAt).toBe("string");
  });

  it("execute_request_get_with_body_is_handled", async () => {
    // fetch throws if GET carries a body; executeRequest must not leak that TypeError.
    const url = await listen((_req, res) => res.end("ok"));
    const step = await executeRequest({ method: "GET", url, body: "ignored" });
    expect(step.response.status).toBe(200);
    // body was not sent for GET, so the capture reflects that (no body sent).
    expect(step.request.body).toBeUndefined();
  });

  it("execute_request_captures_repeated_headers", async () => {
    const url = await listen((_req, res) => {
      res.setHeader("set-cookie", ["a=1", "b=2"]);
      res.end("ok");
    });
    const step = await executeRequest({ method: "GET", url });
    const cookie = step.response.headers["set-cookie"] ?? "";
    expect(cookie).toContain("a=1");
    expect(cookie).toContain("b=2");
  });
});
