# Task 6 Step 1 local verification report

Status: **DONE_WITH_CONCERNS**

The requested local verification completed successfully. No product defect was exposed, so no product file was edited. The concerns are non-fatal harness warnings documented below; protected human review remains required.

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
- Initial status: clean (`git status --short --branch` showed only the branch header).
- HEAD: `9178aac510d2392189938cddc1a387f1d2d2c767`
- `origin/main`: `25e67013ca70645be54895c5ad15577b08494232`
- Merge-base: `25e67013ca70645be54895c5ad15577b08494232`
- `git rev-list --left-right --count HEAD...origin/main`: `17 0` — branch is 17 commits ahead and 0 behind.

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
