# AI Evaluation Baseline Deltas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a committed deterministic score manifest that blocks every AI evaluation regression and can be refreshed only through an explicit, fully passing local command.

**Architecture:** Move baseline-specific schema, fingerprint, comparison, and canonical serialization into a focused module consumed by the existing evaluator CLI. Normal evaluation stays read-only and compares the real result to the committed manifest; a separate refresh entrypoint performs two deterministic evaluations and atomically replaces only the canonical manifest.

**Tech Stack:** Node.js 20 ESM, `tsx`, TypeScript agent schemas/functions, built-in `node:test`, JSON, SHA-256, pnpm 8, GitHub Actions.

## Global Constraints

- Normal `pnpm run eval:ai` is read-only and blocks every negative case, tool, or overall delta with no tolerance.
- Existing case minimum `85`, tool mean `90`, overall mean `90`, and contract/safety hard-failure rules remain unchanged and independently enforced.
- Missing/extra cases or tools, identity drift, threshold drift, fingerprint drift, malformed schema, noncanonical ordering/bytes, and unsafe baseline filesystem state fail closed.
- The baseline is `evals/baselines/ai-output-baseline.json`; it has no timestamp, path, environment, provider, network, model-judge, production, or secret-derived content.
- The fingerprint is SHA-256 over canonical validated datasets, weights, thresholds, check/category mapping, and baseline schema version.
- `pnpm run eval:ai:update-baseline` is the only baseline refresh command; it cannot bless hard failures, absolute-threshold failures, incomplete coverage, or nondeterministic results.
- Refresh writes only the canonical manifest through exclusive temporary creation, identity/link verification, fsync, atomic replacement, post-install verification, and failure cleanup.
- `verify:local:strict` continues to invoke normal `eval:ai` exactly once; CI never runs refresh or a second evaluator step.
- All behavior changes use red-green-refactor and finish with protected verification, independent specialist review, PR `Full Stack`, merge, and successful post-merge `main` CI.

---

### Task 1: Baseline schema, fingerprint, and regression comparison

**Files:**
- Create: `scripts/ai-evaluation-baseline.mjs`
- Create: `evals/baselines/ai-output-baseline.json`
- Modify: `scripts/evaluate-ai-outputs.mjs`
- Modify: `tests/ai-output-evaluator.test.mjs`
- Modify: `.agents/engineering-policy.json`

**Interfaces:**
- Produces: `buildEvaluationFingerprint({ datasets }) -> string`
- Produces: `buildBaselineManifest({ datasets, result }) -> BaselineManifest`
- Produces: `formatBaselineManifest(manifest) -> string`
- Produces: `loadBaselineManifest({ repoRoot, baselinePath? }) -> Promise<BaselineManifest>`
- Produces: `compareEvaluationToBaseline({ baseline, datasets, result }) -> BaselineComparison`
- `BaselineComparison`: `{ fingerprint, cases, tools, overall, unchangedCount, regressions, passed }`

- [ ] **Step 1: Write failing schema and containment tests**

Add tests that create temporary repositories and assert strict rejection for missing baseline, malformed JSON, exact-key violations, wrong schema version, duplicate/unsorted case or tool entries, invalid IDs/tool/age bands, noninteger case scores, non-two-decimal normalized means, threshold drift, missing/extra cases/tools, case identity drift, noncanonical bytes, fingerprint mismatch, baseline symlink/hard link, baseline-directory junction, lexical escape, and physical escape.

Use this canonical shape:

```json
{
  "version": 1,
  "fingerprint": "<64 lowercase hex characters>",
  "thresholds": { "case": 85, "toolMean": 90, "overallMean": 90 },
  "cases": [{ "id": "voice-clouds-4-6", "tool": "voice_chat", "ageBand": "4-6", "score": 100 }],
  "tools": [{ "tool": "voice_chat", "mean": 100 }],
  "overallMean": 100
}
```

- [ ] **Step 2: Confirm schema RED**

Run: `node --import tsx --test --test-name-pattern="baseline schema|baseline containment" tests/ai-output-evaluator.test.mjs`

Expected: import failure for missing `scripts/ai-evaluation-baseline.mjs`.

- [ ] **Step 3: Implement strict baseline model and loader**

Define exact keys, version `1`, tool/age enums, score/mean validation, thresholds, canonical sort checks, canonical JSON with two-space indentation and one trailing newline, and physical containment under `<canonicalRoot>/evals/baselines`. Reject nonregular or multi-link files and linked/relocated directories. Export pure validation/formatting helpers for focused tests.

- [ ] **Step 4: Confirm schema GREEN**

Run the Step 2 command and require every baseline schema/containment test to pass.

- [ ] **Step 5: Write failing fingerprint and delta tests**

Assert fingerprint stability under repeated calls, sensitivity to dataset/check/weight/threshold/schema changes, and exclusion of repo paths/environment/order noise. Assert exact comparison behavior:

```js
assert.equal(compare.passed, false);
assert.deepEqual(compare.regressions, [
  { scope: "case", id: "voice-clouds-4-6", baseline: 100, current: 99, delta: -1 }
]);
```

Cover case `100 -> 99`, tool `100.00 -> 99.99`, overall `100.00 -> 99.99`, regressions still above absolute thresholds, zero deltas, positive deltas, missing/extra identities, hard failures, absolute-threshold failures, stable lexical ordering, and exact signed deltas.

- [ ] **Step 6: Confirm fingerprint/delta RED**

Run: `node --import tsx --test --test-name-pattern="baseline fingerprint|baseline delta|regression" tests/ai-output-evaluator.test.mjs`

Expected: missing fingerprint/comparison behavior failures.

- [ ] **Step 7: Implement fingerprint and comparison**

Canonicalize the four validated datasets plus exported evaluator contract metadata, hash with `createHash("sha256")`, construct manifests from sorted results, and compare exact normalized values. Keep absolute failures and regression reasons separate but require both to pass.

- [ ] **Step 8: Commit the generated initial baseline and protect surfaces**

Generate the canonical manifest from the real current evaluation, add `evals/baselines/**` and `scripts/ai-evaluation-baseline.mjs` to protected engineering surfaces, and confirm generation twice is byte-identical.

- [ ] **Step 9: Confirm Task 1 GREEN**

Run: `node --import tsx --test tests/ai-output-evaluator.test.mjs tests/engineering-policy.test.mjs`

Expected: all evaluator and policy tests pass; current comparison has zero regressions and passes.

- [ ] **Step 10: Commit Task 1**

```powershell
git add scripts/ai-evaluation-baseline.mjs scripts/evaluate-ai-outputs.mjs tests/ai-output-evaluator.test.mjs evals/baselines/ai-output-baseline.json .agents/engineering-policy.json
git commit -m "Add deterministic AI evaluation baseline"
```

---

### Task 2: Canonical baseline refresh command

**Files:**
- Create: `scripts/update-ai-evaluation-baseline.mjs`
- Modify: `scripts/ai-evaluation-baseline.mjs`
- Modify: `scripts/evaluate-ai-outputs.mjs`
- Modify: `tests/ai-output-evaluator.test.mjs`
- Modify: `package.json`
- Modify: `scripts/engineering-policy.mjs`

**Interfaces:**
- Consumes: Task 1 manifest/fingerprint/format APIs
- Produces: `refreshEvaluationBaseline({ repoRoot, evaluate?, io?, testHooks? }) -> Promise<RefreshResult>`
- Produces CLI: `pnpm run eval:ai:update-baseline`
- `RefreshResult`: `{ path, previous, current, comparison, bytesChanged }`

- [ ] **Step 1: Write failing refresh refusal tests**

Test refusal for invalid arguments, current hard failure, current absolute-threshold failure, missing tool/age coverage, nondeterministic double evaluation, fingerprint instability, linked/relocated baseline directory, target symlink/hard link, root/directory replacement during write, temporary-file hard link, and installed-file identity anomaly. Assert generic exit codes `2` for invalid invocation/path and `3` for runtime/filesystem failure without payload or environment leakage.

- [ ] **Step 2: Confirm refusal RED**

Run: `node --import tsx --test --test-name-pattern="baseline refresh|refresh refusal" tests/ai-output-evaluator.test.mjs`

Expected: missing refresh module/behavior failures.

- [ ] **Step 3: Implement double-evaluation refresh gate**

Run the real local evaluator twice, deep-compare results and fingerprints, validate four tools plus age bands `4-6`, `7-9`, `10-12`, reject any nonpassing result, and construct canonical bytes. Load an existing valid baseline when present for the printed delta summary; permit first creation only at the canonical target.

- [ ] **Step 4: Implement canonical atomic writer**

Pin canonical repository/baseline-directory identities, create an unpredictable `wx` temporary file with mode `0600`, verify inode/link counts before and after write, fsync, revalidate parents, atomically rename, verify installed identity/single-link state, and clean temporary or unverified installed files on failure. Expose only programmatic test hooks, never CLI flags.

- [ ] **Step 5: Write failing successful-refresh tests**

Assert first creation, explicit replacement, positive/negative/add/remove summary, exact canonical target, byte-identical repeated refresh, `bytesChanged: false` for identical bytes, no writes outside the target, and no normal-evaluator mutation. Verify the package script is exactly `tsx ./scripts/update-ai-evaluation-baseline.mjs` and policy allowlists only that exact command.

- [ ] **Step 6: Confirm successful-refresh RED then GREEN**

Run the focused refresh pattern before wiring and require failure; implement CLI/package/policy wiring; rerun and require all refresh tests to pass.

- [ ] **Step 7: Run real refresh proof**

Run twice:

```powershell
pnpm run eval:ai:update-baseline
git diff --exit-code -- evals/baselines/ai-output-baseline.json
```

Expected: both commands exit `0`; the committed baseline is unchanged and byte-identical.

- [ ] **Step 8: Commit Task 2**

```powershell
git add scripts/update-ai-evaluation-baseline.mjs scripts/ai-evaluation-baseline.mjs scripts/evaluate-ai-outputs.mjs tests/ai-output-evaluator.test.mjs package.json scripts/engineering-policy.mjs
git commit -m "Add explicit AI baseline refresh"
```

---

### Task 3: Read-only regression reporting, harness wiring, and completion proof

**Files:**
- Modify: `scripts/evaluate-ai-outputs.mjs`
- Modify: `scripts/ai-evaluation-baseline.mjs`
- Modify: `tests/ai-output-evaluator.test.mjs`
- Modify: `tests/verification-wiring.test.mjs`
- Modify: `tests/engineering-harness-wiring.test.mjs`
- Modify: `AGENTS.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 comparison and Task 2 refresh command
- Extends: `formatEvaluationReport(result, { json?, baseline? }) -> string`
- Normal CLI returns `0` only when absolute evaluation and baseline comparison both pass

- [ ] **Step 1: Write failing normal-CLI regression tests**

Assert normal text reports only changed deltas plus unchanged count; JSON contains a canonical `baseline` object; negative deltas exit `1`; malformed/missing baseline exits `2`; unexpected read/runtime errors exit `3`; zero/positive deltas exit `0`; stdout/stderr do not leak environment, dataset payloads, or full baseline contents; and normal evaluation never writes the manifest.

- [ ] **Step 2: Confirm CLI RED**

Run: `node --import tsx --test --test-name-pattern="baseline CLI|delta report|read-only" tests/ai-output-evaluator.test.mjs`

Expected: normal CLI does not yet load/format/enforce the baseline.

- [ ] **Step 3: Integrate read-only comparison and reporting**

Load the baseline after dataset validation, attach comparison to the result/report without mutating the core evaluation object, emit stable text/JSON, and map validation/regression/runtime states to exit codes `2/1/3`. Preserve the existing output-report option and its link-safe repo/OS-temp behavior; it writes a report only, never the baseline.

- [ ] **Step 4: Confirm CLI GREEN and real deltas**

Run:

```powershell
node --import tsx --test tests/ai-output-evaluator.test.mjs
pnpm run eval:ai
pnpm run eval:ai -- --json
```

Expected: tests pass; both real commands exit `0`, report zero regressions, and retain all absolute thresholds/hard rules.

- [ ] **Step 5: Write failing wiring/documentation tests**

Assert `verify:local:strict` contains normal `pnpm run eval:ai` exactly once, contains no refresh command, CI contains neither direct command, `test:harness` includes evaluator tests once, policy allowlists both exact local commands, baseline surfaces are protected, and README/AGENTS document blocking negative deltas, explicit refresh, canonical target, no timestamps/providers/network/model judge, and reviewable case-set drift.

- [ ] **Step 6: Confirm wiring RED then GREEN**

Run wiring tests, update documentation/wiring only as required, and rerun:

`node --test tests/verification-wiring.test.mjs tests/engineering-harness-wiring.test.mjs`

Expected: all wiring tests pass with normal evaluator exactly once and refresh absent from CI.

- [ ] **Step 7: Run complete protected proof**

```powershell
pnpm run test:harness
pnpm run verify-change -- --base origin/main
git diff --check origin/main...HEAD
git status --short --branch
```

Expected: protected verification passes, evaluator runs exactly once, baseline comparison reports zero regressions, diff is clean, and only intended files are changed.

- [ ] **Step 8: Independent review and correction**

Have tester, reviewer, safety-reviewer, and test-isolation specialists audit schema/fingerprint completeness, regression mathematics, case-set drift, refresh refusal, filesystem containment/TOCTOU checks, read-only CI behavior, deterministic bytes, error secrecy, and cleanup. Correct all material findings and rerun Steps 4, 6, and 7.

- [ ] **Step 9: Commit Task 3**

```powershell
git add scripts/evaluate-ai-outputs.mjs scripts/ai-evaluation-baseline.mjs tests/ai-output-evaluator.test.mjs tests/verification-wiring.test.mjs tests/engineering-harness-wiring.test.mjs AGENTS.md README.md
git commit -m "Enforce AI evaluation regression deltas"
```

- [ ] **Step 10: Publish, review, merge, and prove main**

Push `agent/ai-eval-baseline-deltas`, open a focused draft PR, mark ready after local review, request Codex review, resolve all actionable threads, require PR `Full Stack` success, merge only when live protection permits, and require the post-merge `main` `Full Stack` run for the merge commit to conclude `success`.

## Completion Audit

- [ ] Every committed case/tool and the overall mean has an exact baseline and signed delta.
- [ ] Any negative delta blocks even when absolute thresholds still pass.
- [ ] Zero and positive deltas pass without mutating the baseline.
- [ ] Missing/extra/renamed cases or tools and fingerprint/threshold/schema drift fail closed.
- [ ] Normal evaluation is read-only and runs exactly once in protected verification.
- [ ] Refresh is explicit, deterministic, fully passing, canonical-target-only, atomic, and absent from CI.
- [ ] Repeated baseline generation and JSON reporting are byte-identical.
- [ ] No timestamp, provider, model judge, network request, production service, deployment, credential, or secret enters the slice.
- [ ] Record local commands/counts, baseline fingerprint, commit SHA, PR URL, PR CI URL, merge SHA, and post-merge main CI URL.
