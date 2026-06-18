import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWebServer } from "./server.js";

let server: Server | undefined;
let dir: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hodor-web-"));
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  }
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

function start(): Promise<string> {
  server = buildWebServer(dir!);
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe("web server", () => {
  it("web_server_returns_404_for_missing_run", async () => {
    const base = await start();
    // valid UUID-shaped id that does not exist on disk
    const res = await fetch(`${base}/runs/11111111-1111-1111-1111-111111111111`);
    expect(res.status).toBe(404);
  });

  it("web_server_rejects_path_traversal_id", async () => {
    const base = await start();
    // EC-1: non-UUID id (path traversal attempt) must be rejected with 400, no file leak.
    const res = await fetch(`${base}/runs/..%2f..%2fpackage.json`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain("\"name\": \"hodor\"");
  });

  it("web_server_root_shows_no_runs_when_empty", async () => {
    const base = await start();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("no runs yet");
  });
});
