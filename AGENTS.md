# Repository engineering instructions

## Before implementation

1. Read this file and all narrower repository instructions that apply to the files in scope. Service-specific documentation remains with the owning service, such as `apps/agent-service/AGENT.md`.
2. Inspect the requested paths and current Git state. Run `pnpm run route-task -- <paths> --json` or `pnpm run route-task -- --base <git-ref> --json` before implementation.
3. Stop on unresolved scope. Invalid, external, empty, unreadable-policy, and unresolved-Git scopes fail closed; do not guess or broaden the task.

Classification precedence is `protected` over `standard` over `review-only`. Protected work includes authentication, authorization, runtime configuration, API/server boundaries, deployment, CI, schemas, migrations, secrets, and tenant- or permission-sensitive behavior.

## Making changes

- Keep the diff minimal, reversible, and inside the routed scope.
- Protected changes require explicit containment: list affected files and risks, avoid broad changes, and stop if the work cannot remain contained.
- Preserve existing application behavior and production workflows unless the task explicitly changes them.
- Never invent credentials, configuration, APIs, or product behavior. Never invoke manual production workflows as part of this secret-free harness.
- Use test-driven development for behavior changes: establish a relevant failing test, implement the smallest fix, then rerun it.

## Verification and completion

Run `pnpm run verify-change -- --base <git-ref>` (or with explicit paths) before finalization. Protected changes select `pnpm run verify:local` and require human review; automation must not bypass that review requirement.

Standard changes run the exact secret-free sequence: lint, typecheck, package and root tests through `pnpm test`, then MCP compatibility. CI relies on this selection and must not repeat those broad suites after `verify-change`.

Report verification in separate categories: executed, skipped, blocked, and secret-dependent. Include exact commands and outcomes, never describe an unexecuted check as passing, and identify residual risk or the next unblock step.
