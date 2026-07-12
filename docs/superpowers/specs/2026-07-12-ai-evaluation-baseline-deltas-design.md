# AI Evaluation Baseline Deltas Design

## Goal

Add a committed, deterministic score baseline for Kidbot's existing no-provider AI output evaluator. Normal local and CI evaluation must fail on any score regression even when the existing absolute thresholds still pass. A separate explicit local command regenerates the baseline after an intentional, fully passing evaluation change.

## Scope

This slice covers the four existing tools, their committed cases, and the current contract, safety, completeness, and age-proxy scores. It does not add provider calls, a model judge, timestamps, dashboards, remote storage, deployment behavior, or an append-only result archive. Existing case minimum `85`, tool mean `90`, overall mean `90`, and contract/safety hard-failure rules remain unchanged and independently enforced.

## Architecture

Commit one canonical manifest at `evals/baselines/ai-output-baseline.json`. It contains:

- schema version;
- deterministic evaluator/corpus fingerprint;
- sorted case records with `id`, `tool`, `ageBand`, and integer score;
- sorted tool records with two-decimal means;
- two-decimal overall mean;
- the existing absolute thresholds.

No timestamp or environment-derived value is allowed. Rebuilding an unchanged baseline must produce byte-identical JSON.

The evaluator gains three isolated responsibilities:

1. Strict baseline loading and validation.
2. Pure comparison of current evaluation results against a validated baseline.
3. Canonical baseline construction and refresh.

Normal `pnpm run eval:ai` remains read-only. After the real local evaluation passes its absolute thresholds, it loads the committed baseline, compares the current result, includes a stable delta section in text and JSON output, and exits nonzero for any regression or baseline-integrity failure.

`pnpm run eval:ai:update-baseline` runs the same secret-free real local evaluation and writes only the canonical baseline path. It never changes thresholds or other files.

## Comparison Rules

The comparison blocks when any of these conditions is true:

- a current case score is lower than its baseline score;
- a current tool mean is lower than its baseline mean;
- the current overall mean is lower than its baseline mean;
- a baseline case or tool is missing from the current result;
- a current case or tool is absent from the baseline;
- identity fields for a case change;
- thresholds in the baseline differ from the evaluator's current thresholds;
- the baseline fingerprint, schema, ordering, keys, number formats, or canonical bytes are invalid;
- the current evaluation has a hard failure or fails an absolute threshold.

Score increases are allowed by normal evaluation and reported as positive deltas. They do not silently update the baseline. This preserves an explicit reviewable baseline-refresh step.

All comparisons use exact integer case scores and exact two-decimal normalized means. There are no tolerance bands.

## Fingerprint

The fingerprint is a stable SHA-256 digest of the canonical inputs that define the evaluation contract:

- the four validated dataset documents in canonical tool/file order;
- scoring weights and absolute thresholds;
- approved check IDs and their category mapping;
- baseline schema version.

It excludes timestamps, filesystem paths, environment variables, generated reports, and runtime ordering. A fingerprint mismatch fails normal evaluation and requires an explicit baseline refresh. The fingerprint detects corpus or scoring-contract drift even when numeric scores happen to remain unchanged.

## Baseline Refresh Safety

Refresh is rejected unless:

- the real current evaluation passes every hard rule and absolute threshold;
- all four tools, all required age bands, and the committed case set are present;
- the datasets and result are deterministic across two executions;
- the target is exactly `evals/baselines/ai-output-baseline.json` under the canonical repository root;
- the baseline directory and target pass physical containment, regular-file, symlink, hard-link, and identity checks.

The writer uses an exclusive unpredictable temporary file in the canonical baseline directory, writes canonical bytes, verifies file and directory identity, fsyncs, atomically replaces the target, revalidates the installed inode/link count, and cleans failed temporary or installed files. CI never invokes refresh.

Refresh prints a stable summary of additions, removals, increases, decreases, fingerprint changes, and the written path. It may replace a previous baseline only when the new evaluation is fully passing. Because case-set changes require refresh, the summary makes those changes reviewable in the Git diff.

## CLI and Reporting

Normal text output keeps the existing case/tool/overall report and adds only changed deltas plus a compact unchanged count. JSON output adds a stable `baseline` object containing validation state, fingerprint, per-case/tool/overall deltas, unchanged count, regression reasons, and pass status.

Exit behavior:

- `0`: absolute evaluation and baseline comparison pass;
- `1`: current evaluation or regression gate fails;
- `2`: invalid arguments, baseline schema/path, or refresh request;
- `3`: unexpected runtime or filesystem failure.

Errors remain generic and must not print environment values, dataset payloads, or report contents.

The refresh command is a separate package script rather than a public normal-evaluation flag. Internally it may call a dedicated entrypoint or a private mode, but normal `eval:ai` must not expose a write option that updates the canonical baseline.

## Harness and Policy Wiring

`verify:local:strict` continues to invoke `pnpm run eval:ai` exactly once. No additional direct CI evaluator or refresh step is added. The refresh command is allowlisted only for explicit local engineering use and is never selected by `verify-change`.

Protect the baseline manifest, loader/comparison/refresh implementation, evaluator tests, package wiring, and policy allowlist. Documentation explains the blocking rule, explicit refresh workflow, canonical snapshot, and absence of model/provider/network behavior.

## Testing

Use red-green-refactor with focused tests for:

- strict canonical baseline loading and fail-closed malformed, extra-key, ordering, numeric, fingerprint, missing/extra case/tool, threshold, symlink, hard-link, and containment cases;
- exact case, tool, and overall negative-delta blocking, including regressions that remain above absolute thresholds;
- allowed positive and zero deltas;
- deterministic ordering and byte-identical JSON/report output;
- fingerprint stability and drift detection;
- refresh refusal for hard failures, threshold failures, incomplete coverage, nondeterminism, unsafe paths, and link anomalies;
- byte-identical repeated refresh and atomic replacement of the one canonical target;
- generic exit-code/error behavior without payload or environment leakage;
- package, policy, documentation, and CI wiring that keeps normal evaluation exactly once and refresh absent from CI.

Completion requires focused evaluator/wiring tests, `pnpm run test:harness`, protected `pnpm run verify-change -- --base origin/main`, independent tester/reviewer/security/test-isolation review, PR `Full Stack`, merge, and successful post-merge `main` CI.

## Residual Limitations

The baseline records deterministic proxy scores, not human or model judgment. It detects regression relative to committed cases and checks only; it does not measure unrepresented prompts, semantic quality outside deterministic rules, production-provider behavior, or long-term trends. Append-only history and dashboards remain future slices with a real reporting consumer.
