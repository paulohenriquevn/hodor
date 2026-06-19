# Edge Case Review — m4-scenario-generation

Date: 2026-06-19
Tasks analyzed: 5 (T1.1, T1.2, T1.3, T2.1, T3.1, T4.1)
Edge cases found: 9 (MUST FIX: 2, SHOULD TEST: 4, DOCUMENT: 3)

> Scope: real boundary edges of the M4 plan against the actual post-M3 source
> (`scenarioSchema.ts`, `runSchema.ts`, `runScenario.ts`, `runStore.ts`,
> `reviewArtifact.ts`, `web/server.ts`, `web/render.ts`, `mcp/server.ts`,
> `executeRequest.ts`). The plan is strong: provenance is additive/optional,
> backward-compat is asserted, fail-loud + path-safety are explicitly mirrored
> from M3, and XSS escaping is inherited from M2. Two real gaps remain at the
> draft-id and URL-validation boundaries.

## MUST FIX

### EC-1: draftId generation/collision is unspecified — `saveDraft(scenario, id?, dir?)` can silently overwrite or produce a non-path-safe default
- **Affected task:** T1.3 (draftStore) + T2.1 (tool `save_scenario_draft`)
- **Family:** State / Permission
- **Scenario:** The plan signature is `saveDraft(scenario, id?, dir?)` and the tool
  output is `{draftId, path}`, but no TDD defines (a) what `draftId` is when `id?`
  is omitted, nor (b) what happens when the same `id` is saved twice. If the agent
  supplies `id` (it controls the MCP call), two drafts with the same id silently
  overwrite (last-write-wins on the same file). If the store auto-generates, the
  generator must be path-safe by construction.
- **Impact:** Silent draft loss (overwrite) — a generated candidate the human meant
  to review disappears; OR an agent-chosen id that passes `assertSafeId` but is not
  unique collides with an existing draft. Both are real because the agent is an
  untrusted-quality source (risk #1).
- **Suggested fix:** Default `id` to `crypto.randomUUID()` when omitted (mirror
  `runStore.ts:29` `newId`); the auto-generated id is path-safe by construction.
  Add TDD `save_draft_generates_safe_id_when_omitted` and
  `save_draft_does_not_silently_overwrite_existing_id` (decide+assert: either reject
  duplicate or document last-write-wins as in M2/M3 verdict — the plan claims
  last-write-wins is "aceito", so the TDD must assert that behavior explicitly).

### EC-2: a draft Scenario with an invalid step `url` validates and persists, then fails only later at run time (`ScenarioStepSchema.url` is `z.string()`, not `.url()`)
- **Affected task:** T1.3 (DraftSchema = Scenario + provenance) + T1.1/T1.2
- **Family:** Format / Input
- **Scenario:** `ScenarioStepSchema.request.url` is `z.string()` (`scenarioSchema.ts:42`)
  — it does NOT validate URL shape. `CapturedRequestSchema.url` IS `z.string().url()`
  (`runSchema.ts:14`). So a draft like `{steps:[{request:{url:"not a url"}}]}` passes
  `ScenarioSchema.parse` and `saveDraft` happily writes it. The defect only surfaces
  much later when the human runs it: `runScenario` → `executeRequest` → `fetch("not a url")`
  throws `RequestExecutionError`, aborting the run (`executeRequest.ts:53`).
- **Impact:** A malformed draft is accepted as a valid candidate, enters the review
  flow marked "gerado pelo agente · pendente", and only blows up at execution — far
  from the boundary where it was introduced (violates fail-fast). The agent is the
  most likely producer of a bad url (risk #1).
- **Suggested fix:** This is a pre-existing M1 schema gap, but M4 is the first feature
  where an unexecuted artifact is persisted, so it bites here. Add TDD
  `save_draft_rejects_step_with_invalid_url` and tighten the draft boundary: in
  `DraftSchema`, validate step urls (e.g. a `.superRefine` checking each
  `step.request.url` parses as a URL), OR document explicitly that draft url
  validation is deferred to run time. Pick one and assert it.

## SHOULD TEST

### EC-3: `listDrafts` on a non-existent `drafts/` directory must return `[]`, not throw
- **Affected task:** T1.3
- **Suggested test:** `test_list_drafts_returns_empty_when_dir_absent` — call
  `listDrafts(dir)` where `dir` does not exist; assert it resolves to `[]` (mirror
  `web/server.ts:211-216` `listRuns`, which catches `readdir` failure and returns `[]`).
  The plan's `list_drafts_returns_saved_ids` + "tolera arquivo corrompido" covers the
  corrupt-file case but not the missing-directory case, which is the common cold-start
  state (no draft saved yet).

### EC-4: provenance must NOT be invented for legacy (M0–M3) runs during normalization
- **Affected task:** T1.2 (`buildReviewArtifact` carries `env.provenance`)
- **Suggested test:** `test_build_review_artifact_omits_provenance_when_env_has_none`
  — a legacy `RunEnvelope` without `provenance` → artifact has no `provenance` key
  (not `undefined`, not a default `human-authored`). The plan asserts this in T1.2
  ("sem provenance no env → ausente no artefato"); keep it as a hard assertion so a
  legacy run is never silently relabeled. (This is the correct, expected behavior —
  a legacy run staying provenance-less is fine.)

### EC-5: round-trip determinism — a draft saved with `stableStringify` must reload byte-identical after a human edit + re-save
- **Affected task:** T1.3
- **Suggested test:** `test_save_draft_is_idempotent_on_resave` — `saveDraft` →
  `loadDraft` → `saveDraft` produces identical bytes (ordered keys). DoD #3 says the
  human edits the draft in git; an unstable serialization would create noisy diffs
  on every re-save, defeating the commitable-draft rationale (ADR-4).

### EC-6: provenance with a valid `origin` but mismatched `sourceKind`/`sourceRef` (e.g. `sourceKind:"curl"` with no `sourceRef`) must still validate as designed
- **Affected task:** T1.1 (ProvenanceSchema)
- **Suggested test:** `test_provenance_accepts_sourcekind_without_sourceref` — confirm
  `sourceRef` stays optional regardless of `sourceKind` (the plan's
  `provenance_schema_allows_optional_source_ref` covers the absence; add one case
  asserting `sourceKind:"curl"` + no `sourceRef` is intentionally valid so a future
  reviewer doesn't "tighten" it into a cross-field requirement nobody asked for — YAGNI).

## DOCUMENT

### EC-7: oversized `provenance.sourceRef` bloats the rendered HTML (no truncation on metadata)
- **Accepted risk:** `truncate()` in `render.ts:52` applies only to response/request
  bodies (`MAX_BODY` = 64 KB), NOT to `name` or to the new `sourceRef` badge text.
  A huge `sourceRef` (e.g. a full curl with a megabyte body pasted by the agent) is
  escaped (no XSS) but renders in full, inflating the page. Acceptable now: same
  unbounded behavior already exists for `env.name` (rendered un-truncated since M2);
  the threat model is local single-user (`web/server.ts:256` binds 127.0.0.1). Revisit
  only if a real draft produces an unusable page. The fix, if ever needed, is one line
  reusing `truncate()` on the badge text.

### EC-8: XSS on `provenance.sourceRef` is already mitigated by the inherited M2 `escapeHtml`
- **Accepted risk:** Confirmed safe by design — `render.ts:30` `escapeHtml` escapes
  `& < > " '` and is applied to every dynamic field (`name`, `url`, headers, verdict
  `note`). The plan's T3.1 TDD `render_escapes_provenance_source_ref` correctly extends
  this. No action needed beyond keeping that test; flagged here only to close the
  question explicitly: the badge MUST pass `sourceRef` through `escapeHtml`, never
  interpolate it raw.

### EC-9: human edits the draft and breaks the JSON — `loadDraft` fails loud (correct)
- **Accepted risk:** This is the intended behavior. The plan mirrors
  `reviewArtifact.ts:96` / `runStore.ts:54`: a corrupt/edited-broken draft → `loadDraft`
  throws (ZodError or JSON parse error), and `listDrafts` skips it without a 500 (per
  T1.3 `list_drafts ... tolera arquivo corrompido`). Fail-loud on direct load is the
  honest behavior (Rule 8). No fix — confirmed the plan handles it. Worth noting:
  ensure the MCP `save_scenario_draft` tool does NOT re-load all drafts on save (no
  read-amplification path where one human-broken draft fails an unrelated save).

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 (EC-6) | 0 |
| T1.2 | 1 | 0 | 1 (EC-4) | 0 |
| T1.3 | 5 | 2 (EC-1, EC-2) | 2 (EC-3, EC-5) | 1 (EC-9) |
| T2.1 | 1 | (EC-1 shared) | 0 | 0 |
| T3.1 | 2 | 0 | 0 | 2 (EC-7, EC-8) |
| T4.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

The plan is well-grounded (additive provenance, backward-compat asserted, fail-loud
+ path-safety mirrored from M3, XSS inherited from M2, no new dependency). Two real
boundary gaps must be closed before implementation: (EC-1) define draftId
generation + duplicate-id behavior so generated candidates are never silently lost,
and (EC-2) decide+assert what happens to a draft whose step `url` is malformed
(`ScenarioStepSchema.url` is `z.string()`, not `.url()`) — accept run-time failure
explicitly or validate at the draft boundary. Both fixes are ≤3 lines + one TDD each;
neither adds a module or a dependency.
