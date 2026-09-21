# Child-facing product direction

Decision recorded 2026-09-13, following the owner's approval of local work and parent-identity design. This records product direction and design options, not an approved authentication implementation or a legal compliance assessment.

## Decided

- Kidbot remains a product for children aged 4–12, with the existing 4–6, 7–9 and 10–12 bands. Do not retarget it to adults or teenagers to obtain distribution approval.
- Plan standalone delivery of the child experience, outside the ChatGPT directory. Parent setup and control do not turn the play experience into an adult product.
- Preserve voice, comics, coloring and science. Realtime remains deferred.
- Local source changes, synthetic tests and a review PR are authorized. Paid provider calls, hosted writes, deployment, real-child recruitment and submission are not authorized.
- Parent-identity design is authorized; its detailed architecture and protected implementation require subsequent review. No authentication provider or consent vendor has been selected.

## Current implementation is not the target identity system

`apps/web-widget/src/main.tsx` provides an in-memory session PIN. `apps/mcp-server/src/parentStore.ts` creates a profile/access capability and stores metadata history; it does not establish a recoverable parent account or independently verify parental consent. Generation schemas still accept client-supplied profile/session/age metadata. The existing bridge depends on host tool calls; standalone authenticated child delivery has not been built.

These controls remain unchanged by this slice. Do not migrate an old session PIN or possession of a profile token into proof of a verified parent. Existing profile deletion and image expiry are not yet a unified account-and-content deletion workflow.

## Parent-identity options for review

1. **Parent account plus child-device activation (recommended):** a parent creates a recoverable account and completes the selected consent process, creates minimal child profiles, and authorizes a child device. Children use their own limited play session, not the parent's administrative session. This supports independent play while keeping recovery and settings with the parent; it requires device revocation and session expiry controls.
2. **Parent unlock for every play session:** the same account and consent foundation, but each session needs fresh parent activation. This reduces unattended access but adds friction on shared devices. It does not remove the need for server-side authorization or consent verification.
3. **Device-only parent PIN:** least setup, but no reliable recovery, cross-device account ownership or independent consent proof. Retain only as a local prototype convenience, not as the production identity foundation.

The owner has not yet selected between the first two flows. These are proposals, not implemented features or authorization to implement them.

## Proposed separation of responsibilities

- **Parent account:** owns recovery and administrative access. Account authentication proves control of an account; it is not itself verifiable parental consent. Sensitive changes require fresh authentication. Child sessions cannot invoke parent controls.
- **Consent record:** associates a parent, child profile, notice/version, permitted purposes, verification receipt and revocation status. Avoid storing raw verification documents in Kidbot. The verification method and receipt retention require provider and legal review.
- **Child profile:** uses an opaque identifier, age band and preset avatar; do not request a child's email, full name, exact birth date, school or address for basic play. Parent-to-child ownership must be enforced server-side, not trusted from request parameters.
- **Child session:** authorizes only supported play operations for its profile and age band, with server-side expiry/revocation. Parent credentials must not enter child tool arguments, model context, URLs, analytics or host widget state. A future web transport should use secure session handling and CSRF/origin protection; do not promote the development bridge into a production authentication layer.
- **Consent enforcement:** require current consent and eligible provider configuration before generation; default optional history and microphone features off. Revocation must deny new calls and suppress late results, not only hide buttons. Browser speech may involve a browser vendor's service and needs its own data-flow review.
- **Recovery/deletion:** account recovery must not transfer ownership using only an old child/session token. Revocation should end child sessions immediately; deletion should track profile/history/content/provider cleanup to completion and accurately disclose backups, exceptions and retention. Do not promise immediate image erasure from the current implementation.

Before an implementation plan, review the chosen activation flow, first launch jurisdictions, recovery method, consent verification approach, provider retention eligibility and deletion policy. U.S. rules are a research baseline below, not an assumption of worldwide eligibility.

## External requirements to validate before child production traffic

The [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions) generally requires verifiable parental consent before collecting children's personal information, subject to specific exceptions. Choose a method appropriate to the actual collection/disclosure, and have counsel review notice, consent, minimization, retention and deletion. A child's voice can itself be personal information; do not assume short-lived capture avoids the other obligations.

[OpenAI's under-18 API guidance](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance) says under-13 personal data must not be processed without first implementing API zero data retention. Eligibility and endpoint/model behavior must be verified before a child-facing provider rollout. This repository has no evidence that those controls are enabled. Prompt filtering, a pseudonymous profile or setting a request's storage flag does not establish that prerequisite.

Standalone distribution removes reliance on ChatGPT directory eligibility; it does not remove child-privacy or provider requirements. No advertising, public gallery, social sharing, child account creation or new analytics is included in this design slice.

## Metadata correction in this slice

`voice_chat`, `coloring_outline` and `science_sim` now advertise `openWorldHint: false`: their configured generation paths and private metadata updates do not interact with user-selected external entities. They remain non-read-only and non-idempotent; this change grants no access and removes no moderation or authorization checks. `story_panels` remains open-world because of the current generated-image publication path, pending a future private-content design review. Parent tool hints remain unchanged.

The existing protocol compatibility test checks all eight tools' advertised contracts. Its baseline passed 13/13; the revised expectation failed against the old source, then passed 13/13 after the three hint corrections. Full routed verification is recorded in the PR.

No `chatgpt-app-submission.json` is produced: the owner chose a child product outside that distribution route. The old metadata-approval pause is resolved, but ChatGPT submission is no longer this release's objective.
