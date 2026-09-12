# Release review: supervised beta

Status: local implementation completed for the supervised-beta scope; [verification evidence](v1-implementation-evidence.md) and unresolved external gates are recorded separately. This document is not deployment authorization, a legal assessment, or evidence of OpenAI approval.

## Product changes

- Production builds include the React widget and verify its artifacts. Offline fixtures never call real tools.
- Synthetic service verification runs without inheriting provider credentials, Redis settings, or local dotenv files.
- Generated story images and rasterized coloring outlines receive semantic moderation before delivery; failures withhold output.
- Request deadlines, cancellation, shared limit expiry, production configuration, dependency readiness, and draining shutdown are hardened.
- Coloring exports composite the outline and strokes. Tabs retain in-session work; voice capture/playback stops on navigation and ignores stale replies.
- Science cards advance through steps, require a prediction, and explain the result. Parent controls expose metadata history and confirm deletion.
- UI includes AI/privacy disclosure, labelled inputs, keyboard drawing, and explicit empty/error states.

## Explicitly deferred

Realtime audio is outside this beta. Existing browser speech is not a Realtime conversation engine and carries no under-two-second latency claim. A future integration needs server-side credentials, parent microphone consent, complete input/output moderation before audible playback, interruption, bounded sessions, and real host/device/provider validation.

Optional scrapbook, ambient audio, achievements, collaboration, galleries, and curriculum integration are not implemented by this change. In-session persistence is implemented; reload persistence is not promised. Recoverable parent identity and private/profile-linked image deletion remain separate design work.

## Distribution blocker

Verified 2026-09-12: [OpenAI plugin guidelines](https://developers.openai.com/plugins/app-guidelines) prohibit explicitly targeting children under 13. Kidbot's current age bands are 4–6, 7–9, and 10–12, so a direct child-facing ChatGPT directory submission is blocked. [OpenAI's age guidance](https://help.openai.com/en/articles/8313401-is-chatgpt-safe-for-all-ages) says education interactions for under-13s must be conducted by an adult; that does not itself approve this app's targeting. [App Developer Terms](https://openai.com/policies/developer-apps-terms/) also restrict sending personal information of children under 13 or the applicable age of digital consent.

The owner must select and review a distribution/identity model. Merely changing marketing copy or adding a session PIN is not a resolution. No child recruitment, production collection, or submission is authorized by this document.

## Submission source review

All eight registered tools declare output schemas and the three required impact hints. Parent controls are app-only, but `parentAccessToken` still exists in input schemas (also on generation tools via session metadata). Review whether these capabilities must move to a supported authenticated side channel; never ask children or a model to type credentials.

The voice, coloring and science tools declare `openWorldHint: true` despite fixed-provider behavior. A metadata correction is awaiting owner confirmation under the submission skill; the JSON submission import is intentionally not generated while that mismatch remains. Story image publication requires a separate hint review. Destructive profile updates/deletion remain explicitly marked destructive.

Production CSP origins are validated as exact HTTPS origins. Actual deployed resource/domain compatibility still requires host testing. Metadata history exposes activity timestamps/identifiers only to the parent flow; review minimization and disclosure before submission.

## Evidence required before release

| Gate | Required proof | Current disposition |
| --- | --- | --- |
| Code review | Protected-path reviewer, resolved findings, exact-head CI | Required; no self-approval |
| Live provider | Moderation, generated art, retrieval and failure checks on reviewed SHA with synthetic prompts | Not run in this implementation |
| Load | 100-session aggregate latency/errors, admission checks, multi-instance Redis/provider conditions | Local synthetic harness only; hosted scale separate |
| Browser | Four activities, history/deletion, export, keyboard and navigation | Local browser evidence recorded separately |
| Devices/accessibility | Supported touch/stylus/mic devices, assistive technology, WCAG-AA audit | Manual/device gate open |
| Safety | Age-band red-team cases, factual science review, semantic image/audio review | Deterministic tests are not sufficient |
| Privacy/legal | Consent/identity, data recipients, public URLs, retention/deletion, audience and contact review | Owner/legal gate open |
| Beta feedback | Consented eligible cohort, task outcomes, failures, parent feedback and disposition | Not collected |
| Deployment | Reviewed SHA, secrets/targets validated, rollback and post-deploy artifact/provider/Redis gates | No deployment performed |

## Reproducible review protocol

Use only invented prompts and synthetic profiles; do not place real children's information in logs, test fixtures, issue trackers, or screenshots. For every browser/device or red-team scenario record release SHA, environment, tool/age band, expected outcome, actual outcome, and pass/fail/block reason. Aggregate timings without raw requests. Keep provider-backed tests opt-in and cost-bounded.

Exercise benign and unsafe inputs, moderation outage, provider timeout, oversized/malformed images, tab changes during requests, microphone denial, stored-history expiry, wrong-profile credentials, confirmed deletion, and Redis loss. Retest failure cases after remediation. Do not replace the deterministic evaluator baseline to conceal a regression.

Collect beta feedback only after the distribution and consent gates are resolved. Record task completion, confusing controls, recovery, adult supervision, and requested improvements; obtain explicit approval before collecting or retaining feedback.
