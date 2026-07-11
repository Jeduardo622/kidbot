# Task 1 report: policy schema and deterministic classification library

## Status

Implemented the exact Task 1 scope on `agent/engineering-harness`. No application runtime or existing production workflow files were changed.

## Route-task classification

No repository `route-task` helper was available. Classified manually as narrowly scoped protected-path work because the new policy governs workflows, auth, and configuration. Human review and `pnpm run verify:local` are mandatory for protected results.

## RED evidence

Command:

```text
node --test tests/engineering-policy.test.mjs
```

Observed exit code `1`. Node raised `ERR_MODULE_NOT_FOUND` for `scripts/engineering-policy.mjs`; 0 tests passed and 1 test-file failure was reported. This was the expected failure because the required module did not exist.

## GREEN evidence

Focused command:

```text
node --test tests/engineering-policy.test.mjs
```

Observed exit code `0`: 8 tests passed, 0 failed.

Repository root command:

```text
pnpm run test:root
```

Observed exit code `0`: 42 tests passed, 0 failed.

Authoritative protected-path gate:

```text
pnpm run verify:local
```

Observed exit code `0`. The gate completed lint, typecheck, workspace/root tests, MCP compatibility tests, provider preflight, and secured-posture smoke.

An exploratory direct `node --test` invocation across every root test file reported 39 passes and 1 failure because plain Node cannot import the existing TSX smoke module. The repository-supported `pnpm run test:root` command registers TSX correctly and passed all 42 tests.

## Files

- `.agents/engineering-policy.json`: versioned policy rules and verification command selection.
- `scripts/engineering-policy.mjs`: built-in-Node loader, strict schema validation, anchored glob conversion, repository-bound POSIX normalization, deterministic classification, precedence, command selection, and fail-closed errors.
- `tests/engineering-policy.test.mjs`: required protected/review-only/standard/mixed/normalization/escape/empty/malformed cases.
- `.superpowers/sdd/task-1-report.md`: this report.

## Self-review

- Policy top-level, rule, and verification keys are exact and every field is type/content validated.
- Pattern conversion is anchored and rejects absolute, backslash, and parent-traversal patterns.
- Input paths are deduplicated, sorted, normalized to repository-relative POSIX form, and rejected when external or non-file scope roots.
- Classification precedence is protected over standard over review-only at both per-path and aggregate levels.
- Protected classification always returns `pnpm run verify:local` and requires human review, independent of rule flag drift.
- Policy and classifier use only built-in Node APIs and never read environment variables, secrets, or production workflow commands.
- Diff is limited to Task 1 deliverables and this required report.

## Concerns

- `classifyPaths` intentionally fails closed for extensions not represented by the current policy. Later scope-resolution tasks should translate Git results into concrete paths and surface unresolved Git revisions before calling this library.
- `pnpm run verify:local` emitted an existing non-fatal web-widget message that a WebSocket port was already in use; all web-widget tests and the full gate still exited successfully.
