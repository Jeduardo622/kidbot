# Kidbot Monorepo

Kidbot is a safety-first creative playground for kids. This monorepo hosts the MCP bridge, the Kidbot web widget, and the kid-safe agent service.

## Prerequisites

- Node.js 20+
- pnpm 8+

## Quickstart

```bash
pnpm install
pnpm run build:widget
pnpm run dev
```

The `dev` script runs the widget (Vite), MCP server, and agent service together. Once the services are running you can connect them to ChatGPT or other MCP clients.

### Verification

- Authoritative recursive test run (packages with a `test` script): `pnpm -r --if-present run test -- --run`
- MCP compatibility smoke test (not included in recursive `test`): `pnpm --filter mcp-server run test:compat`
- Root wrapper: `pnpm run test` (runs full recursive tests only when pnpm and workspace dependencies are detectable)
- If the wrapper prints a smoke-only fallback warning, package Vitest suites were not executed.

### Environment

Copy `.env.example` to `.env` and provide any overrides:

```env
OPENAI_API_KEY=
AGENT_SERVICE_TOKEN=
MCP_PORT=3000
AGENT_PORT=4505
FALLBACK_WIDGET=0
KIDBOT_LOCAL_DEV=0
RATE_LIMIT_STORE=redis
REDIS_URL=redis://localhost:6379
PROVIDER_FAILURE_POLICY=503
PROVIDER_TIMEOUT_MS=15000
PROVIDER_RETRIES=1
PARENT_PROFILE_STORE=disabled
PARENT_AUTH_SECRET=
PARENT_HISTORY_RETENTION_DAYS=30
PARENT_HISTORY_MAX_EVENTS=200
KIDBOT_REMOTE_MCP_URL=
```

Production secured posture requires a dedicated `AGENT_SERVICE_TOKEN`; do not reuse `OPENAI_API_KEY` as service auth. Generate a high-entropy token with:

```bash
openssl rand -base64 48
```

When `FALLBACK_WIDGET` is not `1` (secured posture), both `agent-service` and `mcp-server` must receive the same `AGENT_SERVICE_TOKEN`. Direct calls to `agent-service` must include both `Authorization: Bearer <AGENT_SERVICE_TOKEN>` and `x-kidbot-startup-posture: secured`. The MCP server sets both automatically for tool calls. Outside `NODE_ENV=test`, secured startup fails if the token is missing or shorter than 32 characters.

Start self-hosted Redis locally with:

```bash
docker compose -f docker-compose.redis.yml up -d
```

`RATE_LIMIT_STORE=redis` requires `REDIS_URL` and shares route buckets across service replicas. The agent service `/healthz` endpoint reports limiter readiness. `PROVIDER_FAILURE_POLICY=503` makes model-backed failures visible as degraded service responses; set it to `fallback` only when deterministic stub substitution is acceptable.

Before deploying, build both services and run the secured posture smoke check:

```bash
pnpm --filter @kidbot/agent-service run build
pnpm --filter @kidbot/mcp-server run build
pnpm run smoke:secured-posture
```

The smoke check starts local built services on ephemeral ports, verifies MCP can call agent-service with the shared token, and verifies unauthenticated, wrong-posture, and wrong-token calls fail.

### Parent/Session Safety MVP

The widget creates a local `sessionId`, uses the non-PII `profileId` value `local-default`, and stores the locked age band in ChatGPT widget state. Parent controls are gated by a 4-digit session PIN; the PIN is session-scoped widget state only and is not an account, authentication factor, persistent parent identity, or server-side access control.

All child-facing tools use the locked widget age band. MCP and agent-service accept optional `sessionId`, `profileId`, and `ageBand` metadata for safe audit logs, default omitted `ageBand` to `7-9` behaviorally, and do not store profile or session data.

To enable persistent parent profiles and metadata-only session history, set `PARENT_PROFILE_STORE=redis`, provide the same `REDIS_URL`, and set a high-entropy `PARENT_AUTH_SECRET`. MCP issues a server-side parent access token after the widget parent PIN flow and stores only an HMAC hash of that token. This token gates saved profile settings and history reads/writes, but it is still not account identity. Saved history excludes prompts, responses, PINs, service tokens, and generated artifacts. MCP `/healthz` reports parent profile store readiness without exposing secrets or history.

Generate the parent auth secret with:

```bash
openssl rand -base64 48
```

Before deploying Redis-backed parent storage, build the services and run the local Redis smoke:

```bash
pnpm --filter @kidbot/agent-service run build
pnpm --filter @kidbot/mcp-server run build
REDIS_URL=redis://localhost:6379 pnpm run smoke:parent-store-redis
```

The local smoke requires real Redis readiness, verifies `PARENT_AUTH_SECRET` fail-fast startup behavior, checks MCP `/healthz` reports `parentProfileStore.mode: "redis"` and `ready: true`, then creates, updates, and reads a disposable parent profile without storing prompts, responses, PINs, service tokens, generated artifacts, or parent access tokens in history.

After deployment, set `KIDBOT_REMOTE_MCP_URL` to the deployed MCP origin, without `/mcp`, and run:

```bash
pnpm run smoke:parent-store-remote
```

The remote smoke uses only the deployed MCP URL. It never reads, sends, or logs `PARENT_AUTH_SECRET`; it proves secret-backed startup indirectly through Redis health plus successful parent profile create/update/history behavior. A degraded child-tool response is acceptable if it is recorded as safe metadata rather than treated as a safety block.

GitHub Actions also includes the manual `Production Parent Store Smoke` workflow. Store `KIDBOT_REMOTE_MCP_URL` as a protected production environment secret before running it.

### Ngrok (optional)

To expose the MCP server externally for ChatGPT Developer Mode connectors:

```bash
npx ngrok http 3000
```

Use the forwarded HTTPS URL and append `/mcp` when registering the connector endpoint.

### Zero-Install Mode (fallback)

If installs are blocked, you can still preview the widget and flows:

- Open the fallback widget directly:
  - `apps/web-widget/dist/kidbot-fallback.html` in a browser

- Or run the MCP server in fallback mode (if node runs but installs are blocked):
  - set both `FALLBACK_WIDGET=1` and `KIDBOT_LOCAL_DEV=1`, then run `node apps/mcp-server/dist/server.js`
  - (if dist artifacts are unavailable, open /diag statically)

- Health & Diag:
  - `/healthz`  -> shows fallback or dist mode
  - `/diag`     -> links to the fallback widget and fixtures

- CLI shims:
  - `export PATH="$PWD/bin:$PATH"` to use the zero-install `eslint` and `tsc` wrappers

When you regain installs, exit fallback:

- Set `FALLBACK_WIDGET=0`, build widget, run `pnpm run dev`.

(If TypeScript can’t run, keep the static HTML route as the primary experience.)

## Repository Layout

- `apps/mcp-server` – Model Context Protocol bridge exposing Kidbot tools.
- `apps/web-widget` – React widget rendered inside ChatGPT Apps SDK.
- `apps/agent-service` – Express service orchestrating kid-safe content agents.
- Contract integrity guardrail: `apps/agent-service/src/__tests__/contractIntegrity.test.ts` verifies schema parity for MCP <-> agent-service and tool-id consistency for widget <-> MCP.

## Next Steps

- Integrate realtime voice support.
- Add image generation for story and coloring assets.
