# Engineering Agent Harness Design

## Objective

Create a repository-owned, executable, and CI-enforced engineering harness that classifies change risk before implementation and verifies changes in proportion to that risk. The harness must be deterministic, fail closed when scope is ambiguous, require no production secrets, and preserve the existing manual production-smoke boundaries.

## Current Problem

Kidbot has a strong application verification command, but it does not have versioned engineering-agent governance. The root `AGENTS.md` contains agent-service product documentation rather than repository operating rules. There is no executable task router, no changed-scope verifier, and no CI gate connecting protected-path classification to required verification.

## Architecture

The harness has four small, versioned units:

1. `.agents/engineering-policy.json` owns path rules and verification commands.
2. `scripts/route-task.mjs` resolves changed paths and returns a risk classification.
3. `scripts/verify-change.mjs` consumes that classification and runs the required verification commands.
4. `AGENTS.md` explains the human- and agent-facing workflow and stop conditions.

The scripts remain orchestration-only. They do not duplicate lint, typecheck, test, or smoke implementation; they invoke existing package commands.

## Policy Model

The policy file defines:

- protected path patterns for authentication, authorization, secrets, runtime configuration, server and API boundaries, deployment, CI workflows, schemas and migrations, production data, and permission-sensitive logic;
- review-only documentation patterns;
- the full verification command, `pnpm run verify:local`;
- focused verification commands for standard and review-only changes;
- paths that always require human review even after verification.

Classification precedence is `protected` over `standard` over `review-only`. A mixed change receives the highest applicable classification. Unknown application paths default to `standard`; invalid, unreadable, empty-without-explicit-scope, or repository-external paths fail closed.

## Task Router

`pnpm run route-task` supports two deterministic input modes:

- explicit paths after `--`; or
- Git changes resolved from `--base <ref>` to the current working tree and index.

The command emits a readable summary by default and JSON with `--json`. Its result includes classification, normalized paths, matched policy rules, required verification commands, and human-review requirements. It performs no writes and reads no secrets.

Exit codes are:

- `0`: classification completed;
- `2`: invalid arguments or paths;
- `3`: scope could not be resolved safely.

## Change Verifier

`pnpm run verify-change` accepts the same explicit-path or `--base` scope. It invokes the router as a library rather than parsing formatted terminal output.

Behavior by classification:

- `review-only`: run policy and wiring tests only;
- `standard`: run lint, typecheck, package/root tests, and relevant contract tests;
- `protected`: run the fail-closed `pnpm run verify:local` gate plus policy and wiring tests.

The verifier reports every command, exit status, classification, and remaining human-review requirement. It stops at the first failed command and propagates failure. It must not interpret passing verification as authorization to deploy, merge, access secrets, or modify production systems.

## CI Enforcement

The pull-request workflow runs:

1. `pnpm run route-task -- --base origin/${{ github.base_ref }} --json` and stores the classification summary in logs.
2. `pnpm run verify-change -- --base origin/${{ github.base_ref }}`.

CI fetches sufficient Git history to resolve the base ref. The harness uses only repository state and secret-free commands. Existing manual production workflows remain separate and unchanged.

Pushes to `main` run verification against the event's before SHA when available. A zero or unavailable before SHA fails closed instead of silently skipping classification.

## Repository Instructions

The new root `AGENTS.md` will require agents to:

- read repository instructions first;
- run `route-task` before implementation;
- stop on unresolved scope;
- keep protected changes tightly bounded;
- run `verify-change` before finalization;
- report executed, skipped, blocked, and secret-dependent checks separately;
- avoid deployment, production mutation, or secret access unless explicitly authorized.

The existing agent-service description remains at `apps/agent-service/AGENT.md`; no application behavior changes are part of this slice.

## Testing Strategy

Node test coverage will prove:

- protected, standard, review-only, mixed, invalid, and external-path classification;
- explicit-path and Git-base scope resolution;
- deterministic JSON output and exit codes;
- protected verification escalation;
- fail-closed missing-base and empty-scope behavior;
- command failure propagation;
- package-script and CI wiring;
- policy schema validation;
- `AGENTS.md` contains the executable workflow and the service documentation remains in its owned location.

Tests use temporary Git repositories where changed-scope behavior must be exercised. They do not invoke production services or read real secrets.

## Error Handling and Safety

- Policy parse or schema errors stop classification.
- Paths are normalized to repository-relative POSIX form before matching.
- Paths escaping the repository are rejected.
- Git resolution errors include the attempted base ref without exposing environment data.
- Spawned verification commands inherit only the current process environment and never print environment values.
- Production workflows, credentials, deployments, and application runtime behavior are out of scope.

## Deliverables

- `.agents/engineering-policy.json`
- `scripts/engineering-policy.mjs`
- `scripts/route-task.mjs`
- `scripts/verify-change.mjs`
- root `AGENTS.md` rewritten as repository engineering instructions
- package scripts for `route-task` and `verify-change`
- CI enforcement in `.github/workflows/ci.yml`
- regression tests for routing, verification, policy, instructions, and wiring
- README usage documentation

## Acceptance Criteria

- Every supported scope produces one deterministic classification or a nonzero fail-closed result.
- Protected paths always select `pnpm run verify:local` and require human review.
- CI executes the router and verifier for pull requests and pushes to `main`.
- No harness path reads production secrets or invokes manual production workflows.
- All new tests pass and `pnpm run verify:local` passes.
- The change is published as a focused draft pull request with green CI.

## Deferred Work

- Specialist agent definitions for reviewer, tester, UI hardening, safety, or test isolation.
- AI output evaluation datasets and scoring.
- Automated merge, deployment, or production approval.
- Provider-backed or secret-dependent verification.
