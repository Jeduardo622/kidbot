# KidBot Monorepo

KidBot is a safety-first creative playground for kids. This monorepo hosts the MCP bridge, the KidBot web widget, and the kid-safe agent service.

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

### Environment

Copy `.env.example` to `.env` and provide any overrides:

```
OPENAI_API_KEY=
MCP_PORT=3000
AGENT_PORT=4505
```

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
  - `node apps/mcp-server/src/server.js` (if ts-node isn’t available, open /diag statically)

- Health & Diag:
  - `/healthz`  -> shows fallback or dist mode
  - `/diag`     -> links to the fallback widget and fixtures

- CLI shims:
  - `export PATH="$PWD/bin:$PATH"` to use the zero-install `eslint` and `tsc` wrappers

When you regain installs, exit fallback:

- Set `FALLBACK_WIDGET=0`, build widget, run `pnpm run dev`.

(If TypeScript can’t run, keep the static HTML route as the primary experience.)

## Repository Layout

- `apps/mcp-server` – Model Context Protocol bridge exposing KidBot tools.
- `apps/web-widget` – React widget rendered inside ChatGPT Apps SDK.
- `apps/agent-service` – Express service orchestrating kid-safe content agents.

## Next Steps

- Integrate realtime voice support.
- Add image generation for story and coloring assets.
