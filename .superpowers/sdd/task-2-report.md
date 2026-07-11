# Task 2 RED/GREEN Report

## Scope

Implemented the task-routing CLI and Git scope resolver specified by
`.superpowers/sdd/task-2-brief.md` on `agent/engineering-harness`.

Task 2 deliverables:

- Extended `scripts/engineering-policy.mjs` with the exported
  `resolveScope({ repoRoot, base, explicitPaths })` interface.
- Added `scripts/route-task.mjs` with exported parsing, formatting, routing, and
  CLI entry functions plus an entry-point guard.
- Added `tests/route-task.test.mjs`.
- Added the `route-task` package script.

No secrets, production workflows, deployment configuration, or application
runtime behavior were changed.

## RED 1: Required Missing Module

Command:

```text
node --test tests/route-task.test.mjs
```

Result: exit 1, 0 passed and 5 failed.

Expected failure evidence:

```text
Error: Cannot find module 'C:\Users\test\kidbot\kidbot-1\scripts\route-task.mjs'
```

The failure proved that the new tests exercised the required CLI module before
it existed.

## GREEN 1: Router and Scope Resolution

Implemented the minimum behavior needed for the brief:

- Explicit paths are normalized, deduplicated, sorted, and rejected if they
  escape the repository.
- `--base` and explicit paths are mutually exclusive.
- Git mode combines `<base>...HEAD`, staged, and unstaged name-only diffs.
- Deleted paths are retained because resolution does not require files to exist.
- Git failures and empty implicit scopes fail closed.
- Existing `loadEngineeringPolicy` and `classifyPaths` interfaces perform policy
  loading, precedence, command selection, and human-review selection.
- JSON field order and array order are deterministic.
- Invalid arguments/paths return exit 2; unresolved scope and policy failures
  return exit 3.

Command:

```text
node --test tests/engineering-policy.test.mjs tests/route-task.test.mjs
```

Initial GREEN result: exit 0, 14 passed and 0 failed.

## RED 2: Documented pnpm Invocation

A package-level smoke using the brief's documented invocation exposed that pnpm
8 on Windows forwards the separator as a literal argument:

```text
pnpm run route-task -- --json scripts/engineering-policy.mjs scripts/route-task.mjs tests/route-task.test.mjs package.json
```

Result: exit 2 with `unknown option: --`.

Added the focused regression test `accepts the pnpm argument separator before
options`, then ran:

```text
node --test --test-name-pattern="pnpm argument separator" tests/route-task.test.mjs
```

RED result: exit 1, 1 failed and 5 skipped, with the expected `unknown option:
--` failure.

## GREEN 2: pnpm Separator Compatibility

The parser now ignores exactly one leading pnpm separator while retaining
unknown-option rejection elsewhere.

Command:

```text
node --test tests/engineering-policy.test.mjs tests/route-task.test.mjs
```

Result: exit 0, 15 passed and 0 failed.

The documented package command then exited 0 and returned stable JSON with:

- classification: `protected`
- normalized paths: `package.json`, the two router scripts, and the router test
- matched rule ids: `protected-engineering-surfaces`,
  `standard-repository-content`
- commands: `pnpm run verify:local`
- human review: required

## Required Behavior Coverage

- Explicit protected scope and verification/human-review selection.
- Explicit review-only scope and readable output.
- Stable JSON output and stable matched-rule ordering.
- Invalid/unknown options and missing `--base` value.
- Repository-external explicit paths.
- Rejection of simultaneous `--base` and explicit paths.
- Missing Git base returns exit 3.
- Empty implicit Git scope returns exit 3.
- Temporary Git repository with a committed base plus committed comparison,
  staged, unstaged, and deleted paths.
- Deduplicated, sorted Git output.
- pnpm's documented leading separator behavior.

## Full Verification

The router classified the Task 2 files as protected because `package.json` is in
scope, selecting the repository's required secret-free command:

```text
pnpm run verify:local
```

Result: exit 0 in 38 seconds.

Observed verification included lint, typecheck, workspace tests, 49 passing root
tests, 3 passing MCP compatibility tests, provider preflight, and secured-posture
smoke. One web-widget test process printed the pre-existing warning `WebSocket
server error: Port is already in use`, but the authoritative command still
completed successfully with exit 0.

## Residual Risk

The Git resolver intentionally includes only committed comparison, staged, and
unstaged tracked paths, matching the brief. Untracked files are not included.
Policy and `package.json` changes are classified as protected and require human
review before integration.
