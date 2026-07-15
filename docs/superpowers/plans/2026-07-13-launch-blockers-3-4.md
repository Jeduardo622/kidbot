# Launch Blockers 3 and 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver submission-ready ChatGPT iframe/tool metadata and explicit, deletable, time-bounded optional parent history without persisting PINs or bearer tokens in host widget state.

**Architecture:** Add current MCP Apps registration helpers and central metadata/output contracts around the existing MCP server. Make consent a deliberate in-memory widget state transition, extend both parent stores with equivalent purge/deletion/expiry semantics, minimize logged identifiers, and serve one accurate privacy contract from the deployed MCP service.

**Tech Stack:** TypeScript, React, Zod, MCP TypeScript SDK 1.28, `@modelcontextprotocol/ext-apps`, Express, Redis/ioredis, Vitest, Node test runner.

## Global Constraints

- Production CSP resource allowlists contain exact HTTPS origins only; no wildcards, paths, queries, fragments, or credentials.
- Production resource domain is `https://rxnwualzddplucjhclij.supabase.co`; widget connect domains remain empty.
- PINs, parent bearer tokens, unlock state, history state, and persistent profile IDs never enter ChatGPT widget state.
- Optional profile/history retention is 30 days and history opt-in is unchecked by default.
- Disabling history purges saved history immediately; profile deletion invalidates the token and removes all profile-owned metadata.
- Generated images are public and use a 24-hour expiry target with periodic best-effort cleanup; profile deletion does not claim immediate image deletion.
- No COPPA, GDPR-K, or legal-certification claim is introduced.
- Every behavior change follows red-green-refactor and every protected change receives reviewer, safety, tester, and UI-hardener review.

---

### Task 1: Current MCP Apps resource contract

**Files:**
- Modify: `apps/mcp-server/package.json`
- Modify: `.env.example`
- Modify: `apps/mcp-server/src/config.ts`
- Create: `apps/mcp-server/src/widgetMetadata.ts`
- Modify: `apps/mcp-server/src/server.ts`
- Test: `apps/mcp-server/test/auth-startup-matrix.test.mjs`
- Test: `apps/mcp-server/test/mcp-compat.test.mjs`

**Interfaces:**
- Produces: `widgetResourceUri`, `createWidgetResourceMeta(config, mode)`, and validated `widgetResourceDomains`/`widgetDomain` config.
- Consumes: existing `McpServerConfig`, `Mode`, widget HTML resolution, and MCP HTTP smoke helpers.

- [ ] **Step 1: Add failing production-config tests**

Add cases that parse:

```js
{
  NODE_ENV: 'production',
  AGENT_SERVICE_TOKEN: 'a'.repeat(32),
  MCP_REQUEST_CONTROL_STORE: 'redis',
  KIDBOT_WIDGET_DOMAIN: 'https://kidbot-production.up.railway.app',
  KIDBOT_WIDGET_RESOURCE_DOMAINS: 'https://rxnwualzddplucjhclij.supabase.co'
}
```

and assert exact normalized arrays. Add rejection cases for `http://`, `https://*.supabase.co`, origins with paths/query/fragment/credentials, and missing production values.

- [ ] **Step 2: Run the config tests and verify RED**

Run: `pnpm --filter @kidbot/mcp-server run build && node --test apps/mcp-server/test/auth-startup-matrix.test.mjs --test-name-pattern="widget CSP"`

Expected: FAIL because `McpServerConfig` has no widget domain fields and startup accepts missing CSP configuration.

- [ ] **Step 3: Implement strict origin parsing and metadata creation**

Add config fields:

```ts
widgetDomain: string;
widgetResourceDomains: string[];
```

Implement an exact-origin parser that requires `url.origin === trimmedWithoutTrailingSlash`, `https:`, no credentials, and no `*`. Require both production values when `NODE_ENV === 'production'`; use `https://web-sandbox.oaiusercontent.com` and an empty resource list outside production.

Create `widgetMetadata.ts` with standard and compatibility metadata:

```ts
export const widgetResourceUri = 'ui://widget/kidbot-v2.html';
export const createWidgetResourceMeta = (config: McpServerConfig, mode: Mode) => ({
  ui: {
    prefersBorder: true,
    domain: config.widgetDomain,
    csp: { connectDomains: [], resourceDomains: config.widgetResourceDomains },
  },
  'openai/widgetDescription': 'Kidbot — safe creative play: voice, comics, coloring, science.',
  'openai/widgetPrefersBorder': true,
  'openai/widgetDomain': config.widgetDomain,
  'openai/widgetCSP': {
    connect_domains: [],
    resource_domains: config.widgetResourceDomains,
  },
  mode,
});
```

Add `@modelcontextprotocol/ext-apps` version `1.7.4` and register the resource with `registerAppResource` and `RESOURCE_MIME_TYPE`.

- [ ] **Step 4: Add and run failing/passing MCP resource metadata tests**

Assert `resources/list` and `resources/read` both return `text/html;profile=mcp-app`, the versioned URI, identical standard/legacy CSP, exact resource origin once, empty connect lists, and the configured widget domain.

Run: `pnpm --filter @kidbot/mcp-server run test:compat`

Expected after implementation: PASS.

- [ ] **Step 5: Commit the resource contract**

```bash
git add apps/mcp-server/package.json .env.example apps/mcp-server/src/config.ts apps/mcp-server/src/widgetMetadata.ts apps/mcp-server/src/server.ts apps/mcp-server/test/auth-startup-matrix.test.mjs apps/mcp-server/test/mcp-compat.test.mjs
git commit -m "feat: declare submission-ready widget metadata"
```

### Task 2: Exact tool output and impact contracts

**Files:**
- Modify: `apps/mcp-server/src/schema.ts`
- Create: `apps/mcp-server/src/toolContracts.ts`
- Modify: `apps/mcp-server/src/tools.ts`
- Test: `apps/mcp-server/test/mcp-compat.test.mjs`
- Test: `apps/mcp-server/test/auth-startup-matrix.test.mjs`

**Interfaces:**
- Consumes: `widgetResourceUri`, existing input schemas, and all current tool result shapes.
- Produces: one `registerKidbotTool` wrapper, common error/blocked/degraded schemas, and exact per-tool success schemas.

- [ ] **Step 1: Write failing descriptor tests for all current tools**

For every current tool, assert a title, JSON `outputSchema`, `securitySchemes: [{type:'noauth'}]`, mirrored `_meta.securitySchemes`, standard `_meta.ui.resourceUri`, compatibility template URI, and all four required impact annotations. Assert history list is state-changing and non-idempotent because authorized views renew retention, generation tools are not read-only/open-world, and create/update are state-changing/closed-world.

- [ ] **Step 2: Run tool descriptor tests and verify RED**

Run: `pnpm --filter @kidbot/mcp-server run test:compat`

Expected: FAIL because current tools expose only input schemas and `openai/widgetAccessible`.

- [ ] **Step 3: Implement the registration wrapper and output unions**

Use `registerAppTool` and a descriptor factory equivalent to:

```ts
const noAuth = [{ type: 'noauth' as const }];

export const createToolMeta = () => ({
  securitySchemes: noAuth,
  ui: { resourceUri: widgetResourceUri, visibility: ['model', 'app'] },
  'openai/outputTemplate': widgetResourceUri,
  'openai/widgetAccessible': true,
});

export const commonFailureSchema = z.union([
  z.object({ blocked: z.literal(true), message: z.string() }),
  z.object({ blocked: z.literal(false), degraded: z.literal(true), message: z.string(), fallbackReason: z.string().optional(), correlationId: z.string().optional() }),
  z.object({ error: z.literal(true), code: z.enum(['rate_limited', 'concurrency_limited', 'request_timeout']), retryAfter: z.number().int().positive().optional() }),
]);
```

Each tool output is `z.union([successSchema, commonFailureSchema])`. Register all tools with accurate annotations and ensure every emitted `structuredContent` parses under its descriptor.

- [ ] **Step 4: Add runtime result validation tests**

Call one fixture success, moderation block, degraded response, and request-control rejection. Validate each `structuredContent` with the advertised JSON schema using the compatibility test's existing MCP client path.

Run: `pnpm --filter @kidbot/mcp-server run test:compat && pnpm --filter @kidbot/mcp-server run test:auth-matrix`

Expected: PASS.

- [ ] **Step 5: Commit tool contracts**

```bash
git add apps/mcp-server/src/schema.ts apps/mcp-server/src/toolContracts.ts apps/mcp-server/src/tools.ts apps/mcp-server/test/mcp-compat.test.mjs apps/mcp-server/test/auth-startup-matrix.test.mjs
git commit -m "feat: declare Kidbot tool output contracts"
```

### Task 3: Explicit profile consent, expiry, purge, and deletion

**Files:**
- Modify: `apps/mcp-server/src/schema.ts`
- Modify: `apps/mcp-server/src/parentStore.ts`
- Modify: `apps/mcp-server/src/tools.ts`
- Test: `apps/mcp-server/test/parent-store.test.mjs`
- Test: `apps/mcp-server/test/auth-startup-matrix.test.mjs`
- Modify: `scripts/smoke-parent-store.mjs`

**Interfaces:**
- Produces: `parentProfileDeleteSchema`, `ParentProfileStore.deleteProfile`, purge-on-disable, and 30-day profile/token expiry.
- Consumes: request-control wrapper and tool-contract registration from Task 2.

- [ ] **Step 1: Write memory-store RED tests**

Add cases proving create rejects absent/false consent, expired profiles cannot validate/list/update, disabling history returns `historyEnabled:false` and empties all events, deletion invalidates the token, and one token cannot delete another profile.

- [ ] **Step 2: Run memory tests and verify RED**

Run: `node --test apps/mcp-server/test/parent-store.test.mjs`

Expected: FAIL because memory profiles never expire and no deletion method exists.

- [ ] **Step 3: Implement memory expiry, purge, and deletion**

Change create input to `{sessionId, ageBand, historyEnabled: true}`. Store `expiresAt` internally, prune expired profiles and owned session/event maps before authorization, renew on authorized access, purge owned events when history becomes false, and implement:

```ts
deleteProfile(input: { profileId: string; parentAccessToken: string }): Promise<{ deleted: true; profileId: string }>;
```

The disabled store returns no token and a deterministic `{deleted:true}` only for `local-default` is not allowed; deletion without persistent storage must fail rather than claim deletion.

- [ ] **Step 4: Write Redis integration RED tests**

Use disposable Redis keys to assert positive PTTL on profile/session/index/event keys, renewal after authorized use, full key removal after disable/delete, invalid token after delete, and rejection of a foreign token.

Run: `REDIS_URL=redis://localhost:6379 pnpm run smoke:parent-store-redis`

Expected before Redis implementation: FAIL on missing profile TTL and deletion tool.

- [ ] **Step 5: Implement atomic Redis operations**

Create/update must set profile `EX retentionSeconds`. Authorization paths renew the profile and all owned keys. Use Lua for purge/delete: authenticate the stored token hash in TypeScript first, then pass the expected profile ID to a script that re-checks the stored profile identity, enumerates the profile session sorted set, deletes each session and event list, and finally deletes the profile and index. Update-to-disabled preserves the profile/token but deletes the history keys; delete removes everything.

- [ ] **Step 6: Register and verify `parent_profile_delete`**

Add the destructive closed-world tool with `destructiveHint:true`, request controls, authenticated input schema, output `{deleted:true, profileId}` and negative auth matrix cases. Extend local/remote smoke to create, record, delete, then prove the old token cannot read.

Run: `pnpm --filter @kidbot/mcp-server run test:parent-store && pnpm --filter @kidbot/mcp-server run test:auth-matrix`

Expected: PASS.

- [ ] **Step 7: Commit store semantics**

```bash
git add apps/mcp-server/src/schema.ts apps/mcp-server/src/parentStore.ts apps/mcp-server/src/tools.ts apps/mcp-server/test/parent-store.test.mjs apps/mcp-server/test/auth-startup-matrix.test.mjs scripts/smoke-parent-store.mjs
git commit -m "feat: add consent-bound parent data deletion"
```

### Task 4: Secret-free widget state and explicit consent UI

**Files:**
- Modify: `apps/web-widget/src/main.tsx`
- Modify: `apps/web-widget/src/styles.css`
- Test: `apps/web-widget/src/App.sessionState.test.tsx`

**Interfaces:**
- Consumes: `parent_profile_create`, `parent_profile_update`, and `parent_profile_delete` contracts.
- Produces: in-memory `ParentCredentialState` and explicit consent/delete UI.

- [ ] **Step 1: Replace old positive-persistence tests with RED privacy tests**

Inject host state containing `parentPin`, `parentPinSet`, `parentAccessToken`, `parentModeUnlocked`, `historyEnabled`, and a persistent profile ID. Assert the app ignores all of them, starts locked with `local-default`, and every `setWidgetState` payload has exactly `ageBand`, `sessionId`, and `tab`.

Add tests proving PIN setup does not call a tool, unchecked history remains local, checked opt-in calls create with `historyEnabled:true`, failures show `History could not be enabled`, disable calls update with `historyEnabled:false`, and delete clears the active profile only after a successful tool result.

- [ ] **Step 2: Run widget tests and verify RED**

Run: `pnpm --filter web-widget test -- App.sessionState.test.tsx`

Expected: FAIL because current code restores/persists credentials and silently creates history during PIN setup.

- [ ] **Step 3: Implement in-memory credentials and consent controls**

Split state so host-persisted state is:

```ts
interface PersistedWidgetState {
  ageBand: AgeBand;
  sessionId: string;
  tab: TabKey;
}
```

Keep `parentPin`, `parentModeUnlocked`, `historyEnabled`, `profileId`, and `parentAccessToken` in React memory only. Add an unchecked checkbox with 30-day metadata copy, visible pending/error status, an off action that purges history, and a destructive delete button. Never swallow a persistence error.

- [ ] **Step 4: Run widget tests and accessibility-focused assertions**

Run: `pnpm --filter web-widget test -- App.sessionState.test.tsx`

Expected: PASS with checkbox label, status live region, disabled pending controls, and delete confirmation copy present.

- [ ] **Step 5: Commit widget privacy controls**

```bash
git add apps/web-widget/src/main.tsx apps/web-widget/src/styles.css apps/web-widget/src/App.sessionState.test.tsx
git commit -m "feat: require explicit parent history consent"
```

### Task 5: Pseudonymous logs and published privacy contract

**Files:**
- Create: `apps/agent-service/src/privacyLog.ts`
- Modify: `apps/agent-service/src/config.ts`
- Modify: `apps/agent-service/src/index.ts`
- Test: `apps/agent-service/src/__tests__/serviceAuthBoundary.test.ts`
- Create: `PRIVACY.md`
- Create: `apps/mcp-server/src/privacyPolicy.ts`
- Modify: `apps/mcp-server/src/server.ts`
- Test: `apps/mcp-server/test/auth-startup-matrix.test.mjs`
- Modify: `README.md`
- Modify: `EXECUTSPEC.md`
- Modify: `.env.example`

**Interfaces:**
- Produces: `createLogSubject(secret, kind, value)`, `/privacy`, and one source-backed privacy disclosure.
- Consumes: service auth secret, existing Express request summary, and exact retention/deletion behavior from Task 3.

- [ ] **Step 1: Write failing privacy-log tests**

Capture `console.log` for an authorized request containing raw profile/session IDs and tokens. Assert serialized output contains neither raw ID, prompt, token, nor full image URL and contains stable `sessionRef`/`profileRef` values matching `^[A-Za-z0-9_-]{16,64}$` when a secret is configured.

- [ ] **Step 2: Run log tests and verify RED**

Run: `pnpm --filter @kidbot/agent-service test -- serviceAuthBoundary.test.ts`

Expected: FAIL because current summary logs raw `sessionId` and `profileId`.

- [ ] **Step 3: Implement keyed log references**

Implement:

```ts
export const createLogSubject = (secret: string | undefined, kind: 'session' | 'profile', value: string | undefined) =>
  secret && value
    ? createHmac('sha256', secret).update(`${kind}:${value}`).digest('base64url').slice(0, 24)
    : undefined;
```

Emit `sessionRef`/`profileRef`, never raw identifiers. Use `AGENT_SERVICE_TOKEN` as the key in secured posture and omit references in local fallback.

- [ ] **Step 4: Write failing privacy route/contract tests**

Request `/privacy` and assert 200 HTML includes the OpenAI, Railway, Supabase, browser speech, 30-day history, 24-hour image, deletion limitation, and contact sections. Assert README/EXECUTSPEC no longer claim session-only data or legal alignment contrary to runtime.

- [ ] **Step 5: Publish and serve the accurate policy**

Write `PRIVACY.md` with the exact disclosures in the design and use `https://github.com/Jeduardo622/kidbot/issues` as the documented deletion/support contact. Export escaped static HTML from `privacyPolicy.ts` and serve it at `/privacy` with a link from `/diag`. Reconcile README and `EXECUTSPEC.md`; label privacy/legal review as required before public launch.

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm --filter @kidbot/agent-service test -- serviceAuthBoundary.test.ts && pnpm --filter @kidbot/mcp-server run test:auth-matrix`

Expected: PASS.

```bash
git add apps/agent-service/src/privacyLog.ts apps/agent-service/src/config.ts apps/agent-service/src/index.ts apps/agent-service/src/__tests__/serviceAuthBoundary.test.ts PRIVACY.md apps/mcp-server/src/privacyPolicy.ts apps/mcp-server/src/server.ts apps/mcp-server/test/auth-startup-matrix.test.mjs README.md EXECUTSPEC.md .env.example
git commit -m "feat: publish enforceable Kidbot privacy controls"
```

### Task 6: Protected verification, review, PR, deploy, and live proof

**Files:**
- Modify only if verification exposes a defect in an already listed file.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: clean protected verification, specialist approvals, merged PR, deployed metadata/privacy/data-deletion proof.

- [ ] **Step 1: Run focused and full local verification**

Run:

```bash
pnpm --filter @kidbot/mcp-server run test:compat
pnpm --filter @kidbot/mcp-server run test:parent-store
pnpm --filter @kidbot/mcp-server run test:auth-matrix
pnpm --filter web-widget test -- App.sessionState.test.tsx
pnpm --filter @kidbot/agent-service test -- serviceAuthBoundary.test.ts
pnpm run verify-change -- --base origin/main
```

Expected: all commands exit 0; protected verifier reports human review required.

- [ ] **Step 2: Dispatch required specialist reviews**

Provide the complete branch diff and verification evidence to reviewer, safety-reviewer, tester, and UI-hardener. Resolve every actionable finding with a new failing test, rerun the focused check, and commit the fix.

- [ ] **Step 3: Publish the branch and open a PR**

Push `codex/launch-blockers-3-4`, open one focused PR describing blockers 3/4 and test evidence, and inspect required GitHub checks. Sync safely with `origin/main` if behind and rerun protected verification after sync.

- [ ] **Step 4: Merge only with green required checks and human review**

Inspect live branch protection. Obtain the required non-author protected-path review, merge when allowed, then verify `main` contains the merge commit.

- [ ] **Step 5: Configure and verify production**

Set `KIDBOT_WIDGET_DOMAIN` to `new URL(KIDBOT_REMOTE_MCP_URL).origin` without printing the secret-backed input. Set and read back `KIDBOT_WIDGET_RESOURCE_DOMAINS=https://rxnwualzddplucjhclij.supabase.co`.

Await successful Railway deployment. Inspect live `resources/list`, `resources/read`, and `tools/list`; fetch `/privacy`; run hosted story-panel image smoke; create a disposable opted-in profile, record/list history, delete it, and prove the old token can no longer read.

- [ ] **Step 6: Collect external launch gates**

Refresh the app in ChatGPT Developer Mode and verify image rendering/tool interactions on ChatGPT web and mobile. Record privacy/legal reviewer approval separately. If either external gate is unavailable, keep the overall production-launch goal active and report the exact missing proof rather than claiming completion.
