# AI Evaluation GitHub Job Summary Design

## Goal

Expose the deterministic AI evaluation result directly in the existing GitHub Actions `Full Stack` job summary. Reviewers should see only meaningful score or fingerprint changes, regression reasons, and a compact unchanged count without opening logs, downloading artifacts, or granting pull-request write permissions.

## Scope

This slice adds one ephemeral Markdown section to the check run that already executes `pnpm run eval:ai`. It does not add PR comments, uploaded artifacts, history storage, dashboards, provider calls, network requests, model judgment, timestamps, repository writes, or a second evaluator execution.

The committed baseline, exact negative-delta blocking, absolute thresholds, refresh command, CLI text/JSON contracts, and post-merge verification remain unchanged.

## Architecture

Add a focused module, `scripts/ai-evaluation-job-summary.mjs`, responsible for:

- converting a validated evaluation result and baseline comparison into canonical Markdown;
- validating the GitHub-provided summary destination;
- appending exactly one bounded section safely.

The normal evaluator continues to compute the result and baseline comparison once. After its ordinary report is prepared and before returning its final exit code, it optionally calls the summary module only when both conditions hold:

- `GITHUB_ACTIONS` is exactly `true`;
- `GITHUB_STEP_SUMMARY` is a nonempty absolute path.

Local runs, tests, and non-GitHub CI without both values perform no summary filesystem operation.

The existing `Verify engineering change` workflow step passes the two GitHub-provided values through to the verifier/evaluator. No new workflow step invokes `eval:ai`, and no workflow gains write permissions.

## Markdown Contract

The section has a deterministic structure:

```markdown
## AI output evaluation

**Status:** Passed
**Fingerprint:** `<full 64-character SHA-256>`
**Absolute score:** 100.00 overall; 17 cases; 4 tools
**Baseline:** 22 unchanged; 0 regressions

### Changes

No score or fingerprint changes.
```

When values change, `Changes` contains only:

- fingerprint change status;
- changed cases in lexical tool/ID order;
- changed tool means in lexical tool order;
- overall-mean change;
- identity, threshold, fingerprint, missing, or extra drift reasons.

Each numeric line contains baseline, current, and signed delta with two decimals. Unchanged cases/tools are never listed individually. Regressions use a clear failed status and retain the evaluator's exact blocking outcome.

The formatter accepts structured values only. It escapes Markdown control characters and strips carriage returns, line feeds, NULs, and HTML-shaped content from every dynamic label/reason before rendering. It never includes requests, model outputs, environment values, filesystem paths, secrets, full baseline JSON, or timestamps.

The canonical section ends with exactly one newline and is byte-identical for the same structured input.

## Size and Failure Rules

The encoded Markdown section may not exceed 32 KiB. Changed entries and drift reasons are already bounded by the committed case/tool set, but the hard limit fails closed if future data expands unexpectedly. The formatter does not truncate because silent omission could hide a regression.

The summary path must:

- be absolute;
- already exist as a regular non-symlink file;
- have exactly one hard link;
- retain the same device/inode identity immediately before and after append;
- have a real parent directory whose physical path matches its lexical path;
- remain inside the physical parent selected by GitHub for that unique step-summary file.

The writer opens the existing file for append, verifies the opened handle matches the prevalidated file identity and single-link state, appends the full Markdown bytes in one handle-bound operation, syncs, and verifies identity/link state again. Programmatic test hooks may simulate link or identity anomalies but are not exposed through CLI arguments or environment variables.

If summary formatting or writing fails while GitHub summary mode is active, the evaluator emits only `evaluation: summary error` to stderr and returns runtime exit `3`. It does not print the destination, environment, evaluation payload, or partial Markdown. Existing evaluation failure exit `1` and invalid baseline exit `2` retain precedence before summary writing when no valid comparison exists.

## Workflow Integration

The implementation must not invent or remap a path. The evaluator consumes GitHub's existing `GITHUB_ACTIONS` and `GITHUB_STEP_SUMMARY` variables inherited by the step. The workflow needs no explicit environment mapping unless current shell/process behavior strips them. Tests must prove the final workflow contains exactly one normal evaluator invocation through `verify-change`, no direct evaluator step, no refresh command, no artifact upload, no PR-comment action, and no permission expansion.

Because GitHub already supplies these variables to every step, the preferred final workflow change is documentation/assertion only if no YAML mutation is required. The implementation plan must verify this against the current workflow before editing.

## Testing

Use red-green-refactor for:

- canonical zero-change, positive-change, regression, fingerprint-drift, identity-drift, and mixed Markdown;
- lexical ordering, signed two-decimal deltas, unchanged compaction, and exact trailing newline;
- Markdown/HTML/control-character injection and secret/payload/path exclusion;
- 32 KiB boundary acceptance and overflow refusal;
- activation only with exact GitHub mode plus absolute summary path;
- absent/local mode with no filesystem calls;
- missing, relative, nonregular, symlinked, multi-link, parent-link, handle-swap, post-write-link, and identity-change rejection;
- handle-bound append, fsync, one-section append, and no overwrite of existing job-summary content;
- exact exit precedence and generic summary-error behavior;
- stable repeated formatter bytes;
- evaluator execution count exactly one;
- workflow absence of direct evaluator, refresh, artifact, PR comment, or permission changes.

Completion requires focused tests, `pnpm run test:harness`, protected `pnpm run verify-change -- --base origin/main`, independent reviewer/tester/safety/test-isolation review, PR `Full Stack`, visual inspection of the live Actions job summary, squash merge, and successful post-merge `main` CI with the summary present.

## Residual Limitations

The summary is ephemeral check-run presentation, not a durable analytics store. GitHub controls retention and display. It reports deterministic committed-case deltas only and does not measure unrepresented prompts, provider behavior, or semantic quality beyond the existing evaluator.
