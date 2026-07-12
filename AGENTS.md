# Repository engineering instructions

## Before implementation

1. Read this file and all narrower repository instructions that apply to the files in scope. Service-specific documentation remains with the owning service, such as `apps/agent-service/AGENT.md`.
2. Inspect the requested paths and current Git state. Run `pnpm run route-task -- <paths> --json` or `pnpm run route-task -- --base <git-ref> --json` before implementation.
3. Stop on unresolved scope. Invalid, external, empty, unreadable-policy, and unresolved-Git scopes fail closed; do not guess or broaden the task.

Classification precedence is `protected` over `standard` over `review-only`. Protected work includes authentication, authorization, runtime configuration, API/server boundaries, deployment, CI, schemas, migrations, secrets, and tenant- or permission-sensitive behavior.

Specialist recommendations from the router are advisory. They do not spawn agents or execute specialist instructions, and they do not count as approval. Engineers may follow a recommended contract manually or dispatch a matching specialist only in an authorized interactive session; CI only logs the recommendations.

## Making changes

- Keep the diff minimal, reversible, and inside the routed scope.
- Protected changes require explicit containment: list affected files and risks, avoid broad changes, and stop if the work cannot remain contained.
- Preserve existing application behavior and production workflows unless the task explicitly changes them.
- Never invent credentials, configuration, APIs, or product behavior. Never invoke manual production workflows as part of this secret-free harness.
- Use test-driven development for behavior changes: establish a relevant failing test, implement the smallest fix, then rerun it.

## Verification and completion

Run `pnpm run verify-change -- --base <git-ref>` (or with explicit paths) before finalization. Protected changes select `pnpm run verify:local` and require human review; automation must not bypass that review requirement.

Standard changes run the exact secret-free sequence: lint, typecheck, package and root tests through `pnpm test`, then MCP compatibility. CI relies on this selection and must not repeat those broad suites after `verify-change`.

Review-only changes receive the full `verify:local` CI baseline through a fail-closed, parsed router classification. Standard and protected changes do not repeat this fallback because their selected verification already supplies the broad baseline.

Review-only local verification runs `pnpm run test:harness`. Existing explicit directories are expanded to tracked and nonignored untracked files; Git-derived scope also includes nonignored untracked files. Route a planned new file through its existing containing directory.

Unmatched application extensions receive the internal `default-standard` classification. Do not add catch-all standard policy patterns that would upgrade files explicitly covered as review-only.

The human-review flag and CODEOWNERS entries provide evidence and ownership routing only. GitHub branch protection must require code-owner review to enforce approval; no repository script may self-approve or treat its own output as approval.

Report verification in separate categories: executed, skipped, blocked, and secret-dependent. Include exact commands and outcomes, never describe an unexecuted check as passing, and identify residual risk or the next unblock step.

## Deterministic AI output evaluation

Run `pnpm run eval:ai` for text or `pnpm run eval:ai -- --json` for pure stable JSON. This is a no-provider evaluation: it uses local agent functions without credentials, network calls, or a model judge. Each case must score at least 85, each tool mean at least 90, and the overall mean at least 90; any contract or safety failure is a hard failure. The `age-proxy` check is only a deterministic proxy for output length and word complexity, not a developmental or semantic assessment. Reports are written only with explicit `--output <path>` selecting a direct child file in the canonical repository root or operating-system temporary directory; nested destinations, lexical escapes, symlinks, hard links, and junctions are rejected. The writer captures the selected root's `dev`/`ino` identity and rechecks it before temporary-file open, after temporary open and write, immediately before rename, and after rename; temporary and destination identity/link counts are also checked around installation. An already-authorized malicious local actor racing after the final check is outside the no-secret report threat model.
