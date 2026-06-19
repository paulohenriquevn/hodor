import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveDraft, loadDraft, listDrafts } from "./draftStore.js";
import type { Scenario } from "./scenarioSchema.js";

function scenario(over: Partial<Scenario> = {}): Scenario {
  return {
    schemaVersion: 1,
    name: "gerado",
    provenance: { origin: "agent-generated", sourceKind: "curl", sourceRef: "curl http://x", generatedAt: "2026-06-19T00:00:00.000Z" },
    steps: [{ name: "get", request: { method: "GET", url: "http://api.test/x" } }],
    ...over,
  };
}

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "hodor-draft-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("draftStore", () => {
  it("save_draft_writes_validated_scenario_with_provenance", async () => {
    const dir = await tmp();
    const { draftId, path } = await saveDraft(scenario(), { id: "d1", dir });
    expect(draftId).toBe("d1");
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(path, "utf8");
    // determinístico (chaves ordenadas — stableStringify)
    expect(raw.indexOf('"name"')).toBeLessThan(raw.indexOf('"provenance"'));
    expect(JSON.parse(raw).provenance.origin).toBe("agent-generated");
  });

  it("save_draft_rejects_scenario_without_provenance", async () => {
    const dir = await tmp();
    const noProv = { schemaVersion: 1, name: "x", steps: [{ name: "s", request: { method: "GET", url: "http://x" } }] };
    // @ts-expect-error — proveniência é obrigatória num draft (sempre gerado/autorado)
    await expect(saveDraft(noProv, { dir })).rejects.toThrow();
  });

  it("save_draft_generates_safe_id_when_omitted", async () => {
    const dir = await tmp();
    const { draftId } = await saveDraft(scenario(), { dir });
    expect(draftId).toMatch(/^[0-9a-f-]{36}$/i); // randomUUID, path-safe por construção
    expect(await loadDraft(draftId, dir)).not.toBeNull();
  });

  it("save_draft_does_not_silently_overwrite_existing_id", async () => {
    const dir = await tmp();
    await saveDraft(scenario(), { id: "dup", dir });
    await expect(saveDraft(scenario({ name: "outro" }), { id: "dup", dir })).rejects.toThrow(/already exists/);
  });

  it("save_draft_accepts_templated_url_step", async () => {
    // EC-2 (corrigido): url do step pode conter template `${{ var }}` (interpolação M1)
    // — NÃO é URL válida até resolver; validação de url é deferida ao run-time (executeRequest).
    const dir = await tmp();
    const templated = scenario({ steps: [{ name: "s", request: { method: "GET", url: "http://api.test/posts/${{ id }}" } }] });
    await expect(saveDraft(templated, { id: "t", dir })).resolves.toBeTruthy();
  });

  it("save_draft_rejects_path_traversal_id", async () => {
    const dir = await tmp();
    await expect(saveDraft(scenario(), { id: "../../etc/x", dir })).rejects.toThrow(/unsafe/);
  });

  it("load_draft_round_trips", async () => {
    const dir = await tmp();
    const s = scenario();
    await saveDraft(s, { id: "rt", dir });
    expect(await loadDraft("rt", dir)).toEqual(s);
  });

  it("load_draft_returns_null_when_absent", async () => {
    const dir = await tmp();
    expect(await loadDraft("nope", dir)).toBeNull();
  });

  it("load_draft_throws_on_corrupt_file", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "bad.json"), "{ not valid json", "utf8");
    await expect(loadDraft("bad", dir)).rejects.toThrow();
  });

  it("list_drafts_returns_saved_ids", async () => {
    const dir = await tmp();
    await saveDraft(scenario(), { id: "a", dir });
    await saveDraft(scenario(), { id: "b", dir });
    await writeFile(join(dir, "corrupt.json"), "{ broken", "utf8"); // tolera corrompido
    const ids = await listDrafts(dir);
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("list_drafts_returns_empty_when_dir_absent", async () => {
    // EC-3: diretório inexistente → [], não throw.
    expect(await listDrafts(join(tmpdir(), "hodor-draft-nonexistent-xyz"))).toEqual([]);
  });
});
