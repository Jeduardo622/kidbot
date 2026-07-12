# Advisory Specialist Routing Design

## Objective

Extend the engineering harness with repository-owned specialist definitions and deterministic advisory routing. The harness will recommend relevant engineering specialists from the resolved change scope without spawning agents, granting approval, or adding a new merge requirement.

## Scope

This slice adds five specialist definitions:

- `reviewer`
- `tester`
- `ui-hardener`
- `safety-reviewer`
- `test-isolation`

It adds specialist recommendations to task routing, verifier output, and CI logs. It does not change application runtime behavior, production workflows, secrets, deployments, branch protection, or the existing risk classification and verification commands.

## Architecture

The capability has three repository-owned layers:

1. `.agents/specialists.json` is the validated routing registry. It maps each specialist ID to an instruction file and one or more routing signals.
2. `.agents/specialists/*.md` contains the specialist operating contract, review focus, expected evidence, and stop conditions.
3. The existing engineering-policy library loads and validates the registry, selects specialists from normalized resolved paths and the final risk classification, and returns deterministic recommendations to both CLIs.

The registry is data, not executable code. Routing remains in the shared JavaScript library so `route-task` and `verify-change` consume the same result without parsing formatted output.

## Registry Model

The registry contains a positive integer `version` and a non-empty `specialists` array. Each specialist contains exactly:

- `id`: unique kebab-case identifier;
- `instructions`: repository-relative path under `.agents/specialists/` ending in `.md`;
- `description`: non-empty single-line summary;
- `classifications`: zero or more exact values from `review-only`, `standard`, and `protected`;
- `patterns`: zero or more anchored POSIX repository glob patterns.

Each specialist must define at least one classification or path pattern. Instruction files must exist, be regular files, and remain inside `.agents/specialists/`. Unknown keys, duplicate IDs, duplicate instruction paths, invalid patterns, missing files, repository escapes, and empty routing signals fail closed.

## Selection Rules

The initial registry encodes these rules:

- `reviewer`: every protected change;
- `tester`: source, test, build, or verification changes;
- `ui-hardener`: web-widget UI, component, style, and browser-facing changes;
- `safety-reviewer`: authentication, moderation, guardrail, schema, storage, permission, tenant, production-boundary, or safety-sensitive changes;
- `test-isolation`: tests, fixtures, test configuration, and CI test wiring.

A specialist is selected when either its classification signal or any path pattern matches. Mixed scopes produce the sorted union without duplicates. Each recommendation contains:

- `id`;
- `description`;
- `instructions`;
- `reasons`, as a sorted non-empty array of stable strings identifying the matching classification or paths.

The registry determines selection; no specialist is implicit outside it. Editing the registry or specialist instructions remains protected through the existing immutable `.agents/**` governance boundary.

## CLI and CI Behavior

`route-task` adds `specialists` to JSON output and prints a readable specialist summary in text mode. `verify-change` includes the same immutable recommendations in its report and prints them before running commands.

CI continues to run the router and verifier exactly as it does today. The route report stored under `$RUNNER_TEMP` includes specialist recommendations, so they appear in logs as evidence. CI does not spawn agents, execute specialist prompts, require specialist-produced artifacts, or interpret recommendations as review or deployment authorization.

No specialist recommendation changes `classification`, `commands`, `requiresHumanReview`, exit codes, or branch protection.

## Specialist Contracts

Each Markdown definition states:

- when to use the specialist;
- the bounded review or verification focus;
- required inputs;
- required evidence in its report;
- explicit stop and escalation conditions;
- prohibited actions, including self-approval, secret access, deployment, and scope expansion.

The contracts are concise repository instructions rather than provider-specific agent configuration. They can be consumed by Codex or another engineering agent without coupling the repository to one orchestration API.

## Error Handling

Specialist registry loading is fail-closed. Router and verifier invocations return the existing unresolved-scope error class when the registry cannot be read or validated. Errors identify the invalid field or instruction path without printing environment values or file contents.

A valid registry that selects no specialists is allowed and returns an empty array. This preserves useful routing for documentation-only or otherwise unmatched work.

## Testing Strategy

Node tests will prove:

- exact registry schema validation and instruction-file containment;
- missing, malformed, duplicate, and repository-external definitions fail closed;
- each of the five specialists is selected by its intended signals;
- unrelated and documentation-only changes do not receive accidental specialists;
- mixed scopes return a deterministic deduplicated union with stable reasons;
- router JSON and text output include recommendations;
- verifier reports the same recommendations without allowing callback mutation;
- package and CI wiring retain advisory-only behavior and do not spawn specialists;
- existing classification, verification, secret, and production-workflow boundaries remain unchanged.

Temporary repositories will include their own policy, registry, and instruction fixtures so tests do not depend on the checkout branch or ignored build artifacts.

## Deliverables

- `.agents/specialists.json`
- `.agents/specialists/reviewer.md`
- `.agents/specialists/tester.md`
- `.agents/specialists/ui-hardener.md`
- `.agents/specialists/safety-reviewer.md`
- `.agents/specialists/test-isolation.md`
- shared registry validation and selection in `scripts/engineering-policy.mjs`
- specialist output in `scripts/route-task.mjs` and `scripts/verify-change.mjs`
- focused registry, routing, verifier, and wiring tests
- README and `AGENTS.md` usage guidance

## Acceptance Criteria

- Every valid routed scope returns a deterministic `specialists` array.
- All five specialists are repository-owned and have tested routing signals.
- Registry failures are nonzero and fail closed.
- Router and verifier recommendations are identical for the same scope.
- Recommendations cannot change verification commands or count as approval.
- CI exposes recommendations in logs but never spawns specialists.
- `pnpm run test:harness`, protected `pnpm run verify-change`, and live `Full Stack` CI pass.
- The implementation is published as a focused pull request and the post-merge `main` run is green.

## Deferred Work

- Mandatory specialist evidence or merge gates.
- Automatic subagent spawning in CI.
- Provider-specific agent manifests.
- AI-output evaluation datasets and scoring.
- Production or secret-dependent specialist workflows.
