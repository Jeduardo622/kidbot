# Supervised-beta implementation evidence

Date: 2026-09-12. Branch: `codex/v1-completion`, starting at `3c8881c`. The primary `feat/phase-0-1` checkout was preserved. This is implementation evidence, not public-launch approval.

## Implemented sequence

1. Canonical scope: [v1 acceptance](v1-acceptance.md), linked from PLAN, EXECUTSPEC, README and the service roadmap.
2. Production widget artifact checks, offline-only fixture preview, isolated synthetic service environments, and a tree-identical CI baseline. The Windows typecheck wrapper now fails on spawn errors instead of incorrectly returning success.
3. Actual generated-image moderation, bounded provider configuration and whole-request deadlines, cancellation and partial-file cleanup, bounded image decoding, strict production provider/storage/limiter posture, and atomic Redis expiry.
4. Realtime explicitly deferred. Browser speech lifecycle cancels on navigation and suppresses stale results.
5. Composited coloring PNG export and keyboard drawing, retained tab state, parent metadata history and confirmed deletion, AI/privacy disclosure, and science step/prediction progression.
6. Non-root Node 20 Docker images, Railway manifests, readiness and graceful draining, protected post-deploy artifact gates, and a [deployment runbook](deployment-runbook.md).
7. Reusable synthetic load harness and release-review checklist. Live, human and hosted gates remain open in [release review](release-review.md).

## Executed verification

All commands below ran locally without real provider credentials or real dotenv files. Use `npx --yes pnpm@8.15.8` where this host's global pnpm differs from the repository pin.

| Command/check | Result and boundary |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed with pnpm 8.15.8. |
| `pnpm run route-task -- --base 3c8881c --json` | Protected; human review required. |
| `pnpm run verify-change -- --base 3c8881c` | Passed integration baseline; final post-review rerun recorded below. Runs strict lint, genuine TypeScript checking, package/root tests, deterministic AI evaluation, MCP compatibility, provider configuration preflight and secured-posture smoke. |
| `REDIS_URL=<owned local Redis> pnpm --filter @kidbot/agent-service exec vitest run src/__tests__/rateLimit.test.ts` | 7/7 passed against ephemeral Redis 7. |
| `REDIS_URL=<owned local Redis> pnpm --filter @kidbot/mcp-server run test:request-controls` | 14/14 passed, including cross-instance shared limits. |
| `REDIS_URL=<owned local Redis> pnpm run smoke:parent-store-redis` | Passed synthetic consent, isolation, history and deletion round trip. |
| `pnpm run smoke:local-load` | Harness available; underlying `node scripts/smoke-local-load.mjs` executed: 100 distinct sessions, two waves of 50, concurrency 2, 61-second wave pause; 100 successes, zero unexpected errors; successful p50 7 ms, p95 13 ms. Separate 16-request admission probe produced 15 expected, retry-hinted rejections and no unexpected rejection. This is stub-provider throughput, not provider latency or 100 concurrent users. |
| Both `docker build -f apps/<service>/Dockerfile ... .` targets | Node 20 Linux builds passed; final post-review rebuild recorded below. This does not replace Linux CI/test execution. |

## Browser evidence

Chromium opened the built production widget via the local MCP server. A narrow same-origin test bridge invoked actual local MCP tools backed by synthetic fixtures; this was not a ChatGPT host session.

- Voice typed request and reply, four-panel comics, coloring generation, and science generation/progression/prediction/explanation exercised.
- Tab switches retained generated work. Drawing via keyboard and a real PNG download exercised.
- Visually inspected `output/playwright/kidbot-coloring.png` (512 by 512): white background, black outline and blue user stroke all present.
- Inspected mobile science layout at 390 by 844; viewport, document and body widths were all 390 (no horizontal overflow). Screenshot: `output/playwright/kidbot-mobile-science.png`.
- Console contained a favicon 404; no application exception was observed during these flows.
- Parent history race reproduced independently in production-dist JSDOM; stale-response regression coverage added. Real Redis parent service flow was tested separately; authenticated ChatGPT parent UI proof remains open.
- Actual microphone permission, touch/stylus hardware, assistive technology and full WCAG-AA conformance were not tested. Browser artifacts remain local and ignored, not published.

## Review and remaining gates

Backend, artifact/deployment and UI specialists implemented disjoint slices. A fresh independent reviewer identified the stale-history race and loss of science-step navigation. Cross-review identified strict readiness, production fixture fallback, unbounded provider environment values, cancellation cleanup and pre-decode allocation findings. These findings were addressed with focused regression tests before final integration.

No production services, hosted Supabase data, deployment workflows or real user data were changed. Realtime, live-provider safety/latency, multi-instance hosted load, WCAG/device/red-team evidence, privacy/identity design, legal sign-off, beta feedback and OpenAI approval remain incomplete. Supabase expiry cleanup remains limited to 1,000 objects per hourly pass and needs capacity validation.

The current under-13 targeting conflicts with ChatGPT directory distribution rules. Submission JSON is paused pending owner-approved impact-hint corrections and distribution decisions; no approval or legal compliance is implied.

## Final integration record

Final post-review `npx --yes pnpm@8.15.8 run verify-change -- --base 3c8881c` exited 0. Agent: 171 passed, 1 Redis-dependent skip; widget: 114 passed; MCP: 51 passed, 4 Redis-dependent skips; root: 255 passed, 1 Windows FIFO skip; compatibility: 13 passed. Deterministic evaluator: 17 cases, overall 100, no baseline regression. Secured-posture smoke passed. Widget JS: 176.57 kB (well below 1 MB); its referenced artifact is validated by the build.

Redis-dependent rate-limit, shared-control and parent-store tests were run separately against the owned ephemeral Redis instance (7/7, 14/14, 16/16). `REDIS_URL=<owned local Redis> node --test apps/mcp-server/test/auth-startup-matrix.test.mjs` also passed 25/25, including admission-before-Redis and parent-token stripping/history tests. All five Redis-dependent baseline skips therefore received separate execution. The Windows FIFO case remains inapplicable locally; Linux CI must provide that proof.

Independent review findings are resolved in source and regression tests. Protected human approval remains required even though live branch protection currently requires Full Stack but does not enforce a pull-request reviewer. No merge or deployment is authorized by the green local gate.
