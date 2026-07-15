# Launch Blockers 3 and 4 Design

## Objective

Make Kidbot's current React widget and MCP server submission-ready for the audited ChatGPT iframe/tool-contract and privacy/consent requirements without introducing account identity, OAuth, or profile-linked image storage.

## Scope and boundaries

This change covers the two audited high-severity blockers:

1. ChatGPT iframe CSP and MCP Apps tool contracts.
2. Privacy consent, retained widget credentials, profile/history deletion, retention, logging minimization, and a deployable privacy policy.

The existing child tools, provider behavior, moderation rules, public Supabase image storage, and request-control architecture remain intact. OAuth, private image delivery, immediate per-profile image deletion, and legal certification are outside this implementation. A human privacy/legal review remains a launch approval.

## Apps SDK contract

The server will adopt `@modelcontextprotocol/ext-apps/server` helpers for widget resource and tool registration while retaining `@modelcontextprotocol/sdk` transport and server primitives.

A focused metadata module will expose one canonical widget resource URI and one canonical resource metadata object. It will emit:

- Standard `_meta.ui.resourceUri`, `_meta.ui.csp`, `_meta.ui.domain`, and `_meta.ui.visibility` fields.
- Legacy `openai/outputTemplate`, `openai/widgetCSP`, `openai/widgetDomain`, `openai/widgetDescription`, and `openai/widgetAccessible` compatibility fields where relevant.
- `text/html;profile=mcp-app` through `RESOURCE_MIME_TYPE`.

`KIDBOT_WIDGET_RESOURCE_DOMAINS` will be a comma-separated list of exact HTTPS origins. Values with paths, queries, fragments, credentials, wildcards, or non-HTTPS schemes are rejected. Secured production startup requires at least one resource origin. Kidbot production will configure exactly `https://rxnwualzddplucjhclij.supabase.co`. `connectDomains` remains empty because the iframe makes no direct network requests beyond loading returned image resources.

`KIDBOT_WIDGET_DOMAIN` will be a required exact HTTPS origin in secured production and will populate the standard and legacy widget domain fields. Local/test posture may use the default ChatGPT sandbox origin.

Every registered tool will declare:

- A human-readable title.
- An exact `outputSchema` covering successful, blocked, degraded, and request-control results returned in `structuredContent`.
- `securitySchemes: [{ type: "noauth" }]` and the compatibility `_meta.securitySchemes` mirror. The existing parent token is tool input data for parent-scoped authorization, not ChatGPT OAuth.
- Truthful `readOnlyHint`, `destructiveHint`, `openWorldHint`, and `idempotentHint` annotations.

Generation tools are not read-only because authorized calls can append history. Profile creation/update are state-changing. History list is read-only. Profile deletion is destructive. Provider-backed child tools set `openWorldHint: true` because they send inputs to OpenAI and story generation can publish an ephemeral public image; parent-store-only tools set it to false.

## Consent and widget state

The parent PIN and parent access token will live only in React memory for the mounted widget instance. Initial host state will ignore injected `parentPin`, `parentPinSet`, `parentAccessToken`, `parentModeUnlocked`, `historyEnabled`, and persistent `profileId` fields. Calls to `setWidgetState` will persist only non-secret presentation state: age band, local session ID, and active tab. PIN configuration and unlock state are never persisted.

Setting a PIN only enables local parent controls. It does not call `parent_profile_create`.

The unlocked parent panel will contain an unchecked explicit consent control labeled to save metadata-only activity history for 30 days. Enabling it calls `parent_profile_create` with `historyEnabled: true`. The returned profile ID and token remain in memory. Errors are visible and leave history disabled. Disabling history calls the authenticated update operation with `historyEnabled: false`; the store immediately purges all existing history for that profile.

The panel will also offer `Delete saved profile and history`. It requires an active in-memory profile token, calls the destructive deletion tool, clears the token/profile/history state on success, and reports failures without claiming deletion.

Reloading or remounting discards the PIN and bearer token. Persistent history from an abandoned token remains only until its profile retention expires. Recoverable cross-session parent identity is deferred to a future OAuth design.

## Store retention and deletion

`ParentProfileStore` will add `deleteProfile(input)` and define these invariants for memory and Redis implementations:

- Profile creation requires `historyEnabled: true`; disabled storage returns the current non-persistent response without a credential.
- Profile, token, session index, session event lists, and events share the configured 30-day retention window.
- Authorized reads, updates, history writes, and validation renew the owned keys' expiry consistently.
- Setting `historyEnabled: false` atomically removes all owned session/event keys before returning the updated profile.
- `deleteProfile` authenticates the token, atomically removes the profile, token, session index, and all owned session/event keys, and invalidates the token.
- Cross-profile or invalid-token deletion fails closed.
- Memory mode applies equivalent time-based expiry using injected/current time during operations.

Generated image objects are not associated with profiles. The privacy policy will state that profile deletion does not immediately remove generated images and that public generated images are scheduled for cleanup within 24 hours. The implementation will not claim a hard deletion guarantee that the current best-effort object cleanup cannot prove.

## Logging and policy

Agent-service request logs will replace raw `profileId` and `sessionId` values with keyed HMAC correlation values when a configured secret is available, and omit those identifiers otherwise. Prompts, PINs, parent access tokens, service credentials, and full image URLs remain absent from logs. Tests will capture emitted log records and enforce those exclusions.

`PRIVACY.md` will accurately disclose:

- Child prompts and generated outputs used to provide the requested feature.
- Optional metadata-only history and explicit parent opt-in.
- OpenAI processing, Railway hosting/logs, Supabase public image storage, and browser speech-recognition processing.
- Exact 30-day optional profile/history retention and scheduled 24-hour generated-image cleanup.
- Immediate profile/history deletion semantics and the separate image cleanup window.
- User controls and a deletion/contact process through `https://github.com/Jeduardo622/kidbot/issues` until a dedicated support channel is published.
- No claim of COPPA, GDPR-K, or legal certification.

The MCP HTTP service will expose the same policy at `/privacy` as accessible HTML suitable for a production submission URL. README and `EXECUTSPEC.md` claims will be reconciled with actual runtime behavior.

## Error handling

Configuration errors fail startup before serving an under-permissioned widget. Consent, update, and deletion failures remain visible in the parent UI and never optimistically alter persistent-state claims. Redis multi-key mutations use Lua so partial purge or deletion cannot leave an authorized profile claiming a completed operation.

## Verification

Test-first coverage will include:

- Configuration origin normalization and rejection cases.
- `resources/list`, `resources/read`, and `tools/list` metadata contracts.
- Runtime structured output validation for every tool response class.
- Widget credential-injection rejection, secret-free host state, explicit opt-in, visible errors, purge, and deletion behavior.
- Memory and Redis profile TTL, purge, deletion, invalid-token, and cross-profile cases.
- Privacy-safe log capture.
- `/privacy` content and documentation consistency.

Protected verification is `pnpm run verify-change -- --base origin/main` followed by required specialist review. After merge, production proof requires Railway configuration/readback, successful deploys, live MCP resource/tool metadata inspection, hosted image smoke, disposable profile create/history/delete/token-invalidated proof, a public privacy URL, and ChatGPT web/mobile host validation. ChatGPT host validation and privacy/legal approval are external launch gates and will be reported separately if unavailable.
