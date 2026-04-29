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
KIDBOT_LOCAL_DEV=0
RATE_LIMIT_STORE=redis
REDIS_URL=redis://localhost:6379
PROVIDER_FAILURE_POLICY=503
PROVIDER_TIMEOUT_MS=15000
PROVIDER_RETRIES=1
```

When `FALLBACK_WIDGET` is not `1` (secured posture), direct calls to `agent-service` must include both `Authorization: Bearer <AGENT_SERVICE_TOKEN>` and `x-kidbot-startup-posture: secured`. The MCP server sets this header automatically.

Start self-hosted Redis locally with:

```bash
docker compose -f docker-compose.redis.yml up -d
```

`RATE_LIMIT_STORE=redis` requires `REDIS_URL` and shares route buckets across service replicas. The agent service `/healthz` endpoint reports limiter readiness. `PROVIDER_FAILURE_POLICY=503` makes model-backed failures visible as degraded service responses; set it to `fallback` only when deterministic stub substitution is acceptable.

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
  - set `FALLBACK_WIDGET=1` and `KIDBOT_LOCAL_DEV=1`, then run `node apps/mcp-server/dist/server.js`
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
