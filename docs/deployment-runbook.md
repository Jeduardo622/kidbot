# Reviewed deployment runbook

No deployment is performed by this implementation. Resolve the audience/privacy gates in `release-review.md` and obtain protected-path review before selecting a release SHA.

## Build and configuration

Keep the repository root as the Docker build context. Select the service-specific Railway JSON config explicitly; simply committing a nested config does not attach it to an existing service. Use `apps/agent-service/Dockerfile` or `apps/mcp-server/Dockerfile`. Both run as the non-root `node` user, use Node 20 and pnpm 8.15.8, and install from the frozen lockfile. The MCP image builds the widget before checking references and compiling the server. `.dockerignore` excludes credentials, dependencies and generated output.

Build locally:

```sh
docker build -f apps/agent-service/Dockerfile -t kidbot-agent-review .
docker build -f apps/mcp-server/Dockerfile -t kidbot-mcp-review .
```

Configure exact project, environment and service targets from operator-owned records. No example value is a target authorization. Preserve existing secret values; do not place secrets in Docker arguments, commits or logs.

- Both services: `NODE_ENV=production`, `FALLBACK_WIDGET=0`, high-entropy matching service token, shared private Redis URL.
- Agent: real server-only OpenAI key, `KIDBOT_STUB_PROVIDER=0`, `RATE_LIMIT_STORE=redis`, `PROVIDER_FAILURE_POLICY=503`, bounded storage. Prefer the existing Supabase public-image contract for split/multi-instance deployments; readiness verifies bucket metadata and public access configuration, not a paid image generation. Local storage requires a writable persistent volume owned by the runtime user and an absolute public asset base URL reachable by the widget.
- MCP: `MCP_REQUEST_CONTROL_STORE=redis`, explicit parent-store mode and parent secret if enabled, correct `AGENT_BASE_URL`, exact HTTPS widget/resource origins, and `MCP_PORT` matching the Railway domain target port.
- MCP browser origins: production bounds `/mcp` to the ChatGPT origins plus `KIDBOT_WIDGET_DOMAIN` even when nothing is set. `KIDBOT_MCP_ALLOWED_ORIGINS` replaces that list with exact HTTPS origins, comma separated. A request with no `Origin` header is a server-to-server MCP client and always passes; a request carrying an unlisted browser origin is refused with 403 before it can spend admission budget. `/healthz` reports `originPolicy`.
- Private networking: keep agent-service off a public domain. Point MCP at `http://<agent private domain>:<AGENT_PORT>` and confirm `agentService.reachable` on the MCP `/healthz` before removing the agent's public domain. Railway private networking is IPv6-only, so the agent must listen on all interfaces, which `app.listen(port)` does.
- Set agent `PORT` to the configured service port. Keep agent-service private when possible; expose only MCP publicly.
- Defaults: total agent 30s / story 180s; outer MCP 35s / story 185s. Keep overridden outer values above agent totals. Make infrastructure request timeouts compatible; do not extend leases or bypass rate limits merely to hide timeouts.

## Rollout order

1. Record approved SHA, current deployment identifiers, previous image/config, target IDs, migration status (none added here), and rollback command for the selected services.
2. Build and verify frozen artifacts; record image digests and exact-head CI. Do not deploy a dirty worktree as a reviewed SHA.
3. Deploy the agent first. Its `/healthz` must return 200 with `ready: true`, provider mode `openai`, ready shared limiter and ready image storage. `/livez` is process liveness only.
4. Deploy MCP. `/healthz` must return 200 with `productionReady: true`, the React `dist` artifact, shared store readiness, and a downstream agent explicitly reporting `ready: true`. An old agent without the field is intentionally not production-ready.
5. `Deploy Verify` runs automatically on every push to main: it waits for both services to report the pushed commit in `/healthz` `release.commit` and a production-ready posture, then re-checks the widget artifact. A red run means the deploy did not land, not that the code is wrong.
6. Run the existing manual protected post-deploy workflows for widget distribution, provider-backed story panels, parent Redis create/history/delete and provider roundtrip. They may incur provider costs and synthetic writes; dispatch only against the reviewed target and approval.
7. Record actual generated output/retrieval and parent-store cleanup, then verify all four activities in the supported host. Health checks alone do not prove credentials are accepted by OpenAI or that generated content is suitable.

## Rollback and shutdown

If readiness, provider safety, storage or host checks fail, halt promotion and restore the prior reviewed service images and compatible configuration; no schema change was introduced. Recheck both services and the prior feature contracts after rollback. Keep a previous known-good widget artifact together with its compatible MCP image.

SIGTERM/SIGINT mark services draining, refuse new work, wait for admitted requests, then force-close stuck connections at the bounded deadline. This can cancel a long story during replacement; clients must receive a retry-safe failure rather than stale or unmoderated output. Do not count a force-close as a successful request.

Generated images retain the disclosed 24-hour expiry target with periodic best-effort cleanup, not a hard deletion guarantee. The current Supabase sweep handles at most 1000 objects per pass; monitor and resolve cleanup backlog before approving workloads that can exceed that rate. Never describe profile deletion as immediate image deletion.

## Ongoing verification

- `Deploy Verify` (push to main): waits for the pushed commit to be live on both services. Read-only, no provider spend.
- `Nightly Production Smoke` (daily 09:17 UTC): release posture, widget artifact, and one provider-backed two-panel story. Opens or comments on a `nightly-smoke` issue when it fails.
- `Provider Output Evaluation` (Mondays 08:40 UTC): records one real model response per corpus case and scores it with the deterministic rubric. Requires an `OPENAI_API_KEY` secret in the protected production environment. Recorded output is scored in-run and never committed.
- Host checks a workflow cannot make are in `chatgpt-host-validation.md`; run that list before any submission.
