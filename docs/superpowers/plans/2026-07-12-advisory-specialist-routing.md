# Advisory Specialist Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add repository-owned specialist definitions and deterministic advisory specialist recommendations to the existing engineering router, verifier, and CI evidence.

**Architecture:** A validated `.agents/specialists.json` registry and five Markdown contracts are loaded by the shared engineering-policy library. The library selects specialists from normalized paths and final risk classification; `route-task` and `verify-change` expose the same immutable recommendations while CI remains advisory-only.

**Tech Stack:** Node.js 20 ESM, built-in `node:test`, JSON, Markdown, pnpm 8, GitHub Actions.

## Global Constraints

- Specialist routing is automatic and advisory; it never spawns an agent or creates a merge requirement.
- Recommendations cannot change classification, verification commands, human-review status, exit codes, approval, deployment, or production behavior.
- Registry validation fails closed for malformed schema, duplicate IDs or instruction paths, invalid patterns, missing instruction files, and repository escapes.
- Specialist instruction paths remain under `.agents/specialists/` and end in `.md`.
- Output ordering and reasons are deterministic and deduplicated.
- No production workflow, secret, provider-specific agent manifest, or application runtime behavior enters this slice.
- Every behavior change follows red-green-refactor and ends with protected local verification plus live CI proof.

---

### Task 1: Specialist registry validation and deterministic selection

**Files:**
- Create: `.agents/specialists.json`
- Create: `.agents/specialists/reviewer.md`
- Create: `.agents/specialists/tester.md`
- Create: `.agents/specialists/ui-hardener.md`
- Create: `.agents/specialists/safety-reviewer.md`
- Create: `.agents/specialists/test-isolation.md`
- Modify: `scripts/engineering-policy.mjs`
- Create: `tests/specialist-routing.test.mjs`
- Modify: `.agents/engineering-policy.json`

**Interfaces:**
- Produces: `loadSpecialistRegistry({ repoRoot, registryPath? }) -> Promise<SpecialistRegistry>`
- Produces: `selectSpecialists({ repoRoot, paths, classification, registry }) -> SpecialistRecommendation[]`
- `SpecialistRecommendation`: `{ id, description, instructions, reasons: string[] }`

- [ ] **Step 1: Write failing registry and selection tests**

Create `tests/specialist-routing.test.mjs` with temporary repository helpers. Assert:

```js
const registry = await loadSpecialistRegistry({ repoRoot });
const selected = selectSpecialists({
  repoRoot,
  paths: ['apps/web-widget/src/components/ComicBoard.tsx'],
  classification: 'standard',
  registry,
});
assert.deepEqual(selected.map(({ id }) => id), ['tester', 'ui-hardener']);
```

Add independent cases for protected reviewer selection; auth/moderation/schema/storage/permission safety selection; tests/fixtures/config/CI test-isolation selection; mixed-scope deduplication; stable sorted reasons; no accidental specialist for `README.md`; malformed JSON; unknown keys; duplicate IDs; duplicate instruction paths; invalid classifications and patterns; missing instruction files; non-file instructions; and `../` or absolute instruction escapes.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/specialist-routing.test.mjs`

Expected: module export failure for `loadSpecialistRegistry` and `selectSpecialists`.

- [ ] **Step 3: Add the registry and five specialist contracts**

Create version `1` registry entries with exact IDs and routing signals from the approved design. Each Markdown contract must contain these headings:

```markdown
# <Specialist name>
## Use when
## Focus
## Required inputs
## Required evidence
## Stop and escalate
## Prohibited actions
```

Every contract prohibits self-approval, secret access, deployment, and scope expansion.

- [ ] **Step 4: Implement strict loading and selection**

In `scripts/engineering-policy.mjs`, reuse path normalization and glob compilation. Validate exact registry and entry keys, kebab-case unique IDs, single-line descriptions, classification values, non-empty routing signals, contained instruction paths, and regular-file existence. Return recommendations sorted by `id`, with reasons formatted as `classification:<value>` and `path:<normalized-path>`.

- [ ] **Step 5: Protect new harness surfaces and confirm GREEN**

Add `tests/specialist-routing.test.mjs` to `protected-engineering-surfaces`; `.agents/**` already protects the registry and contracts.

Run: `node --test tests/specialist-routing.test.mjs tests/engineering-policy.test.mjs`

Expected: all specialist and existing policy tests pass.

- [ ] **Step 6: Commit Task 1**

```powershell
git add .agents scripts/engineering-policy.mjs tests/specialist-routing.test.mjs
git commit -m "Add specialist routing registry"
```

---

### Task 2: Router and verifier advisory output

**Files:**
- Modify: `scripts/route-task.mjs`
- Modify: `scripts/verify-change.mjs`
- Modify: `tests/route-task.test.mjs`
- Modify: `tests/verify-change.test.mjs`
- Modify: `tests/engineering-policy.test.mjs`

**Interfaces:**
- Consumes: `loadSpecialistRegistry`, `selectSpecialists`
- Extends classification result with: `specialists: SpecialistRecommendation[]`
- Extends verifier report with the same deeply immutable `specialists` value

- [ ] **Step 1: Write failing router output tests**

Update route tests so exact JSON contains:

```js
specialists: [{
  id: 'reviewer',
  description: 'Review protected engineering changes for correctness and containment.',
  instructions: '.agents/specialists/reviewer.md',
  reasons: ['classification:protected'],
}]
```

Assert text output contains one stable line per specialist and JSON emits `specialists: []` when none match.

- [ ] **Step 2: Run router tests and confirm RED**

Run: `node --test tests/route-task.test.mjs`

Expected: exact output assertions fail because specialist recommendations are absent.

- [ ] **Step 3: Wire registry selection into classification and router output**

Load the registry after resolving scope and policy, select from final normalized paths/classification, and append recommendations without changing existing fields. JSON must remain pure JSON; text mode prints `specialists: none` or `specialist: <id> (<comma-separated reasons>) -> <instructions>`.

- [ ] **Step 4: Confirm router GREEN**

Run: `node --test tests/specialist-routing.test.mjs tests/engineering-policy.test.mjs tests/route-task.test.mjs`

Expected: all selected tests pass.

- [ ] **Step 5: Write failing verifier immutability and parity tests**

Update verifier tests to assert router/verifier recommendation parity and attempt callback mutations:

```js
onClassified(view) {
  assert.throws(() => view.specialists.push({ id: 'fake' }), TypeError);
  assert.throws(() => view.specialists[0].reasons.push('fake'), TypeError);
}
```

Assert selected commands and `requiresHumanReview` remain unchanged.

- [ ] **Step 6: Run verifier tests and confirm RED**

Run: `node --test tests/verify-change.test.mjs`

Expected: specialist fields or deep immutability assertions fail.

- [ ] **Step 7: Extend immutable verifier reporting**

Deep-freeze copied recommendation objects and reason arrays in `immutableClassification`. Print advisory recommendations before commands while retaining first-failure propagation and the existing authorization disclaimer.

- [ ] **Step 8: Confirm verifier GREEN and commit Task 2**

Run: `node --test tests/specialist-routing.test.mjs tests/engineering-policy.test.mjs tests/route-task.test.mjs tests/verify-change.test.mjs`

Expected: all selected tests pass.

```powershell
git add scripts/route-task.mjs scripts/verify-change.mjs tests/engineering-policy.test.mjs tests/route-task.test.mjs tests/verify-change.test.mjs
git commit -m "Report advisory specialist recommendations"
```

---

### Task 3: Repository guidance, harness wiring, and completion proof

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `tests/engineering-harness-wiring.test.mjs`
- Modify: `tests/verification-wiring.test.mjs`

**Interfaces:**
- Adds `tests/specialist-routing.test.mjs` to `pnpm run test:harness`
- CI continues to consume the existing `$RUNNER_TEMP/harness-route.json` report

- [ ] **Step 1: Write failing wiring and advisory-boundary tests**

Assert `test:harness` includes the specialist test. Assert `AGENTS.md` explains that recommendations are advisory, do not spawn agents, and do not count as approval. Assert README examples show text and JSON specialist output. Assert CI contains no `spawn`, specialist execution command, required specialist artifact, or provider-specific orchestration step.

- [ ] **Step 2: Run wiring tests and confirm RED**

Run: `node --test tests/engineering-harness-wiring.test.mjs tests/verification-wiring.test.mjs`

Expected: missing specialist command/guidance assertions fail.

- [ ] **Step 3: Document usage and wire focused tests**

Add `tests/specialist-routing.test.mjs` to `test:harness`. Document that engineers may follow a recommended contract manually or dispatch a matching specialist in an authorized interactive session, but CI only logs recommendations.

- [ ] **Step 4: Confirm wiring GREEN**

Run: `node --test tests/engineering-harness-wiring.test.mjs tests/verification-wiring.test.mjs`

Expected: all wiring tests pass.

- [ ] **Step 5: Exercise real representative routing**

Run:

```powershell
pnpm run route-task -- --json apps/web-widget/src/components/ComicBoard.tsx
pnpm run route-task -- --json apps/agent-service/src/guardrails.ts
pnpm run route-task -- --json tests/route-task.test.mjs
```

Expected: widget selects `tester` and `ui-hardener`; guardrails selects `reviewer`, `safety-reviewer`, and `tester`; harness test selects `reviewer`, `test-isolation`, and `tester`.

- [ ] **Step 6: Run the complete protected proof**

Run:

```powershell
pnpm run test:harness
pnpm run verify-change -- --base origin/main
git diff --check
```

Expected: harness tests pass, the branch classifies protected and completes `verify:local`, and the diff check is clean.

- [ ] **Step 7: Independent review and corrections**

Have a tester audit every acceptance criterion and a reviewer inspect registry bypasses, path containment, output determinism, immutability, CI advisory-only behavior, and secret/deployment boundaries. Correct every material finding and rerun Step 6.

- [ ] **Step 8: Commit Task 3**

```powershell
git add AGENTS.md README.md package.json tests/engineering-harness-wiring.test.mjs tests/verification-wiring.test.mjs
git commit -m "Document advisory specialist routing"
```

- [ ] **Step 9: Publish and prove live CI**

Push `agent/advisory-specialist-routing`, open a focused draft pull request, resolve all actionable review threads, and require `Full Stack` success. Mark ready and merge only when live protection permits; then require the post-merge `main` run to conclude `success`.

---

## Completion Audit

- [ ] Compare every design deliverable and acceptance criterion to the final diff.
- [ ] Confirm all five registry entries and instruction files exist and are protected.
- [ ] Confirm malformed registries and instruction escapes fail closed.
- [ ] Confirm router and verifier emit identical deterministic recommendations.
- [ ] Confirm recommendation callbacks cannot mutate verifier behavior or evidence.
- [ ] Confirm CI logs recommendations but contains no specialist spawning or approval path.
- [ ] Confirm no production workflow, secret read, deployment, branch-protection change, or application runtime change entered the diff.
- [ ] Record local commands, test counts, commit SHA, PR URL, PR CI URL, merge SHA, and post-merge `main` CI URL.
