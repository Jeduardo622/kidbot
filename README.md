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

Route a task before implementation, either with explicit repository paths or a Git comparison base:

```bash
pnpm run route-task -- apps/web-widget/src tests --json
pnpm run route-task -- --base main --json
```

Verify the same bounded scope before finalization:

```bash
pnpm run verify-change -- apps/web-widget/src tests
pnpm run verify-change -- --base main
```

Classification precedence is `protected` > `standard` > `review-only`. Protected scopes select `pnpm run verify:local` and require human review. Invalid, external, empty, unreadable-policy, and unresolved-Git scopes fail closed. Exit code `0` means routing or selected verification completed successfully; a nonzero exit means the scope was rejected, could not be resolved, or verification failed. The harness is secret-free and never dispatches manual production workflows.

- Authoritative local verification: `pnpm run verify:local` (lint, typecheck, package and root tests, CI-safe provider preflight, and secured-posture smoke; no production secrets required)
- Authoritative recursive test run (packages with a `test` script): `pnpm -r --if-present run test`
- MCP compatibility smoke test (not included in recursive `test`): `pnpm --filter mcp-server run test:compat`
- CI-safe provider preflight config check: `pnpm run smoke:provider-preflight:ci`
- Live provider preflight smoke test (requires real provider secrets and may generate images): `pnpm run smoke:provider-preflight`
- Production MCP story panels smoke test (requires remote MCP URL and may generate images): `pnpm run smoke:production-mcp-story-panels`
- Hosted Railway provider roundtrip smoke test (requires production agent-service auth and may generate images): `pnpm run smoke:railway-provider-roundtrip`
- Root wrapper: `pnpm run test` (runs full recursive package tests when pnpm and workspace dependencies are detectable; otherwise falls back to smoke-only mode)
- If the wrapper prints a smoke-only fallback warning, package Vitest suites were not executed.

### Environment

Copy `.env.example` to `.env` and provide any overrides:

```env
OPENAI_API_KEY=
AGENT_SERVICE_TOKEN=
MCP_PORT=3000
AGENT_PORT=4505
AGENT_BASE_URL=
FALLBACK_WIDGET=0
KIDBOT_LOCAL_DEV=0
RATE_LIMIT_STORE=redis
REDIS_URL=redis://localhost:6379
PROVIDER_FAILURE_POLICY=503
PROVIDER_TIMEOUT_MS=120000
PROVIDER_RETRIES=1
KIDBOT_OPENAI_IMAGE_MODEL=gpt-image-2
KIDBOT_IMAGE_STORAGE_MODE=local
KIDBOT_IMAGE_STORAGE_DIR=.kidbot/generated-images
KIDBOT_IMAGE_PUBLIC_BASE_URL=/generated-images
KIDBOT_IMAGE_MAX_BYTES=2500000
KIDBOT_IMAGE_TTL_SECONDS=86400
KIDBOT_SUPABASE_URL=
KIDBOT_SUPABASE_SERVICE_ROLE_KEY=
KIDBOT_SUPABASE_IMAGE_BUCKET=kidbot-images
KIDBOT_SUPABASE_IMAGE_PREFIX=story-panels
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

For split-service production deploys, set `AGENT_BASE_URL` on MCP to the agent-service origin. If omitted, MCP keeps the local default `http://localhost:${AGENT_PORT}`.

Start self-hosted Redis locally with:

```bash
docker compose -f docker-compose.redis.yml up -d
```

`RATE_LIMIT_STORE=redis` requires `REDIS_URL` and shares route buckets across service replicas. The agent service `/healthz` endpoint reports limiter readiness. `PROVIDER_FAILURE_POLICY=503` makes model-backed failures visible as degraded service responses; set it to `fallback` only when deterministic stub substitution is acceptable.

Provider-backed story panel images default to `KIDBOT_IMAGE_STORAGE_MODE=local`, which writes generated PNGs under `.kidbot/generated-images`, returns `/generated-images/<id>.png` in the existing nullable `imageUrl` field, rejects images larger than `KIDBOT_IMAGE_MAX_BYTES`, and cleans expired assets after `KIDBOT_IMAGE_TTL_SECONDS`. Set `KIDBOT_IMAGE_PUBLIC_BASE_URL` to the public origin/path that serves the agent-service `/generated-images` route when deployed behind a proxy. `KIDBOT_IMAGE_STORAGE_MODE=supabase` uploads generated PNGs to `KIDBOT_SUPABASE_IMAGE_BUCKET` under `KIDBOT_SUPABASE_IMAGE_PREFIX`, returns public Supabase Storage object URLs, and performs best-effort cleanup for expired `exp-...png` objects. In Supabase mode, leave `KIDBOT_IMAGE_PUBLIC_BASE_URL` empty so the service derives `https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>`, or set it to that Supabase public object base explicitly; do not leave it at `/generated-images`. Keep `KIDBOT_SUPABASE_SERVICE_ROLE_KEY` server-only; never expose it to the widget or MCP iframe. `KIDBOT_IMAGE_STORAGE_MODE=data-url` keeps inline `data:image/png;base64,...` URLs for local compatibility but is not preferred for production MCP payload size. Image generation can take longer than short text calls, so `PROVIDER_TIMEOUT_MS=120000` is the documented provider-backed story-panel baseline.

Before deploying, build both services and run the secured posture smoke check:

```bash
pnpm --filter @kidbot/agent-service run build
pnpm --filter @kidbot/mcp-server run build
pnpm run smoke:secured-posture
```

The smoke check starts local built services on ephemeral ports, verifies MCP can call agent-service with the shared token, and verifies unauthenticated, wrong-posture, and wrong-token calls fail.

For CI-safe provider-backed story-panel config coverage, run:

```bash
pnpm run smoke:provider-preflight:ci
```

This non-live check validates the provider preflight helpers, timeout baseline, and expected image URL shape for `local`, `data-url`, and `supabase` storage modes without reading real secrets, calling OpenAI, starting services, or uploading images.

For live provider-backed story-panel readiness, configure real local `.env` values for `OPENAI_API_KEY`, `AGENT_SERVICE_TOKEN`, and the selected image storage mode, then run:

```bash
pnpm run smoke:provider-preflight
```

The live provider preflight first calls OpenAI moderation with a harmless prompt, then starts local agent and MCP services on ephemeral ports, calls `story_panels`, verifies generated `imageUrl` values match the configured storage mode, and fetches the first generated image when the URL is fetchable. Use `pnpm run smoke:provider-preflight -- --moderation-only` for a cheaper key/quota check that does not generate images. The script fails fast if `.env` and `apps/agent-service/.env` contain mismatched provider secrets or if Supabase mode is configured to return local `/generated-images` URLs.

After a Railway production deploy, run the manual `Production Railway Provider Roundtrip Smoke` GitHub Actions workflow. Store `KIDBOT_AGENT_SERVICE_TOKEN` as a protected production environment secret with the deployed agent-service `AGENT_SERVICE_TOKEN` value. The workflow defaults to `https://kidbot-production.up.railway.app`, checks `/healthz`, generates a two-panel story through `/story-panels`, verifies Supabase public image URLs, and fetches the first PNG without logging secrets or full image URLs.

For production MCP connector coverage, run the manual `Production MCP Story Panels Smoke` GitHub Actions workflow. Store `KIDBOT_REMOTE_MCP_URL` as a protected production environment secret with the deployed MCP origin, with or without the `/mcp` suffix. The workflow checks MCP `/healthz`, calls the public MCP `story_panels` tool, verifies two Supabase public image URLs, and fetches the first PNG.

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

### Voice Playback Boundary

The widget currently uses browser `speechSynthesis` for local voice playback. Realtime STT/TTS should be integrated behind the widget voice playback boundary so the existing `voice_chat` tool contract and child-safety flow remain unchanged.
Voice input currently uses browser speech recognition where available and writes captured text into the existing prompt box. Future Realtime STT/TTS should replace the internals behind the voice capture/playback utilities, not the `voice_chat` contract.
Browser speech recognition may ask for microphone permission; unsupported browsers continue to use typed input.

### Story Panel Artwork Boundary

Story panels are image-generation-ready at the widget boundary: each panel preserves `imagePrompt` and nullable `imageUrl`, renders `imageUrl` when present, and otherwise shows a deterministic accessible placeholder. When `OPENAI_API_KEY` is configured and fallback mode is disabled, the agent service uses `KIDBOT_OPENAI_IMAGE_MODEL` to attach generated image URLs to `imageUrl` behind the existing `story_panels` contract. Local storage mode serves those URLs from `/generated-images` with payload size limits and expiry cleanup.
For multi-instance production deploys, prefer `KIDBOT_IMAGE_STORAGE_MODE=supabase` or another external object store over local filesystem storage.

### Voice Capture Manual QA

Browser speech recognition and microphone permission prompts are controlled by the browser and are not reliably covered by jsdom. Before adding Realtime voice behavior, validate the current browser capture flow manually in Chrome or Edge:

```bash
pnpm install
pnpm run dev
```

Open the Vite widget URL printed by the dev server, usually `http://localhost:5173`, then check:

- A supported browser shows `Start Voice Input`.
- Clicking `Start Voice Input` prompts for microphone permission when permission is unset.
- Allowing permission shows `Listening...`; final speech fills the textarea without clicking `Speak`.
- Denying permission returns to `Start Voice Input` and shows `Microphone access is blocked. You can still type your question.`
- No speech, stopping, or aborted capture returns to idle with `Voice input stopped. You can try again or type your question.`
- Unsupported browsers show disabled `Voice Input Unavailable`.
- Typed input and the explicit `Speak` button still work after any capture error.

### Railway Production Deploy

Railway is the first recommended production host for Kidbot because the repo currently runs long-lived Node/Express services plus Redis.

Create one Railway project with:

- `kidbot-agent-service`: build `pnpm install --no-frozen-lockfile && pnpm --filter @kidbot/agent-service run build`; start `pnpm --filter @kidbot/agent-service run start`.
- `kidbot-mcp-server`: build `pnpm install --no-frozen-lockfile && pnpm --filter @kidbot/mcp-server run build`; start `pnpm --filter @kidbot/mcp-server run start`.
- `redis`: Railway Redis service/template.

Set shared Railway env:

```env
NODE_ENV=production
FALLBACK_WIDGET=0
KIDBOT_LOCAL_DEV=0
REDIS_URL=<Railway Redis private URL>
```

Set agent-service env:

```env
PORT=<Railway assigned port>
AGENT_SERVICE_TOKEN=<same high-entropy service token as MCP>
OPENAI_API_KEY=<production OpenAI key>
RATE_LIMIT_STORE=redis
PROVIDER_FAILURE_POLICY=503
PROVIDER_TIMEOUT_MS=120000
KIDBOT_OPENAI_IMAGE_MODEL=gpt-image-2
KIDBOT_IMAGE_STORAGE_MODE=supabase
KIDBOT_IMAGE_STORAGE_DIR=.kidbot/generated-images
KIDBOT_IMAGE_PUBLIC_BASE_URL=https://<project-ref>.supabase.co/storage/v1/object/public/kidbot-images
KIDBOT_IMAGE_MAX_BYTES=2500000
KIDBOT_IMAGE_TTL_SECONDS=86400
KIDBOT_SUPABASE_URL=<Supabase project URL>
KIDBOT_SUPABASE_SERVICE_ROLE_KEY=<server-only Supabase service role key>
KIDBOT_SUPABASE_IMAGE_BUCKET=kidbot-images
KIDBOT_SUPABASE_IMAGE_PREFIX=story-panels
```

Set MCP env:

```env
MCP_PORT=<Railway assigned port>
AGENT_BASE_URL=<agent-service Railway private URL, or public HTTPS URL if private DNS is unavailable>
AGENT_SERVICE_TOKEN=<same high-entropy service token as agent-service>
PARENT_PROFILE_STORE=redis
PARENT_AUTH_SECRET=<high-entropy parent secret>
PARENT_HISTORY_RETENTION_DAYS=30
PARENT_HISTORY_MAX_EVENTS=200
```

Only expose the MCP service publicly for ChatGPT and the remote smoke. Keep agent-service private where Railway supports it; if a public agent URL is temporarily needed, `AGENT_SERVICE_TOKEN` and the secured startup posture still protect direct calls.

After each production deploy, run the manual `Production Railway Provider Roundtrip Smoke` workflow before treating provider-backed story panels as healthy. The workflow requires the protected production environment secret `KIDBOT_AGENT_SERVICE_TOKEN` and may generate provider images.

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
