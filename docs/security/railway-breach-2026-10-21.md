# Railway Security Breach - Credential Inventory and Rotation Plan

**Date of Breach Disclosure**: October 21, 2026

**Affected Systems**: Railway-hosted `kidbot-agent-service`, `kidbot-mcp-server`, and Railway-managed Redis instance

**Scope**: All credentials stored in Railway environment variables or accessible to Railway-hosted services must be treated as potentially exposed.

---

## Executive Summary

Railway disclosed a security breach on October 21, 2026. The kidbot repository deploys two services to Railway (`apps/agent-service` and `apps/mcp-server`) plus a Railway-managed Redis instance. Any credential that Railway stored as an environment variable or that Railway-hosted services could read must be rotated.

### Highest-Risk Credentials (Rotate First)

1. **OPENAI_API_KEY** - Direct provider access with billing impact; used by agent-service
2. **KIDBOT_SUPABASE_SERVICE_ROLE_KEY** - Bypasses RLS; full database and storage access
3. **AGENT_SERVICE_TOKEN** - Authenticates MCP→agent calls and parent profile HMAC
4. **REDIS_URL** - Contains auth token; shared rate-limit and parent profile store

### Repository History Findings

- No hardcoded secrets found in commit history (searched for API key patterns, JWT patterns, committed `.env` files)
- Railway configuration files (`railway.json`) contain only build/deploy settings, no credentials
- All credential references in code are environment variable lookups only

---

## Credential Inventory

| Credential Name | Service(s) | Provider | Grants Access To | Blast Radius if Leaked | New Value Location | Reversible / Zero-Downtime | Rotation Order | Status |
|-----------------|-----------|----------|------------------|------------------------|-------------------|---------------------------|----------------|--------|
| `OPENAI_API_KEY` | agent-service | OpenAI | GPT-4 completions, image generation | High: Unmetered API usage, billing fraud, potential data exfiltration via prompt injection | Railway env var (agent-service) | No: New key invalidates old immediately; requires service restart | 1 (highest risk, easy rotation) | not rotated |
| `KIDBOT_SUPABASE_SERVICE_ROLE_KEY` | agent-service | Supabase | Full database and Storage bucket access (bypasses RLS) | Critical: Can read/write/delete all data; access parent profiles if stored; delete generated images | Railway env var (agent-service); Supabase project settings | No: Old key invalidates on rotation; requires service restart | 2 (critical access, easy rotation) | not rotated |
| `KIDBOT_SUPABASE_URL` | agent-service | Supabase | Public project URL (not secret, but paired with service role key) | Low: Public information; risk only when paired with service role key | Railway env var (agent-service) | Yes: URL rarely changes; rotation only needed if project recreated | 3 (paired with service role key) | not rotated |
| `AGENT_SERVICE_TOKEN` | agent-service, mcp-server | Self-managed | MCP→agent authentication, parent profile pseudonymous log HMAC | High: Allows unauthenticated calls to agent-service; can forge parent profile references | Railway env vars (both services); GitHub Actions secret (`KIDBOT_AGENT_SERVICE_TOKEN`) | No: Shared secret must be updated atomically on both services; brief window of 401s during restart | 4 (after upstream providers) | not rotated |
| `REDIS_URL` | agent-service, mcp-server | Railway Redis | Rate-limit store, request control store, parent profile store | High: Can read parent profiles, manipulate rate limits, access consented history | Railway-managed service connection string | No: New Redis instance or password invalidates old URL; requires both services restart | 5 (coordinated rotation, both services) | not rotated |
| `PARENT_AUTH_SECRET` | mcp-server | Self-managed | Parent profile creation/access HMAC (only when `PARENT_PROFILE_STORE=redis`) | High: Can forge parent profile tokens; access consented history | Railway env var (mcp-server) | No: Existing parent tokens become invalid; requires re-auth; service restart | 6 (after Redis, if enabled) | not rotated |
| `KIDBOT_REMOTE_MCP_URL` | N/A (GitHub Actions only) | Self-managed | Public MCP service endpoint for smoke tests | Low: Public URL; only used in CI read-only smoke tests | GitHub Actions secret (production environment) | Yes: URL change only; no authentication token | 7 (low risk, CI only) | not rotated |
| `PORT` | agent-service | Railway platform | Railway-assigned service port | None: Platform-managed, not a secret | Railway auto-injected | N/A: Platform-managed | N/A | N/A |
| `MCP_PORT` | mcp-server | Railway platform | Railway-assigned service port | None: Platform-managed, not a secret | Railway auto-injected | N/A: Platform-managed | N/A | N/A |
| `NODE_ENV` | agent-service, mcp-server | Self-managed | Runtime environment mode | None: Configuration flag, not a secret | Railway env vars | N/A: Not a credential | N/A | N/A |
| `AGENT_BASE_URL` | mcp-server | Self-managed | Internal routing to agent-service (Railway private URL) | Low: Private network routing; exposure enables direct agent calls (still gated by `AGENT_SERVICE_TOKEN`) | Railway env var (mcp-server) | Yes: URL change only; already protected by token auth | 8 (low risk, paired with token) | not rotated |
| `KIDBOT_WIDGET_DOMAIN` | mcp-server | Self-managed | CORS origin for widget (Railway public MCP URL) | None: Public domain; CORS policy, not a credential | Railway env var (mcp-server) | N/A: Public configuration | N/A | N/A |
| `KIDBOT_WIDGET_RESOURCE_DOMAINS` | mcp-server | Self-managed | Additional CORS origins for resources (e.g., Supabase CDN) | None: Public configuration; CORS policy | Railway env var (mcp-server) | N/A: Public configuration | N/A | N/A |

### GitHub Actions Secrets (Used in Workflows)

| Secret Name | Workflow(s) | Purpose | Blast Radius | Rotation Required | Status |
|-------------|-------------|---------|--------------|-------------------|--------|
| `KIDBOT_AGENT_SERVICE_TOKEN` | `production-railway-provider-smoke.yml` | Authenticates CI smoke test to agent-service | Medium: Read-only smoke test access; no write permissions | Yes: Must match rotated `AGENT_SERVICE_TOKEN` | not rotated |
| `KIDBOT_REMOTE_MCP_URL` | `deploy-verify.yml`, `nightly-production-smoke.yml`, `production-mcp-story-panels-smoke.yml`, `production-parent-store-smoke.yml`, `production-widget-story-panels-smoke.yml` | Public MCP endpoint for CI smoke tests | Low: Public URL; read-only testing | No: Public information; update when domain changes | not rotated |
| `OPENAI_API_KEY` | `provider-evaluation.yml` | Records real provider output for weekly evaluation | High: Direct OpenAI API access; billing fraud risk | Yes: Independent key, should rotate regardless | not rotated |
| `github.token` | `nightly-production-smoke.yml` | Automatic GitHub token for issue creation/commenting | Low: Scoped to repository; auto-rotated by GitHub | No: GitHub-managed, ephemeral | N/A |

### Railway Platform Credentials

| Credential Type | Purpose | Blast Radius | Rotation Required | Status |
|-----------------|---------|--------------|-------------------|--------|
| Railway project owner/admin access tokens | Deploy services, manage env vars, access logs | Critical: Full project control; can read all env vars, redeploy services, access logs | Yes: Assume exposed | not rotated |
| Railway API tokens (if used in CI/scripts) | None found: No `railway` CLI usage in scripts or workflows; deploys appear to be push-to-main auto-deploy | N/A | N/A | N/A |

---

## Rotation Plan

### Phase 1: Upstream Provider Credentials (Immediate)

**Order 1: `OPENAI_API_KEY`** (agent-service)
- **Action**: Generate new secret key in OpenAI dashboard; update Railway env var; restart agent-service
- **Reversibility**: No - old key immediately invalid
- **Downtime**: Brief restart window (~30s)
- **Verification**: `/healthz` reports `provider: openai`, `ready: true`; run `smoke:railway-provider-roundtrip`
- **Dependencies**: Update `OPENAI_API_KEY` in GitHub Actions secret (production environment) for `provider-evaluation.yml` workflow

**Order 2: `KIDBOT_SUPABASE_SERVICE_ROLE_KEY` + `KIDBOT_SUPABASE_URL`** (agent-service)
- **Action**: Rotate service role key in Supabase project settings; update Railway env var; restart agent-service
- **Reversibility**: No - old key invalidates on rotation
- **Downtime**: Brief restart window (~30s); image upload/cleanup temporarily unavailable
- **Verification**: `/healthz` reports `imageStorage.ready: true`, `imageStorage.mode: supabase`; verify public image URL generation
- **Note**: URL only changes if project is recreated; current URL is public info

### Phase 2: Shared Internal Secrets (Coordinated)

**Order 3: `AGENT_SERVICE_TOKEN`** (agent-service, mcp-server, GitHub Actions)
- **Action**: Generate new high-entropy token (`openssl rand -base64 48`); update Railway env vars on both services atomically; update GitHub Actions secret `KIDBOT_AGENT_SERVICE_TOKEN`; restart both services
- **Reversibility**: No - shared secret must match on both services
- **Downtime**: Brief 401 window during staggered restart (~1 minute); existing widget sessions may fail MCP calls
- **Verification**: MCP `/healthz` reports `agentService.reachable: true`, `agentService.authenticated: true`; run all production smoke tests
- **Dependencies**: Must update 3 locations: Railway agent-service, Railway mcp-server, GitHub Actions production environment

**Order 4: `REDIS_URL`** (agent-service, mcp-server)
- **Action Option A**: Create new Railway Redis instance; update connection string in both services; migrate data if needed; restart both services
- **Action Option B**: Rotate Redis password via Railway dashboard (if supported); update connection string; restart both services
- **Reversibility**: No - old URL/password invalid
- **Downtime**: Brief restart window; rate limits reset; parent profiles temporarily unavailable during restart
- **Verification**: Both `/healthz` endpoints report Redis store readiness; run `smoke:parent-store-remote` if enabled
- **Note**: Parent profiles and rate-limit state may need cold-start or migration

**Order 5: `PARENT_AUTH_SECRET`** (mcp-server, only if `PARENT_PROFILE_STORE=redis`)
- **Action**: Generate new high-entropy secret (`openssl rand -base64 48`); update Railway env var; restart mcp-server
- **Reversibility**: No - existing parent profile tokens become invalid; users must re-authenticate
- **Downtime**: Brief restart; all existing parent sessions invalidated
- **Verification**: MCP `/healthz` reports parent store readiness; test create/retrieve parent profile flow
- **Impact**: All existing parent accounts must re-authenticate; consented history inaccessible with old tokens

### Phase 3: Low-Risk Configuration (Deferred)

**Order 6: `AGENT_BASE_URL`** (mcp-server)
- **Action**: If using Railway private networking, regenerate private domain (if supported); update Railway env var; restart mcp-server
- **Reversibility**: Yes - URL change only; protected by `AGENT_SERVICE_TOKEN` regardless
- **Downtime**: Brief restart window
- **Verification**: MCP `/healthz` reports `agentService.reachable: true`
- **Note**: Low risk; agent calls already gated by token auth

**Order 7: Railway Platform Access Tokens**
- **Action**: Revoke all Railway API tokens; rotate team member access; enable 2FA if not already required
- **Reversibility**: Varies by token type
- **Downtime**: None for ephemeral tokens; may require re-authentication
- **Verification**: Audit Railway team access logs

---

## GitHub Actions Secret Rotation

The following GitHub Actions secrets must be rotated **after** their Railway counterparts:

1. **`KIDBOT_AGENT_SERVICE_TOKEN`** (production environment)
   - Update after rotating `AGENT_SERVICE_TOKEN` on Railway services
   - Used by: `production-railway-provider-smoke.yml`
   
2. **`OPENAI_API_KEY`** (production environment)
   - Independent key for CI evaluation runs; rotate separately from Railway agent-service key
   - Used by: `provider-evaluation.yml`

3. **`KIDBOT_REMOTE_MCP_URL`** (production environment)
   - Public URL; only update if MCP domain changes post-breach
   - Used by: Multiple smoke test workflows

---

## Secrets Committed to Repository History

**Search Performed**:
- Checked for hardcoded API keys (e.g., `sk-` prefix for OpenAI)
- Checked for JWT patterns (e.g., `eyJ` prefix)
- Searched commit history for `.env` file additions
- Searched commit messages and diffs for credential mentions

**Findings**: ✅ **No hardcoded secrets found in repository history.**

- All credential references in code are environment variable lookups (`process.env.*`)
- `.env.example` files contain placeholder values only (no real credentials)
- `railway.json` files contain build/deploy configuration only (no secrets)
- Test files use synthetic/stub credentials (e.g., `'server-secret-key'`, `'synthetic-private-key'`)

**Specific Commits Reviewed**:
- `8720ec3c2f786ac9174b4711de609d58598347ab`: Added `.env.example` (no credentials)
- `3c8881c0149b189ae27c26a9de811cabfd225890`: Added `.env.example` (no credentials)
- `e8721af69aceb0dc3d3ca399e28316d700062aed`: Added `.env.example` (no credentials)

---

## Post-Rotation Verification Checklist

After each rotation phase:

- [ ] **Phase 1 (OpenAI + Supabase)**:
  - [ ] Agent `/healthz` reports `provider: openai`, `ready: true`
  - [ ] Agent `/healthz` reports `imageStorage.ready: true`, `imageStorage.mode: supabase`
  - [ ] Run `pnpm run smoke:railway-provider-roundtrip` (requires rotated GitHub Actions secret)
  - [ ] Verify generated image URLs are publicly accessible
  - [ ] Run `provider-evaluation.yml` workflow with new GitHub Actions `OPENAI_API_KEY`

- [ ] **Phase 2 (Shared Secrets)**:
  - [ ] MCP `/healthz` reports `productionReady: true`
  - [ ] MCP `/healthz` reports `agentService.reachable: true`, `agentService.authenticated: true`
  - [ ] Agent `/healthz` reports rate-limit store `ready: true`
  - [ ] MCP `/healthz` reports request control store `ready: true`
  - [ ] Run all production smoke workflows:
    - `deploy-verify.yml` (push to main)
    - `nightly-production-smoke.yml`
    - `production-mcp-story-panels-smoke.yml`
    - `production-parent-store-smoke.yml` (if enabled)
    - `production-widget-story-panels-smoke.yml`
  - [ ] If `PARENT_PROFILE_STORE=redis`: Run `pnpm run smoke:parent-store-remote`

- [ ] **Phase 3 (Low-Risk)**:
  - [ ] MCP `/healthz` reports `agentService.reachable: true` after `AGENT_BASE_URL` change
  - [ ] Audit Railway team access logs for unauthorized activity

- [ ] **Final Verification**:
  - [ ] All Railway environment variables reviewed and rotated
  - [ ] All GitHub Actions secrets reviewed and updated
  - [ ] Railway team access audited; unauthorized members removed; 2FA enforced
  - [ ] Monitor OpenAI billing for 7 days post-rotation for anomalous usage
  - [ ] Monitor Supabase access logs for 7 days post-rotation for anomalous queries
  - [ ] Review Railway service logs for October 21, 2026 and surrounding dates for unauthorized access

---

## Notes

- **Zero-Downtime Not Possible**: Most rotations require service restarts; expect brief unavailability windows.
- **Parent Profile Impact**: Rotating `PARENT_AUTH_SECRET` or `REDIS_URL` invalidates existing parent sessions; users must re-authenticate.
- **Rate Limit Reset**: Rotating `REDIS_URL` (new instance) resets all rate-limit state; cold start may allow brief over-limit access.
- **Billing Monitoring**: Monitor OpenAI billing closely for 30 days post-breach for unauthorized usage before October 21, 2026.
- **Incident Response**: Review Railway service logs from October 1-21, 2026 for evidence of unauthorized access or data exfiltration.

---

## References

- Railway breach disclosure: (link not provided in task context)
- Deployment runbook: `docs/deployment-runbook.md`
- Agent service config: `apps/agent-service/src/config.ts`
- MCP server config: `apps/mcp-server/src/config.ts`
- Railway configs: `apps/agent-service/railway.json`, `apps/mcp-server/railway.json`
- GitHub Actions workflows: `.github/workflows/`
- Environment variable examples: `.env.example`, `apps/agent-service/.env.example`
