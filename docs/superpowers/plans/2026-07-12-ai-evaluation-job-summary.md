# AI Evaluation GitHub Job Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe deterministic GitHub Actions job-summary section for the existing single AI evaluation run, showing only changed deltas, fingerprint changes, drift reasons, and an unchanged count.

**Architecture:** A focused module formats canonical bounded Markdown and appends it to GitHub's existing step-summary file through a validated handle-bound write. The evaluator calls it only in exact GitHub Actions mode after producing a valid evaluation/baseline comparison; the existing `verify-change` path remains the only evaluator invocation.

**Tech Stack:** Node.js 20 ESM, `tsx`, built-in `node:test`, GitHub Actions step summaries, pnpm 8.

## Global Constraints

- The summary is ephemeral check-run presentation only: no PR comment, uploaded artifact, result history, dashboard, repository write, timestamp, provider, network request, model judge, production service, credential, or secret.
- Normal local and non-GitHub runs perform no summary filesystem operation.
- Activation requires `GITHUB_ACTIONS` exactly `true` and a nonempty absolute `GITHUB_STEP_SUMMARY` path.
- The evaluator executes exactly once through existing `verify-change`; no direct workflow evaluator or refresh invocation is added.
- Markdown includes status, full fingerprint, absolute totals, changed case/tool/overall deltas, fingerprint/drift reasons, and unchanged count; unchanged metrics are not listed individually.
- Dynamic text is escaped and stripped of CR, LF, NUL, and HTML-shaped content; requests, outputs, paths, environment values, baseline JSON, and secrets are excluded.
- Canonical Markdown ends with one newline, is byte-identical for identical input, and fails rather than truncates above 32 KiB.
- The existing summary file must be an absolute existing single-link regular file with stable lexical/physical parent and stable device/inode/link identity before, during, and after append.
- Active summary formatting/write failure emits only `evaluation: summary error` and exits `3`; valid evaluation failure `1` and invalid baseline `2` retain precedence when no valid comparison exists.
- Existing evaluator/baseline/refresh/report/output contracts and blocking rules remain unchanged.
- Completion requires protected verification, independent specialist review, PR `Full Stack`, visual inspection of the live job summary, squash merge, and successful post-merge `main` CI summary.

---

### Task 1: Canonical Markdown formatter and safe append writer

**Files:**
- Create: `scripts/ai-evaluation-job-summary.mjs`
- Modify: `tests/ai-output-evaluator.test.mjs`
- Modify: `.agents/engineering-policy.json`

**Interfaces:**
- Produces: `formatEvaluationJobSummary({ result, baseline }) -> string`
- Produces: `appendEvaluationJobSummary({ summaryPath, markdown, testHooks? }) -> Promise<void>`
- Produces: `writeEvaluationJobSummary({ result, baseline, env?, testHooks? }) -> Promise<{ written: boolean }>`

- [ ] **Step 1: Write failing formatter tests**

Assert exact Markdown bytes for zero-change, positive-only, regression, fingerprint drift, identity drift, and mixed changes. Require lexical case/tool ordering, overall last, signed two-decimal deltas, full 64-character fingerprint, compact unchanged count, `Passed|Failed` status, exact one trailing newline, and repeated byte equality.

- [ ] **Step 2: Confirm formatter RED**

Run: `node --import tsx --test --test-name-pattern="job summary format|job summary markdown" tests/ai-output-evaluator.test.mjs`

Expected: import failure for missing `scripts/ai-evaluation-job-summary.mjs`.

- [ ] **Step 3: Implement pure canonical formatter**

Render only structured result/baseline fields. Use a single sanitizer that removes control/newline/NUL/HTML-tag-shaped content and escapes backslash, backtick, asterisk, underscore, braces, brackets, angle brackets, parentheses, hash, plus, minus, period, exclamation, and pipe in dynamic labels/reasons. Reject invalid result/baseline shapes by reusing existing validators rather than trusting arbitrary objects.

- [ ] **Step 4: Write and pass injection/size tests**

Add adversarial dynamic labels/reasons containing Markdown tables, headings, links, images, HTML, CRLF, NUL, secret-shaped values, payload-shaped JSON, and filesystem paths. Assert none render literally. Assert encoded length `32768` is accepted, `32769` is rejected, and no truncation marker exists.

- [ ] **Step 5: Write failing activation/path/writer tests**

Assert inactive behavior unless both exact environment conditions exist. For active mode cover relative/missing/directory/FIFO where supported/symlink/hard-link destinations, linked parent, lexical/physical parent mismatch, handle swap, post-write hard link, identity change, append failure, and cleanup of test fixtures. Verify existing content is preserved, exactly one section is appended, fsync occurs, and the writer never opens a non-summary path.

- [ ] **Step 6: Confirm writer RED**

Run: `node --import tsx --test --test-name-pattern="job summary activation|job summary writer|job summary path" tests/ai-output-evaluator.test.mjs`

Expected: missing writer behavior failures.

- [ ] **Step 7: Implement safe handle-bound append**

Validate the lexical parent and `realpath(parent)`, lstat the destination, open the existing file in append mode, compare handle stat to the pinned identity, write the complete bounded buffer through the handle, sync, invoke programmatic-only test hooks at defined phases, and verify identity/single-link state again. Never accept a path from CLI arguments.

- [ ] **Step 8: Protect and verify Task 1**

Add `scripts/ai-evaluation-job-summary.mjs` to protected engineering surfaces. Run:

`node --import tsx --test tests/ai-output-evaluator.test.mjs tests/engineering-policy.test.mjs`

Expected: all evaluator/policy tests pass and direct routing of the new module is `protected` with human review.

- [ ] **Step 9: Commit Task 1**

```powershell
git add scripts/ai-evaluation-job-summary.mjs tests/ai-output-evaluator.test.mjs .agents/engineering-policy.json
git commit -m "Add deterministic AI job summary"
```

---

### Task 2: Single-run evaluator integration, CI assertions, and live proof

**Files:**
- Modify: `scripts/evaluate-ai-outputs.mjs`
- Modify: `tests/ai-output-evaluator.test.mjs`
- Modify: `tests/verification-wiring.test.mjs`
- Modify: `tests/engineering-harness-wiring.test.mjs`
- Modify: `tests/engineering-policy.test.mjs`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Inspect and modify only if required: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `writeEvaluationJobSummary({ result, baseline, env?, testHooks? })`
- Extends: `runCli(args, options)` with injectable `summaryEnv`, `writeSummary`, and `summaryTestHooks` for tests only
- Preserves: normal evaluator CLI and output-report behavior

- [ ] **Step 1: Write failing evaluator-integration tests**

Assert valid GitHub mode calls the writer once with the already-computed result/comparison and evaluator invocation count remains one. Assert zero/positive/regression outcomes write correct status. Assert local/incomplete GitHub env calls writer zero times. Assert evaluation failure `1` and invalid baseline `2` return before summary writing; malformed current/runtime and active summary failures return `3` with exact generic stderr and no path/environment/payload/Markdown leakage.

- [ ] **Step 2: Confirm integration RED**

Run: `node --import tsx --test --test-name-pattern="job summary integration|job summary precedence|single evaluation" tests/ai-output-evaluator.test.mjs`

Expected: evaluator does not yet invoke the summary writer.

- [ ] **Step 3: Integrate summary after valid comparison**

Load the summary module only after current-result validation and baseline comparison exist. Call it once before ordinary stdout/report-file handling, map active summary errors to exit `3`, and keep inactive mode side-effect-free. Do not alter the baseline or output-report writers.

- [ ] **Step 4: Confirm integration GREEN and local no-op**

Run evaluator tests plus:

```powershell
pnpm run eval:ai
pnpm run eval:ai -- --json
```

Expected: tests pass; local commands remain byte-stable, exit `0`, report 17 cases/four tools/100 overall/22 unchanged/zero regressions, and create no summary file.

- [ ] **Step 5: Write failing CI/policy/documentation assertions**

Assert the workflow inherits GitHub's native summary variables without invented/remapped paths; normal evaluator appears exactly once through `verify:local:strict`; no direct evaluator/refresh step, `actions/upload-artifact`, PR-comment action/API, `pull-requests: write`, or `contents: write` exists; all summary surfaces route protected; and README/AGENTS document ephemeral changed-only job summaries, activation, 32 KiB bound, no persistence/comments/providers/network, and failure semantics.

- [ ] **Step 6: Confirm wiring RED then GREEN**

Run wiring/policy tests, update only required docs/policy/workflow lines, and rerun:

`node --test tests/verification-wiring.test.mjs tests/engineering-harness-wiring.test.mjs tests/engineering-policy.test.mjs`

Expected: all tests pass. Leave `.github/workflows/ci.yml` byte-unchanged if GitHub's native variables already flow through the existing step.

- [ ] **Step 7: Run a local simulated GitHub summary proof**

Create a disposable existing file under a canonical temporary directory, run the real evaluator with exact GitHub environment values targeting it, and assert the appended Markdown contains the fingerprint, 22 unchanged, zero regressions, no unchanged case rows, no payload/path leak, and preserves preexisting content. Remove the fixture.

- [ ] **Step 8: Run complete protected proof**

```powershell
pnpm run test:harness
pnpm run verify-change -- --base origin/main
git diff --check origin/main...HEAD
git status --short --branch
```

Expected: protected verification passes, normal evaluator runs once, summary tests pass, and only intended files change.

- [ ] **Step 9: Independent review and corrections**

Have tester, reviewer, safety-reviewer, and test-isolation specialists audit Markdown injection, size accounting, path/link/TOCTOU handling, exit precedence, secrecy, single evaluation, workflow permissions/actions, native environment assumptions, docs, and fixture cleanup. Correct every material finding and rerun Steps 4, 6, 7, and 8.

- [ ] **Step 10: Commit Task 2**

```powershell
git add scripts/evaluate-ai-outputs.mjs tests/ai-output-evaluator.test.mjs tests/verification-wiring.test.mjs tests/engineering-harness-wiring.test.mjs tests/engineering-policy.test.mjs AGENTS.md README.md .github/workflows/ci.yml
git commit -m "Publish AI deltas in CI summary"
```

- [ ] **Step 11: Publish, inspect, merge, and prove main**

Push `agent/ai-eval-job-summary`, open a draft PR, mark ready after local review, request Codex review, resolve every actionable thread, and require PR `Full Stack` success. Use the authenticated browser to inspect the live `Full Stack` run summary and confirm the AI section is visible and matches the zero-change contract. Merge only when live protection permits, then require the post-merge `main` `Full Stack` run to succeed and visually confirm its AI summary.

## Completion Audit

- [ ] PR and main `Full Stack` summaries visibly contain one AI evaluation section.
- [ ] The section shows status, full fingerprint, absolute totals, 22 unchanged, zero regressions, and no unchanged case/tool rows for the current baseline.
- [ ] Changed/adversarial tests show only changed deltas and drift reasons in stable order.
- [ ] Local and incomplete-env runs perform no summary write.
- [ ] Summary failures are generic exit `3`; evaluation `1` and baseline `2` precedence remains correct.
- [ ] Markdown injection, HTML/control characters, secrets, payloads, paths, and oversized content fail or sanitize as specified.
- [ ] The summary file is appended safely with identity/link checks and existing content preserved.
- [ ] The evaluator runs exactly once; refresh, artifacts, PR comments, and write-permission expansion are absent.
- [ ] No repository/history/dashboard/provider/network/model-judge/timestamp behavior enters the slice.
- [ ] Record test counts, fingerprint, PR/CI URLs, summary inspection evidence, merge SHA, and post-merge main CI URL.
