# Engineering Agent Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repository-owned, executable, and CI-enforced task-classification and change-verification harness for Kidbot engineering work.

**Architecture:** A JSON policy is validated and consumed by a shared JavaScript module. Thin CLI entry points classify explicit or Git-derived scopes and execute the policy-selected verification commands; repository instructions and CI invoke those same interfaces.

**Tech Stack:** Node.js 20 ESM, built-in `node:test`, Git CLI, pnpm 8, GitHub Actions YAML.

## Global Constraints

- Classification precedence is `protected` over `standard` over `review-only`.
- Invalid, repository-external, empty-without-explicit-scope, unreadable-policy, and unresolved-Git scopes fail closed.
- Protected changes always select `pnpm run verify:local` and require human review.
- Harness commands must not read or print secrets and must not invoke manual production workflows.
- Existing production workflows and application runtime behavior remain unchanged.
- All implementation follows red-green-refactor and ends with `pnpm run verify:local` plus live CI proof.

---

### Task 1: Policy schema and deterministic classification library

**Files:**
- Create: `.agents/engineering-policy.json`
- Create: `scripts/engineering-policy.mjs`
- Create: `tests/engineering-policy.test.mjs`

**Interfaces:**
- Produces: `loadEngineeringPolicy({ repoRoot, policyPath? }) -> policy`
- Produces: `classifyPaths({ repoRoot, paths, policy }) -> classification result`
- Result fields: `classification`, `paths`, `matches`, `commands`, `requiresHumanReview`

- [ ] **Step 1: Write failing policy/classification tests**

Cover protected workflow/auth/config paths, review-only Markdown, standard source, mixed precedence, POSIX normalization, path escape rejection, empty scope, and malformed policy. Assert protected results include `pnpm run verify:local` and human review.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/engineering-policy.test.mjs`

Expected: module-not-found failure for `scripts/engineering-policy.mjs`.

- [ ] **Step 3: Add the policy file**

Define JSON keys `version`, `rules`, and `verification`. Each rule has `id`, `classification`, `patterns`, and `requiresHumanReview`. Verification has command arrays keyed by `review-only`, `standard`, and `protected`.

- [ ] **Step 4: Implement policy loading and classification**

Use `readFile`, `path.resolve`, `path.relative`, and deterministic sorted output. Validate every policy field explicitly without adding a runtime dependency. Match normalized repository-relative paths against anchored glob-like rules converted to regular expressions.

- [ ] **Step 5: Confirm GREEN and commit**

Run: `node --test tests/engineering-policy.test.mjs`

Expected: all policy and classification cases pass.

Commit: `Add engineering policy classifier`

---

### Task 2: Task-routing CLI and Git scope resolution

**Files:**
- Modify: `scripts/engineering-policy.mjs`
- Create: `scripts/route-task.mjs`
- Create: `tests/route-task.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `resolveScope({ repoRoot, base, explicitPaths }) -> string[]`
- CLI: `pnpm run route-task -- [--base <ref>] [--json] [paths...]`
- Exit codes: `0` classified, `2` invalid arguments/paths, `3` unresolved scope

- [ ] **Step 1: Write failing CLI tests**

Exercise explicit protected and review-only scopes, stable JSON, invalid options, repository-external paths, missing base refs, empty implicit scope, and a temporary Git repository with committed-base plus working-tree changes.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/route-task.test.mjs`

Expected: CLI/module-not-found failure for `scripts/route-task.mjs`.

- [ ] **Step 3: Implement Git and argument resolution**

Parse arguments without dependencies. Reject simultaneous `--base` and explicit paths. Resolve Git scope using `git diff --name-only --relative <base>...HEAD` plus staged and unstaged paths, deduplicate, normalize, and sort.

- [ ] **Step 4: Implement readable and JSON CLI output**

Export the callable functions and guard CLI execution with an `import.meta.url` entry-point check. Print only repository-relative paths, rule ids, classification, commands, and human-review status.

- [ ] **Step 5: Wire the package command, confirm GREEN, and commit**

Add: `"route-task": "node ./scripts/route-task.mjs"`.

Run: `node --test tests/engineering-policy.test.mjs tests/route-task.test.mjs`

Expected: all classifier and router tests pass.

Commit: `Add engineering task router`

---

### Task 3: Risk-proportional change verifier

**Files:**
- Create: `scripts/verify-change.mjs`
- Create: `tests/verify-change.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `resolveScope`, `loadEngineeringPolicy`, `classifyPaths`
- Produces: `verifyChange({ repoRoot, base, explicitPaths, runCommand? }) -> report`
- CLI: `pnpm run verify-change -- [--base <ref>] [paths...]`

- [ ] **Step 1: Write failing verifier tests**

Inject a command runner and assert command selection for all classifications, protected escalation to `pnpm run verify:local`, first-failure propagation, human-review reporting, missing-scope failure, and absence of production commands or environment logging.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/verify-change.test.mjs`

Expected: module-not-found failure for `scripts/verify-change.mjs`.

- [ ] **Step 3: Implement verification orchestration**

Reuse router/library outputs. Execute policy commands sequentially with `spawnSync`, `shell: true`, inherited stdio, and inherited environment without printing values. Stop on the first nonzero result and return its status.

- [ ] **Step 4: Wire the package command and confirm GREEN**

Add: `"verify-change": "node ./scripts/verify-change.mjs"`.

Run: `node --test tests/engineering-policy.test.mjs tests/route-task.test.mjs tests/verify-change.test.mjs`

Expected: all harness behavior tests pass.

- [ ] **Step 5: Run real explicit-scope checks and commit**

Run:

```powershell
pnpm run route-task -- --json .github/workflows/ci.yml
pnpm run route-task -- --json README.md
pnpm run verify-change -- README.md
```

Expected: workflow is protected, README is review-only, and review-only verification succeeds.

Commit: `Add risk-proportional change verifier`

---

### Task 4: Repository instructions, CI enforcement, and completion proof

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml`
- Create: `tests/engineering-harness-wiring.test.mjs`

**Interfaces:**
- CI PR scope: `origin/${{ github.base_ref }}`
- CI main-push scope: `${{ github.event.before }}`
- Required package commands: `route-task`, `verify-change`, `verify:local`

- [ ] **Step 1: Write failing wiring and instruction tests**

Assert `AGENTS.md` requires route-before-edit, protected containment, verify-before-finalize, and separated verification reporting. Assert package scripts exist, CI fetches full history, CI runs both harness commands for PR and main-push bases, and manual production workflows are not invoked.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/engineering-harness-wiring.test.mjs`

Expected: failures for missing instructions and CI steps.

- [ ] **Step 3: Rewrite root instructions and document usage**

Replace root `AGENTS.md` with repository engineering operations. Preserve service documentation at `apps/agent-service/AGENT.md`. Add README examples for explicit and Git-base classification and verification.

- [ ] **Step 4: Add CI enforcement**

Set checkout `fetch-depth: 0`. Add a scope-resolution step that chooses the PR base ref or nonzero push-before SHA, then run `route-task --json` and `verify-change` against that base. Fail when no safe base exists.

- [ ] **Step 5: Confirm wiring GREEN**

Run: `node --test tests/engineering-harness-wiring.test.mjs tests/verification-wiring.test.mjs`

Expected: all wiring tests pass.

- [ ] **Step 6: Run the complete local proof**

Run:

```powershell
pnpm run route-task -- --base main --json
pnpm run verify-change -- --base main
pnpm run verify:local
git diff --check
```

Expected: current harness change classifies protected, all selected commands exit zero, full local verification exits zero, and the diff check is clean.

- [ ] **Step 7: Independent review and corrections**

Have a tester audit acceptance-criterion coverage and a reviewer inspect policy bypasses, path normalization, Git semantics, command execution, CI event behavior, and secret boundaries. Correct every material finding and rerun the complete local proof.

- [ ] **Step 8: Commit, publish, and prove live CI**

Commit: `Add CI-enforced engineering harness`

Push `agent/engineering-harness`, open a draft PR, and wait for the Full Stack workflow. Success requires the PR to be mergeable and every required check to conclude `SUCCESS`.

---

## Completion Audit

- [ ] Compare every design deliverable and acceptance criterion to the final diff.
- [ ] Confirm the policy, router, verifier, instructions, scripts, CI, tests, and README are all present.
- [ ] Confirm protected explicit and Git-derived scopes select full verification plus human review.
- [ ] Confirm invalid and ambiguous scopes return nonzero.
- [ ] Confirm no production workflow, secret read, deployment, or application runtime change entered the diff.
- [ ] Record local command output, commit SHA, PR URL, and live CI run URL in the final report.
