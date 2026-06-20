# Edge Case Review — m7-env-secrets

Date: 2026-06-20
Tasks analyzed: 5 (T1.1, T1.2, T1.3, T2.1, T3.1)
Edge cases found: 9 (MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 3)

> Security milestone — reviewed with leak-bias. The plan's central security promise is
> "o segredo NUNCA é persistido: `redactSecretValues` redige por VALOR em url/headers/body/captures".
> The most dangerous finding (EC-1) is a case where that promise is **silently false** AND the
> plan's own E2E (T3.1) would still pass — i.e. green tests that do not prove the invariant.

---

## MUST FIX

### EC-1: Secret in the URL is percent-encoded before persistence — raw-value redaction MISSES it
- **Affected task:** T1.2 (`redactSecretValues`), validated falsely by T3.1
- **Family:** Format / Boundary
- **Scenario:** `interpolateRequest` (`src/core/interpolate.ts:35-41`) runs `encodeURIComponent(String(v))` on **every** variable before substituting it into the URL. The run envelope stores the *resolved, executed* request (`runScenario.ts:29` → `executeRequest.ts:64-66`), so `request.url` holds the **encoded** form. If a secret has any character `encodeURIComponent` transforms (`/ + = : @ ? # & space %` etc.), the value stored in `request.url` is e.g. `tok%2Fen%3D`, NOT the raw `tok/en=`. The plan's `redactSecretValues(env, values)` substitutes the **raw** `values` (D3/T1.2 line 81: "substitui cada VALOR-segredo"). It will scan for `tok/en=` and not find `tok%2Fen%3D` → the secret persists in `runs/{id}.json` and in `structuredContent`.
- **Why the plan's E2E does not catch it:** T3.1 uses `HODOR_SECRET_TOKEN=s3cr3t-token`. `encodeURIComponent("s3cr3t-token") === "s3cr3t-token"` (letters/digits/`-` are unreserved). The token is only ever in a header (`Authorization`), never in a URL, in that scenario. So T3.1 goes green while the URL-encoding gap is wide open. **Green test, unproven invariant** — exactly the failure mode the golden rules warn about.
- **Impact:** Real JWTs/API keys routinely contain `.` `_` `-` (safe) but also `/` `+` `=` (base64), `:` (basic-auth `user:pass`), `%`. Any such secret interpolated into a URL (path or query) leaks **verbatim-encoded** into committed/persisted sinks. High-severity leak of the exact class M7 exists to prevent.
- **Suggested fix:** In `redactSecretValues`, for each secret value also redact its encoded form: build the candidate set `[v, encodeURIComponent(v)]` per value (still longest-first across the union), then substitute. ≤3 lines: `const variants = values.flatMap(v => [v, encodeURIComponent(v)]).filter(Boolean); variants.sort((a,b)=>b.length-a.length); /* replace each */`. Add a T1.2 RED test `redact_secret_values_scrubs_url_encoded_form` with a secret containing `/` and `=`.

### EC-2: T3.1 E2E secret value cannot demonstrate the URL/body/encoding paths
- **Affected task:** T3.1
- **Family:** Format / Test-validity
- **Scenario:** The single E2E secret `s3cr3t-token` is (a) encoding-invariant and (b) only placed in a header. The plan's Goal is "*provado por um teste E2E verde*" and DoD #2 asserts `runs/{id}.json` contains no `s3cr3t-token`. That assertion passes trivially regardless of whether EC-1 is fixed, so the headline metric does not actually prove the no-leak invariant for the realistic (URL/encoded/body) cases.
- **Impact:** False confidence at the milestone gate. The security claim ships unproven for its hardest case.
- **Suggested fix:** Add to T3.1 a second secret containing URL-special chars (e.g. `HODOR_SECRET_KEY=a/b+c=d`) placed in a **query string** (`?key=${{ env.KEY }}`) and in the **body**, and assert the run JSON contains neither the raw nor the `encodeURIComponent` form. ≤1 sentence plan change.

### EC-3: `checkScenario` redaction depends on `deps.secrets`; the `run` is still raw whenever secrets are not threaded
- **Affected task:** T1.3 / T2.1
- **Family:** State / Permission
- **Scenario:** T1.3 redacts via `redactSecretValues(run, Object.values(deps.secrets ?? {}))`. With `deps.secrets` undefined/empty (the `?? {}` path), the returned `CheckResult.run` is the **raw** envelope — confirmed: today `checkScenario` has *no* redaction at all and returns the raw `run` (`checkScenario.ts:23,45,50`). The adapter (`server.ts` `check_scenario` / `replay_suite`) then `persistRun`s that returned run raw. If the adapter ever calls `checkScenario`/`replaySuite` **without** passing the resolved secrets (or passes only a subset), the auth header / captured token persists unredacted. The plan wires secrets into `run_scenario` and `check_scenario` (T2.1) but the `replaySuite` path is not explicitly listed as receiving `secrets` — and `replaySuite` calls `checkScenario` internally (`replaySuite.ts:60`).
- **Impact:** A `replay_suite` run of an authenticated scenario could persist the live token even after M7 lands, because the redaction is opt-in via deps rather than enforced at the persistence boundary.
- **Suggested fix:** Make `replaySuite` thread `options.deps` (already does: `replaySuite.ts:60` passes `options.deps`) AND have the **adapter** redact at `persistRun` time with the resolved secret set as the single choke point, so redaction does not depend on each core function remembering to redact. ≤1 sentence: "T2.1 — redact the run with `Object.values(secrets)` immediately before *every* `persistRun` in the adapter (run_scenario, run_request, run_scenario inside check/replay), not only inside `checkScenario`."

---

## SHOULD TEST

### EC-4: Very short / numeric secret causes over-redaction (collateral scrubbing)
- **Affected task:** T1.2
- **Scenario:** `HODOR_SECRET_X=1` or `=a`. `redactSecretValues` does a global string substitution of `"1"`/`"a"` → every digit `1` / letter `a` anywhere in url/body/response/captures becomes `<redacted>`, corrupting the run and making diffs meaningless. longest-first does not help a single short value.
- **Suggested test:** `test_redact_secret_values_short_value_is_safe` — assert a 1-char secret does not shred unrelated content. Minimal fix: only redact values with `length >= MIN_SECRET_LEN` (e.g. 4) and surface a one-time WARN (name only, never value) for shorter ones; or treat sub-threshold secrets as a `ScenarioError` ("refuse to redact ambiguously short secret"). Either is ≤3 lines and avoids both over-redaction and a silent partial leak.

### EC-5: `HODOR_SECRET_X=""` (present but empty) injects an empty string and redaction is a no-op
- **Affected task:** T2.1 / T1.1
- **Scenario:** D6 fail-fast only covers a *missing* var. An env var that **exists but is empty** (`HODOR_SECRET_TOKEN=`) passes `resolveHodorSecrets` (prefix matches), seeds `env.TOKEN=""`, interpolates `Authorization: Bearer ` (empty), executes a broken-but-200?/401 request, and `redactSecretValues` with `[""]` is an explicit no-op (plan T1.2 line 143/150). Confusing auth failure with no signal pointing at the empty secret.
- **Suggested test:** `test_resolve_hodor_secrets_rejects_empty_value` — assert an empty `HODOR_SECRET_*` either throws `ScenarioError` ("secret X is empty") or is excluded from the injectable map. ≤3 lines in `resolveHodorSecrets`: `if (v === "") continue; // or throw`.

### EC-6: `HODOR_SECRET_` with no name suffix → empty key `env.`
- **Affected task:** T2.1
- **Scenario:** An env var literally named `HODOR_SECRET_` (prefix, empty suffix). Stripping the prefix yields key `""`, seeding `variables["env."]`. Harmless-ish but pollutes the namespace and could shadow nothing useful; a malformed allowlist entry should be rejected loudly, not silently injected.
- **Suggested test:** `test_resolve_hodor_secrets_skips_empty_name` — assert `HODOR_SECRET_` (no suffix) is ignored/rejected. ≤1 line: `if (name === "") continue;` after stripping the prefix.

---

## DOCUMENT

### EC-7: Pre-M7 goldens may hold a raw `Authorization` value in `runs/` → redacted-new-run vs raw-golden false diff
- **Affected task:** T1.3
- **Accepted risk / note:** Pre-M7 authenticated runs were impossible to capture against a real endpoint (the M6 "auth ceiling" — `checkScenario.ts:15-16` says authenticated endpoints gave false `regression`/401 until M7). So a *passing* golden bearing a real token is unlikely to exist. But any pre-M7 golden whose `runs/{id}.json` retained a non-sensitive-header token (M3 redacted Authorization by **name** in the review artifact, not in raw `runs/`) would, post-M7, diff against a redacted new run and show a false regression. Low likelihood; document the migration note: "goldens captured before M7 against auth endpoints should be re-approved; a one-time false `regression` on the auth header after M7 lands is expected and resolved by re-running `save_scenario_draft`/re-approval." No code change — the diff comparing `<redacted>` (new) vs raw (old golden) is the *correct* fail-loud behavior; it just needs a human re-approval.

### EC-8: `request.body` and non-volatile `response.header` values are only covered by the NEW value-redactor, not by M3
- **Affected task:** T1.2
- **Accepted risk / note:** Confirmed `normalizeRun` redacts only `request.headers` by name; `request.url`, `request.body`, `response.body`, non-volatile `response.headers` values, and `captures` are NOT redacted by the M3 path. M7's `redactSecretValues` is the *only* thing covering them — so EC-1's correctness is load-bearing for body/url/response too. Already in plan scope (T1.2 lists url/headers/body/captures + response echo); documenting that response **headers** values (e.g. a token reflected in a custom `X-Echo-Token` non-volatile response header) are also a sink the redactor must walk, not just response body. Confirm T1.2's "todos os campos do run" explicitly includes `response.headers` values.

### EC-9: stderr leakage — current logging is clean; preserve the invariant
- **Affected task:** T2.1
- **Accepted risk / note:** Verified `src/mcp/server.ts` structured logs (`prune_history`, `run_request`, `run_scenario`, `check_scenario`, `save_scenario_draft`, `replay_suite`) log only keys/counts/ids/origin/status/durations — **no header values, bodies, or secrets**. `replaySuite` records `err.message` which for a network failure is `` `request failed: ${url}` `` / `` `timeout: ${url}` `` — and that URL is the **post-interpolation, percent-encoded** URL, so a secret embedded in a URL could surface in the suite `error` string (ties to EC-1). Once EC-1's encoded-form redaction lands, redact the error string too, or assert error messages never contain a secret value. Plan's "nunca logar o valor" is satisfied for headers/body today; the URL-in-error path is the one to keep an eye on.

---

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 (EC-5 shared) | 0 |
| T1.2 | 4 | 1 (EC-1) | 1 (EC-4) | 2 (EC-8, EC-9 ties) |
| T1.3 | 2 | 1 (EC-3) | 0 | 1 (EC-7) |
| T2.1 | 3 | 1 (EC-3 shared) | 2 (EC-5, EC-6) | 1 (EC-9) |
| T3.1 | 1 | 1 (EC-2) | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

The plan is well-structured and the by-value + longest-first + allowlist-by-prefix design is sound. But for a **security** milestone it has one structural hole that defeats its central promise: **`redactSecretValues` matches the raw secret string, while `interpolateRequest` stores the URL-embedded secret in `encodeURIComponent` form** (EC-1) — and the plan's own E2E (EC-2) uses an encoding-invariant, header-only token that cannot detect this. Both MUST-FIX items are small (≤3 lines + one test secret). EC-3 (redact at the `persistRun` choke point rather than per-function) hardens the no-leak guarantee against future call sites. Resolve EC-1, EC-2, EC-3 before `/plan-confidence`; fold EC-4/5/6 into the existing T1.2/T2.1 TDD blocks.
