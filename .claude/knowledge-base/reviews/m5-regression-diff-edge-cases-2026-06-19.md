# Edge Case Review — m5-regression-diff

Date: 2026-06-19
Tasks analyzed: 6 (T1.1, T1.2, T1.3, T2.1, T3.1, T4.1)
Edge cases found: 13 (MUST FIX: 4, SHOULD TEST: 6, DOCUMENT: 3)

> Grounded in the real reused code: `evalJsonPath` (jsonpath-plus, swallows all errors → null),
> `normalizeRun` (never mutates), `stableStringify` (sorts object keys, **preserves array order**),
> `loadRun` (fail-loud), `listRuns` (skips corrupt per-file), web `RUN_ID_RE = /^[0-9a-f-]{36}$/i` (UUID-only),
> `reviews/{runId}.json` + `verdicts/{runId}.json` are **committable** (the approved history); `runs/` is ephemeral/gitignored.

---

## MUST FIX

### EC-1: `pruneRunHistory` can delete a run that has an approved verdict/review (loses approved history)

- **Affected task:** T2.1
- **Family:** State
- **Scenario:** A scenario accumulates > N runs. One of the older runs already has `verdicts/{runId}.json` + `reviews/{runId}.json` (human-approved, committed to git). `pruneRunHistory(limit=N)` deletes the oldest `runs/{runId}.json` purely by recency, orphaning the committed approval — the approved run page (and its diff) now 404s on `loadRun`, but the verdict/review files persist pointing at a vanished run.
- **Impact:** Silent loss of the run an operator explicitly approved; broken `reviews/`↔`runs/` referential integrity. Directly contradicts the project's audit-trail intent (`audit-trail-rotation.md`: "NEVER rotates … something approved").
- **Suggested fix:** In `pruneRunHistory`, skip deletion of any `runId` that has a `verdicts/{runId}.json` (approved runs are pinned, never pruned).

### EC-2: `pruneRunHistory` with `limit <= 0` wipes all history for the scenario

- **Affected task:** T2.1
- **Family:** Boundary
- **Scenario:** `HODOR_RUN_HISTORY_LIMIT` is set to `0`, a negative value, or a non-numeric string that parses to `0`/`NaN`. `pruneRunHistory` keeps the "N most recent" with N≤0 → deletes every run of the scenario, including the one just persisted and the one being compared.
- **Impact:** Data loss; the just-persisted run vanishes before the diff route can read it; first-run diff every time.
- **Suggested fix:** Clamp at the boundary: `const n = Number.isInteger(limit) && limit >= 1 ? limit : 10;` (or `Math.max(1, ...)`) before selecting survivors.

### EC-3: `findPreviousRun` is non-deterministic on `createdAt` tie (two runs at the same ms)

- **Affected task:** T2.1
- **Family:** Timing
- **Scenario:** `createdAt` is an ISO string at ms precision (`Date.now()`). Two runs of the same `scenarioKey` written within the same millisecond (fast loops, injected fixed clocks in tests, batch replays) share an identical `createdAt`. "Immediately before current" has no total order — sort is unstable and `prev` flips between the two depending on `readdir` order.
- **Impact:** Diff compares against an arbitrary one of two equal-timestamp runs; flaky/unreproducible diff; the E2E (which uses an injected clock) can intermittently pick the wrong baseline.
- **Suggested fix:** Make the order total — sort by `(createdAt, runId)` and define "previous" as the greatest entry strictly `< (curr.createdAt, curr.runId)`.

### EC-4: web diff route uses UUID-only `RUN_ID_RE`, but D4 says scenario hash keys can come from name-less runs — confirm the *route* id is still the UUID `runId`

- **Affected task:** T3.1
- **Family:** Format
- **Scenario:** `GET /runs/:id/diff` must validate `:id` with the existing `RUN_ID_RE = /^[0-9a-f-]{36}$/i` (UUID), then `loadRun` → derive `scenarioKey` internally → `findPreviousRun`. Risk: implementing the route to accept a `scenarioKey` (which for name-less runs is a sha256 hex, **not** 36 chars, and for named runs is arbitrary user text) in the `:id` slot. A sha256 key or a scenario `name` will be rejected by `RUN_ID_RE` (→ 400) or, worse, if the regex is loosened to fit, opens a path-traversal surface that M2/M4 closed (`SAFE_RUN_ID_RE`).
- **Impact:** Either legitimate diffs 400 (name-less / hash-keyed scenarios — exactly the run_request M0 case the plan calls out) or the route weakens the validated id boundary.
- **Suggested fix:** Route `:id` stays the UUID `runId` validated by `RUN_ID_RE`; `scenarioKey` is computed *after* `loadRun`, never taken from the URL. Add the missing test `web_diff_route_400_for_malformed_id`.

## SHOULD TEST

### EC-5: `maskNoise` — noise path that matches an entire object/branch (not a leaf)

- **Affected task:** T1.2
- **Suggested test:** `test_mask_noise_path_matches_object_subtree` — `maskNoise('{"a":{"b":1,"c":2}}', ["$.a"])` → `{"a":"<noise>"}` (whole subtree collapses to the sentinel). Assert the behavior is intentional and consistent, not partial.

### EC-6: `maskNoise` — top-level JSON array body

- **Affected task:** T1.2
- **Suggested test:** `test_mask_noise_top_level_array` — `maskNoise('[{"id":1},{"id":2}]', ["$[*].id"])` → both ids `"<noise>"`; root is a JSON array, not an object (jsonpath-plus handles it, but lock it).

### EC-7: `diffRuns` — runs with a DIFFERENT number of steps (scenario changed N→M steps)

- **Affected task:** T1.3
- **Suggested test:** `test_diff_runs_different_step_count` — prev has 2 steps, curr has 3 → diff reports the extra/missing step (e.g. `stepAdded`/`stepRemoved` or `hasRegression:true` with a structural note) rather than indexing out of bounds or silently comparing only `min(N,M)` steps and hiding the change.

### EC-8: `diffRuns` — one run carries `noise`, the other does not

- **Affected task:** T1.3
- **Suggested test:** `test_diff_runs_noise_present_on_one_side` — prev (old, no `noise`) vs curr (with `noise:["$.ts"]`). Assert the diff applies the *current* scenario's noise consistently to both bodies (so re-tagging a field as noise retroactively suppresses it), and does not crash when `prev.noise` is `undefined`.

### EC-9: `scenarioKey` — two scenarios share a `name` but have different requests (name wins → collide)

- **Affected task:** T2.1
- **Suggested test:** `test_scenario_key_name_collision_groups_distinct_scenarios` — two envelopes both `name:"login"` but different `{method,url}` steps → same key (name precedence per D4). Assert + DOCUMENT that this is intended (name is the operator-chosen identity); the diff between them is the operator's signal, not a bug.

### EC-10: `diffRuns` — comparing runs of two genuinely different scenarios (caller passed wrong pair)

- **Affected task:** T1.3
- **Suggested test:** `test_diff_runs_mismatched_scenario_keys` — `diffRuns(prevA, currB)` where `scenarioKey(prevA) !== scenarioKey(currB)`. `findPreviousRun` won't produce this, but a direct core caller can. Assert `diffRuns` still produces a structured `RunDiff` (likely `hasRegression:true`) and does not throw — it is a pure comparator, the *route* guarantees same-key pairing.

## DOCUMENT

### EC-11: `maskNoise` — invalid / malformed jsonpath in `noise` is silently ignored (no match)

- **Affected task:** T1.2
- **Accepted risk:** `evalJsonPath` already swallows parse/eval errors → `null` (confirmed in `evalCapture.ts`). A malformed `noise` path therefore masks nothing rather than throwing — consistent with the existing jsonpath contract. Acceptable: the field stays visible in the diff (fail-toward-showing, never hides a regression — aligns with risk #1). Note it so authors know a typo'd noise path is a no-op, not an error.

### EC-12: `maskNoise` — very large JSON body

- **Affected task:** T1.2
- **Accepted risk:** parse + jsonpath walk + re-serialize is O(body size); the diff page already truncates large bodies (Drawbacks table, "reusa truncamento de body do render M2"). No new mitigation needed for local single-user volume (KISS); the fix (streaming/size cap) would be worse than the problem.

### EC-13: `pruneRunHistory` vs concurrent persist (race) — last-write / interleaved readdir

- **Affected task:** T2.1
- **Accepted risk:** Plan explicitly accepts last-write-wins single-threaded file I/O per scenario (T2.1 Concurrency tests: "I/O de arquivo por id; last-write-wins aceito como M2/M3"). A persist landing mid-prune may survive a cycle and be pruned next time — benign for ephemeral local `runs/`. Documenting so it is a conscious acceptance, not an oversight. (The *approved-run* race is NOT benign — see EC-1, which is a MUST FIX.)

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 (maskNoise) | 4 | 0 | 2 (EC-5,6) | 2 (EC-11,12) |
| T1.3 (diffRuns) | 3 | 0 | 3 (EC-7,8,10) | 0 |
| T2.1 (runHistory) | 5 | 3 (EC-1,2,3) | 1 (EC-9) | 1 (EC-13) |
| T3.1 (web diff) | 1 | 1 (EC-4) | 0 | 0 |
| T4.1 (E2E) | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

Plan is strong (D1-D6 well-reasoned, body-noise & corrupt-file already covered). Four MUST FIX
all live in T2.1/T3.1 boundaries and each is a ≤3-line/≤1-sentence fix: pin approved runs from
pruning (EC-1), clamp `limit>=1` (EC-2), total-order `(createdAt, runId)` for the previous-run
tie (EC-3), and keep the diff route `:id` as the UUID `runId` validated by `RUN_ID_RE` (EC-4).
Absorb the four into the plan (T2.1 + T3.1 sub-tasks / TDD reds), then re-run `/plan-confidence`.
