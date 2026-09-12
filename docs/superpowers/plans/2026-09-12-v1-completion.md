# Kidbot v1 Completion Implementation Plan

> Execute this plan task-by-task using the repository tester/reviewer contracts, test-driven development and isolated worktrees. The user has authorized execution of the full audited sequence.

**Goal:** Complete the documented product implementation and collect reproducible release evidence.

**Architecture:** Preserve the existing React widget, public MCP contracts and secured agent service. Implement independently reviewable artifact, provider, voice and UI slices. Keep production credentials server-only and generated content outside host widget state.

**Tech Stack:** TypeScript, React, Express, MCP SDK, OpenAI, Redis, Vite, Vitest, Node test runner; pnpm 8.15.8.

**Spec:** `docs/v1-acceptance.md`.

## Constraints

- Protected work requires human review; code/tests cannot self-approve a public deployment or merge.
- Fresh route-task classification for every slice; preserve existing checkout and fixtures.
- Never load real dotenv state in synthetic verification. No provider requests in deterministic evaluation.
- Explicitly distinguish code/test completion from hosted, browser/device and human approval evidence.

## Task 1: Canonical acceptance

- [x] Reconcile requirements in docs/v1-acceptance.md and link all roadmap entry points.
- [x] Record verification and outstanding external evidence at the end of this run.

## Task 2: Artifact and verification correctness

Files: apps/mcp-server/src/server.ts and artifact helpers; apps/web-widget/dist/kidbot-fallback.*; scripts/smoke-secured-posture.mjs; scripts/smoke-parent-store.mjs; tests/; deployment manifests; .github/workflows/ci.yml.

- [x] Reproduce missing production bundle, fallback real-result loss and dotenv pollution with executable tests.
- [x] Build widget in production image; refuse missing artifacts in production; make fallback offline-only.
- [x] Give synthetic child services isolated cwd/environment; exercise invalid production config separately.
- [x] Handle tree-identical CI pushes explicitly without weakening the router's empty-scope refusal.
- [x] Run focused tests, production builds and synthetic smokes; request independent review.

## Task 3: Provider safety and deadlines

Files: apps/agent-service/src/provider.ts, agents/storyAgent.ts, agents/imageAgent.ts, config.ts, imageAssetStore.ts, rateLimit.ts; apps/mcp-server/src/config.ts, tools.ts, requestControls.ts; covering tests.

- [x] Add failing tests for image moderation before storage, cancellation, complete story deadline and lease duration.
- [x] Moderate actual rendered output; withhold blocked/uninspected assets and cancel promptly.
- [x] Reject production fixture/memory/inline-storage posture; make Redis expiry atomic.
- [x] Run provider/contract tests and unchanged deterministic evaluator; review safety boundaries.

## Task 4: Voice release scope

Decision: take the sequence's explicit deferral option. Realtime is not part of the supervised beta; the canonical contract states the later integration and live-evidence gates. Do not ship an unused SDK or label browser speech as Realtime.

- [x] Check current official API/SDK contracts and explicitly defer Realtime from this release.
- [x] Fix browser voice lifecycle with failing-then-passing tests for hidden-tab cancellation and suppression of stale output.
- [x] Keep later Realtime and live microphone/provider gates visible in release notes.

## Task 5: Existing UI completion

Files: web-widget main.tsx, ColoringBook.tsx, ScienceLab.tsx, styles.css, parent-history utility/component, related tests.

- [x] Reproduce lost navigation state and incomplete PNG export; implement compositing and retained in-memory panels.
- [x] Add parent history with validated envelopes, expiry handling, empty/error state and deletion confirmation.
- [x] Add AI/privacy disclosure, labels, keyboard drawing and accessible prediction/step progression.
- [x] Test real interactions, export composition, credential non-persistence and inactive audio cleanup (browser and unit proof boundaries are in the evidence report).

## Task 6: Operations and release evidence

- [x] Add deployment manifests and readiness/post-deploy verification gates; actual targets and deployments remain unapproved.
- [x] Verify graceful drain, bounded health and shared Redis controls locally; hosted metrics/capacity remain open.
- [x] Run verify-change against 3c8881c; build/test using the pinned package manager; run browser and load checks.
- [x] Prepare release notes, submission/review checklist and reproducible evidence without fabricating approvals.
- [ ] Review complete diff, resolve material findings, commit focused slices and open a reviewable PR if available.

## Progress

- Initial classification: protected, human review required. Source branch preserved in primary checkout.
- Tasks 2, 3 and 5 assigned separate file ownership; root coordinates integration and Task 4.
