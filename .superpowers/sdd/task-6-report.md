# Task 6 verification and final-review report

Status: **DONE_WITH_CONCERNS**

The opening Step 1 section below is the pre-fix verification snapshot: that run exposed no defect and made no product edit. The later **Consolidated final-review fix wave** section records the subsequent product edits, RED/GREEN evidence, and final protected verification. The concerns are non-fatal harness warnings documented below; protected human review remains required.

## Scope and route classification

- Chosen task: Task 6, Step 1 only — focused and full local verification plus evidence preparation.
- Exact issue key: none supplied.
- Route command: `pnpm run route-task -- --base origin/main --json`
- Route exit: `0`
- Classification: `protected`
- Selected verification: `pnpm run verify:local`
- Human review: required.
- Recommended specialists from routing: reviewer, safety-reviewer, test-isolation, tester, and UI-hardener. No agents were started in this step.

## Runtime and Redis containment

- Bundled Node path prepended to `PATH`: `C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin`
- Node: `v24.14.0`
- Fallback pnpm path prepended to `PATH`: `C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback`
- pnpm: `11.7.0`
- Disposable Redis: `redis:7-alpine`, container `kidbot-task6-verify`, dynamically mapped to `127.0.0.1:21999`; readiness returned `PONG`.
- Every focused command and both full-verifier runs inherited `REDIS_URL=redis://127.0.0.1:21999`.
- Redis cleanup: `docker stop kidbot-task6-verify` exited `0`; the `--rm` container was removed.

## Git evidence

- Read-only refresh: `git fetch origin main --prune` exited `0`.
- Branch: `codex/launch-blockers-3-4`
- Current status before the final evidence/test-isolation cleanup: clean (`git status --short --branch` showed only the branch header).
- Current HEAD after the product fix wave: `36932b695a708ab4985a0dd44b1ade49c41af395`.
- `origin/main`: `25e67013ca70645be54895c5ad15577b08494232`
- Merge-base: `25e67013ca70645be54895c5ad15577b08494232`
- `git rev-list --left-right --count HEAD...origin/main`: `18 0` — branch is 18 commits ahead and 0 behind.
- The executed verification counts immediately below remain the historical pre-fix Step 1 results at `9178aac`; final post-fix counts are recorded later and must not be conflated with this snapshot.

## Executed verification

1. `pnpm --filter @kidbot/mcp-server run test:compat`
   - Exit `0`; 12 tests passed, 0 failed, 0 skipped.

2. `pnpm --filter @kidbot/mcp-server run test:parent-store`
   - Exit `0`; 14 tests passed, 0 failed, 0 skipped.
   - Redis parent-store smoke executed and passed; it did not skip.

3. `pnpm --filter @kidbot/mcp-server run test:auth-matrix`
   - Exit `0`; 20 tests passed, 0 failed, 0 skipped.
   - Redis request-control and parent-store paths executed against the disposable Redis instance.

4. `pnpm --filter web-widget test -- App.sessionState.test.tsx`
   - Exit `0`; 8 files passed, 45 tests passed, 0 failed, 0 skipped.
   - The named file contained 11 passing tests. Because the package script forwarded a literal `--`, Vitest ran the complete widget suite rather than only the named file.

5. `pnpm --filter @kidbot/agent-service test -- serviceAuthBoundary.test.ts`
   - Exit `0`; 13 files passed, 80 tests passed, 0 failed, 0 skipped.
   - The named file contained 19 passing tests. Because the package script forwarded a literal `--`, Vitest ran the complete agent-service suite rather than only the named file.

6. `pnpm run verify-change -- --base origin/main`
   - First exact run: exit `0`; verifier reported `classification: protected`, `status: passed`, and `human review: required`.
   - Evidence-only exact rerun: exit `0` with the same classification and final status.
   - Full workspace counts from the evidence rerun:
     - web-widget: 8 files, 45 passed.
     - agent-service: 13 files, 80 passed.
     - mcp-server workspace tests: 44 passed, 0 failed, 0 skipped.
     - root Node harness: 221 passed, 0 failed, 1 skipped out of 222.
     - MCP compatibility: 12 passed, 0 failed, 0 skipped.
     - deterministic AI evaluation: all reported cases scored 100; overall mean 100.00; evaluation passed; 22 baseline metrics unchanged.
     - provider preflight: local, data-URL, and Supabase URL-shape configuration checks returned `ok: true` with `live: false`.
     - secured-posture smoke: passed.
   - Lint, typecheck, workspace/root tests, AI evaluation, MCP compatibility, provider preflight, and secured-posture smoke all completed under the selected protected verifier.

## Skipped, blocked, and secret-dependent evidence

- Skipped: one root-harness test, `job summary path rejects FIFO destinations where supported`, skipped because the FIFO capability is platform-conditional on Windows.
- Redis-dependent skips: none in the focused parent-store/auth commands or the full MCP workspace run.
- Blocked: none.
- Secret-dependent/live checks: none were attempted or required by Step 1. The provider preflight explicitly ran in non-live configuration-check mode. No deployment, hosted smoke, push, PR, merge, or secret-backed operation was performed.

## Warnings and residual risk

- Both full verifier runs emitted non-fatal `WebSocket server error: Port is already in use` while workspace Vitest suites ran concurrently. The widget suite still completed 45/45 and the verifier exited `0`. This matches harness-level port contention rather than a demonstrated product defect.
- The root harness intentionally exercises an ESLint spawn-failure path and prints `ESLint failed to start: spawn failed`; the corresponding negative-path test passed and the real lint phase completed successfully.
- The two brief-specified Vitest commands run their full package suites due argument forwarding. Coverage is broader than requested, but the commands do not isolate only the named test file.
- Protected-path acceptance remains gated on non-author human review and the specialist reviews in Task 6 Step 2.

## Recommended next slice

Proceed to Task 6 Step 2 with the complete branch diff and this verification evidence. Do not treat this report as protected-path approval.

## Consolidated final-review fix wave

Runtime: bundled Node `v24.14.0`; pnpm `11.7.0`. Disposable Redis container `kidbot-final-review` mapped to `redis://127.0.0.1:61945`; readiness returned `PONG`.

### RED evidence

- MCP wire/app-only/token/annotation class: `pnpm --filter @kidbot/mcp-server run test:compat` exited `1`; 11 passed, 1 failed because `idempotentHint` was absent. The same contract test also required parent-only visibility, compatibility privacy visibility, non-read-only history, and token-free output schemas.
- ChatGPT bridge + purge UI class: `pnpm --filter @kidbot/web-widget exec vitest --run --environment jsdom src/App.sessionState.test.tsx` exited `1`; 4 passed, 8 failed because production still read `getWidgetState()` and treated `callTool()` as direct content rather than an envelope. The host-realistic create/update/delete fixtures use `.structuredContent`, with the create bearer only in `._meta`.
- Agent production fallback class: `pnpm --filter @kidbot/agent-service exec vitest --run src/__tests__/serviceAuthBoundary.test.ts` exited `1`; 19 passed, 1 failed because production accepted `FALLBACK_WIDGET=1` with `KIDBOT_LOCAL_DEV=1`.
- Store expiry class: `pnpm --filter @kidbot/mcp-server run test:parent-store` exited `1`; 13 passed, 1 failed, 1 Redis skip because a directly reused expired in-memory session was rejected before pruning.
- Pre-parse admission class: `node --test --test-name-pattern "network admission" apps/mcp-server/test/auth-startup-matrix.test.mjs` exited `1`; 0 passed, 2 failed because list/resource and post-oversize follow-up requests remained unbounded.
- Keyboard focus class: the focused widget command exited `1`; 12 passed, 1 failed because focus remained on `body` after parent unlock.

### GREEN evidence

- Focused widget bridge/UI: 13 passed, 0 failed.
- MCP compatibility: 12 passed, 0 failed against disposable Redis.
- Parent store: 15 passed, 0 failed, 0 skipped against disposable Redis. The Redis case independently shortened then verified renewal of profile, profile-session index, session, and event-list TTLs after authorized update, record, and list operations.
- Request-control store: 10 passed, 0 failed, including shared Redis controls.
- Auth/startup/admission matrix: 24 passed, 0 failed, 0 skipped. It schema-validates real `rate_limited`, `concurrency_limited`, and `request_timeout` structured results; exercises tools/list, resources/list, oversized malformed input, production fallback rejection, component-only create bearer, and the bogus-profile ordering invariant.
- P2 ordering proof: after the first allowed bogus `parent_history_list` performed its Redis HMAC/profile preflight, the over-budget repeat returned `rate_limited` without any additional Redis GET of the bogus profile key.
- Full web-widget suite: 8 files, 47 passed, 0 failed.
- Full agent-service suite: 13 files, 81 passed, 0 failed.
- Full MCP workspace suite: 49 passed, 0 failed, 0 skipped.
- `pnpm run lint`: exit `0`.
- `pnpm run typecheck`: exit `0`.

### Implementation and residual policy

- Parent-control tools are app-only and the create bearer is absent from model-visible content and structured content.
- Network/global admission now runs before JSON parsing and MCP construction/dispatch; per-tool caller/cost controls remain separately scoped.
- Authorized history reads intentionally renew owned retention and are disclosed in exact Markdown/HTML parity; `AGENT_SERVICE_TOKEN` remains the selected HMAC key per the adjudicated design, with key separation deferred.
- Protected human review remains required. No deployment, push, PR, merge, or hosted/live operation was performed.

### Protected verifier

- `pnpm run verify-change -- --base origin/main`: exit `0`; classification `protected`; selected `pnpm run verify:local`; status `passed`; human review `required`.
- Verifier counts: web-widget 47 passed; agent-service 81 passed; MCP workspace 49 passed; root harness 221 passed and 1 platform-conditional skip out of 222; MCP compatibility 12 passed; deterministic AI evaluation 17 cases at 100 with 22 unchanged baseline metrics and overall mean 100.00.
- Non-fatal harness warning: concurrent Vitest startup printed `WebSocket server error: Port is already in use`; all workspace suites completed with zero failures and the protected verifier exited `0`.

## Final evidence and test-isolation cleanup

- Scope: test and evidence files only; no product source or behavior changed.
- Corrected the opening Git snapshot to the post-product-wave HEAD `36932b695a708ab4985a0dd44b1ade49c41af395`, 18 commits ahead and 0 behind `origin/main`, and explicitly separated the historical pre-fix Step 1 counts from the consolidated final-wave evidence.
- Replaced the concurrency test's fixed 50 ms hold assumption with a deterministic fake-agent request-received barrier plus an explicit response-release barrier. The test still validates the real `concurrency_limited` structured result against the advertised output schema.
- Changed the agent service auth-boundary teardown to await the `server.close` callback and propagate close errors.
- Focused MCP concurrency test: `node --test --test-name-pattern "mcp concurrency rejection" apps/mcp-server/test/auth-startup-matrix.test.mjs` — 1 passed, 0 failed, 0 skipped.
- Full MCP auth/startup/admission matrix against disposable Redis at `redis://127.0.0.1:32768`: 24 passed, 0 failed, 0 skipped.
- Focused agent auth-boundary suite: `pnpm --filter @kidbot/agent-service exec vitest --run src/__tests__/serviceAuthBoundary.test.ts` — 1 file passed; 20 tests passed, 0 failed.
- Required package builds before the focused checks: `@kidbot/agent-service` and `@kidbot/mcp-server` both exited `0`.
- `git diff --check`: exit `0`; only PowerShell/Git CRLF conversion warnings were emitted.

## UI-hardener rejection fix wave

Base HEAD: `ae0f5aa101b2a2a08ea250c0c9eccd9a47a6cad6`. Scope remained inside the web widget, shared widget utilities, widget tests, styles, and this evidence report. No agent, PR, deployment, hosted system, or secret-backed action was used.

### RED evidence

- `pnpm --filter @kidbot/web-widget exec vitest --run --environment jsdom src/App.sessionState.test.tsx src/components/ToolResultEnvelope.test.tsx`: exit `1`; 13 expected failures. The failures reproduced missing host-envelope parsing in all four tool widgets, retained-profile re-enable creating again, failed age updates remaining visible, missing lock-to-PIN focus and PIN live-region semantics, absent active-nav state, and absent narrow-width sizing rules.
- The first full widget run after production envelope parsing exited `1` with 14 legacy fixture failures because older VoiceBar and ComicBoard tests still returned direct tool content. Those fixtures were converted to current host-realistic `{ structuredContent }` envelopes before the accepted full-suite run.

### GREEN and verification evidence

- Focused App + envelope regressions: 2 files, 25 passed, 0 failed.
- Full web-widget suite: 9 files, 59 passed, 0 failed.
- `pnpm run lint`: exit `0`.
- `pnpm run typecheck`: exit `0`.

- `pnpm run route-task -- --base origin/main --json`: exit `0`; classification `protected`; selected `pnpm run verify:local`; human review required.
- Disposable Redis 7 container `kidbot-ui-hardener` was mapped to `redis://127.0.0.1:5778` for protected verification.
- `pnpm run verify-change -- --base origin/main`: exit `0`; classification `protected`; status `passed`; human review `required`. The run included web-widget 59 passed, agent-service 81 passed, MCP workspace 49 passed, root harness 221 passed plus 1 Windows capability skip out of 222, MCP compatibility 12 passed, deterministic AI evaluation 17 cases at 100 with 22 unchanged metrics, provider configuration preflight, and secured-posture smoke.
- `git diff --check`: exit `0`; only Git CRLF conversion warnings were emitted.

### Result and residual policy

- VoiceBar, ComicBoard, ColoringBook, and ScienceLab validate and unwrap only object-valued `.structuredContent`; malformed envelopes fail closed through existing visible error handling.
- The parent create bearer is still read only from component-visible `_meta`. Host-persisted `widgetState` remains limited to `ageBand`, `sessionId`, and `tab`.
- Re-enabling a retained profile performs authenticated `parent_profile_update { historyEnabled: true }`; failed persisted age changes leave both visible and host-persisted age unchanged.
- Locking parent controls focuses the PIN input. PIN failures use assertive alerts; unlock success uses a polite status. Active nav uses `aria-pressed`; global border-box and narrow-width containment rules cover mobile overflow.
- The protected verifier emitted the known non-fatal concurrent Vitest `WebSocket server error: Port is already in use`; every suite completed with zero failures and the verifier exited `0`. Protected non-author human review remains required.

## Current-head UI result-validation fix wave

Base HEAD before this wave: `28715ec783fed07459a5b11e87e76d34ceddf50a`. Route command `pnpm run route-task -- --base origin/main --json` exited `0`, classified the branch `protected`, selected `pnpm run verify:local`, and required human review. Scope remained in the web widget result parser, the four consuming components, retained parent credential state, widget tests, and this report.

### RED evidence

- `pnpm --filter @kidbot/web-widget exec vitest --run --environment jsdom src/components/ToolResultEnvelope.test.tsx src/App.sessionState.test.tsx`: exit `1`.
- `App.sessionState.test.tsx`: 19 tests, 1 expected failure because a confirmed `isError` / profile-not-found result left the retained profile and token in memory.
- `ToolResultEnvelope.test.tsx`: 16 tests, 9 expected failures plus the intended uncaught `panels.map is not a function` and `plan.steps.map is not a function` reproductions. The failures covered malformed per-tool payloads for VoiceBar, ComicBoard, ColoringBook, and ScienceLab; host-realistic `rate_limited`, `concurrency_limited`, and `request_timeout` envelopes; and an unrecognized `isError` envelope being rendered as success.

### Implementation and GREEN evidence

- Replaced the unchecked generic structured-content cast with shared tool-specific runtime type guards aligned to the advertised widget-consumed shapes. All four components now validate before accessing or rendering result fields.
- Advertised request-control results are detected before success parsing. Rate limits preserve a valid positive `retryAfter`; concurrency and timeout outcomes show distinct retry guidance. Any other `isError` envelope fails closed with visible retry guidance.
- A retained credential is cleared only after an `isError` result explicitly reports an expired, missing, unauthorized, invalid-token, or access-denied profile. The failed action leaves consent off and visible error state intact, and does not create a replacement; the next explicit opt-in creates a new profile.
- Focused GREEN rerun: 2 files, 35 passed, 0 failed.
- Full widget suite: 9 files, 69 passed, 0 failed.
- `pnpm run lint`: exit `0`.
- `pnpm run typecheck`: exit `0`.
- `git diff --check`: exit `0`; Git emitted only line-ending conversion warnings.

### Protected verifier and containment

- Disposable Redis 7 container `kidbot-ui-result-validation` mapped to `redis://127.0.0.1:33197`; readiness returned `PONG`. The container was stopped and removed after verification.
- `REDIS_URL=redis://127.0.0.1:33197 pnpm run verify-change -- --base origin/main`: exit `0`; classification `protected`; selected verifier `pnpm run verify:local`; status `passed`; human review `required`.
- The verifier included web-widget 69 passed; agent-service 81 passed; MCP workspace 49 passed; root harness 221 passed plus 1 Windows capability skip out of 222; MCP compatibility 12 passed; deterministic AI evaluation 17 cases at 100 with 22 unchanged metrics and overall mean 100.00; provider configuration preflight; and secured-posture smoke.
- The known non-fatal concurrent Vitest `WebSocket server error: Port is already in use` warning appeared; all suites completed with zero failures and the verifier exited `0`.
- No agent, PR, deployment, hosted system, production data, or secret-backed action was used. Protected non-author human review remains required.

### Authoritative final-current-state evidence

The verified implementation/evidence commit created after the checks above was `d72df37377bbcf737cee49d90c9c1e02db73d0ab`. At that committed state, `git rev-list --left-right --count HEAD...origin/main` returned `21 0`: 21 commits ahead and 0 behind. This paragraph is the single evidence-only amend requested after observing that commit; it does not claim the pre-amend object ID remains the amended commit's identity. No product or test content changed in the amend.

## Final current-head parent error and strict-result contract wave

Base HEAD before this wave: `56959446b7416c9d3b05fdaac45853c90d3cad44`. Fresh explicit-path routing classified the MCP contract/runtime, widget state/parser, tests, and this report as `protected`, selected `pnpm run verify:local`, and required human review. Scope remained limited to parent app-tool error envelopes, parent widget state transitions, generation result validation, contract fixtures, and this evidence report. No agent, PR, deployment, hosted system, production data, or secret-backed action was used.

### RED evidence

- Focused widget command: `pnpm --filter @kidbot/web-widget exec vitest --run --environment jsdom src/App.sessionState.test.tsx src/components/ToolResultEnvelope.test.tsx` exited `1`; 52 tests ran with 16 expected failures. Ten failures proved the four generation validators accepted extra/mixed success fields or rejected exact request-control branches. Six failures proved success-shaped `isError` envelopes could mutate create, age update, re-enable, disable, and delete state, and the old stale-credential detector did not recognize the required stable code.
- Redis-backed actual MCP call command: `node --test --test-name-pattern "mcp strips parent token" apps/mcp-server/test/auth-startup-matrix.test.mjs` exited `1`; the invalid-token delete call had `isError: true` but no `structuredContent`, reproducing the SDK's generic text-only exception envelope.
- After the first flat advertised-code implementation, MCP compatibility intentionally failed its new exact-schema assertion because parent update/delete/history still advertised four variants and permitted `retryAfter` on `invalid_parent_access`. The final contract advertises a distinct fifth exact branch only for those three tools.

### Implementation and focused GREEN evidence

- Parent update, delete, and history callbacks now translate only the store's exact invalid-access failure into `{ isError: true, structuredContent: { error: true, code: "invalid_parent_access" } }`; the public text is generic and neither bearer nor raw token is returned. Zod result unions and exact wire schemas share the same dedicated branch.
- Parent create, age update, retained-profile re-enable, disable, and delete now reject `isError` before inspecting any success-shaped structured content or component-only metadata. Credentials are cleared only for the exact `invalid_parent_access` code. That action stays failed with consent off and no implicit create; the next explicit retry creates. A rejected bridge promise remains visible and retains the credential.
- Voice, story, coloring, and science validators now accept only exact success, blocked, degraded, or request-control shapes. Science requires topic, steps, prediction, nonempty bounded choice selection, explanation, and supervision; nested prediction and story panel objects are strict.
- Focused widget GREEN: 2 files, 54 passed, 0 failed.
- Redis-backed actual MCP invalid-access GREEN: 1 passed, 0 failed; update, delete, and history all returned the exact structured code, validated against tools/list output schemas, and did not disclose either supplied bearer.
- MCP compatibility: 12 passed, 0 failed. Parent update/delete/history advertise five variants with an exact no-`retryAfter` `invalid_parent_access` branch; every other tool advertises four and rejects that code.
- Full Redis-backed auth/startup matrix: 24 passed, 0 failed, 0 skipped.
- Full web-widget suite: 9 files, 88 passed, 0 failed.
- `pnpm run lint`: exit `0`.
- `pnpm run typecheck`: exit `0`.

### Protected verifier and residual policy

- Disposable Redis 7 container `kidbot-parent-error-contract` used its Docker-assigned localhost port; `redis-cli PING` returned `PONG` immediately before verification.
- `REDIS_URL=<disposable localhost Redis> pnpm run verify-change -- --base 5695944`: exit `0`; classification `protected`; selected `pnpm run verify:local`; status `passed`; human review `required`.
- The verifier included web-widget 88 passed; agent-service 81 passed; MCP workspace 49 passed with no Redis skips; root harness 221 passed plus 1 Windows capability skip out of 222; MCP compatibility 12 passed; deterministic AI evaluation 17 cases at 100 with 22 unchanged metrics and overall mean 100.00; provider configuration preflight; and secured-posture smoke.
- The known non-fatal concurrent Vitest `WebSocket server error: Port is already in use` warning appeared; every suite completed with zero failures and the verifier exited `0`.
- No external secret, production service, or live provider was used. The provider preflight reported `live: false`. Protected non-author human review remains required.
