# Kidbot v1 acceptance contract

This is the authoritative release checklist as of 2026-09-12. PLAN.md and EXECUTSPEC.md describe the vision; older dated plans record individual changes, not current completion. The next release is a supervised beta of the four existing activities, not the full Realtime v1 vision. Implemented source, deterministic tests, real-browser evidence, hosted evidence, and human sign-off are distinct acceptance states.

## Product requirements

| Area | Acceptance |
| --- | --- |
| Delivery | A clean production build includes the React widget; missing artifacts fail readiness. Fixture preview is explicitly offline. |
| Voice | Robot/Fairy/Explorer text replies with optional browser speech input/playback, explicit microphone action, moderated input/output, recovery and typed fallback. Leaving the tab cancels capture/playback and suppresses stale results. OpenAI credentials remain server-only. This is not Realtime audio. |
| Comics | Request-specific two-to-eight-panel stories include moderated image output, accessible fallback, bounded storage and end-to-end deadlines. |
| Coloring | Generated safe outlines support pointer and keyboard drawing, undo/clear, composited PNG export and retained work across tabs. |
| Science | Safe household experiments provide supervision, step progression, predictions and explanations with accessible selection. |
| Parent | Session PIN, age selection, explicit history consent, metadata-only history display, purge and confirmed deletion. Session gating must never be described as verified parent identity. |
| Creation storage | In-session work survives navigation. Optional scrapbook storage is local-only, explicit and deletable; generated content never enters ChatGPT widget state. |
| UX | Child-visible AI disclosure, parent privacy link, labelled inputs, keyboard access, live status, empty/error/degraded states, and mobile layout. |
| Operations | Production rejects fixture providers; shared request controls, bounded assets, dependency-aware readiness, draining shutdown and observable outcomes. |

## Release proof

- [ ] Install with pnpm 8.15.8 and frozen lockfile; Linux Node 20 CI and Windows verification pass.
- [ ] Clean widget build measures below 1 MB; real browser verifies every feature, keyboard flows, export and navigation.
- [ ] Redis integration proves shared limits, expiry, consent, isolation and deletion.
- [ ] Provider tests exercise actual moderation, story images, voice and image retrieval on the release commit using synthetic inputs.
- [ ] 100-session load test and voice latency report state percentiles, errors, setup and limitations.
- [ ] Accessibility audit substantiates the WCAG-AA goal; touch/stylus and microphone permission flows are tested on supported devices.
- [ ] Content/red-team review covers all three age bands, spoken output, images and science factuality; deterministic scores alone are insufficient.
- [ ] Parent identity/onboarding design and privacy/legal review approve the intended audience and distribution. ChatGPT host age eligibility must be verified before submission.
- [ ] Beta parent feedback, release notes, submission metadata and OpenAI review approval exist.
- [ ] Deployment records the reviewed commit and passes post-deploy artifact, MCP, provider and parent-store checks.

## Deliberate boundaries

Realtime voice is explicitly deferred from this release using the audited sequence's deferral option. A later release must add server-controlled audio, parent microphone consent, input transcription moderation before generation, complete output moderation before playback, interruption/cancellation, bounded sessions, and real microphone/host/provider evidence. There is no Realtime latency claim or unused Realtime SDK dependency in this beta.

Recoverable OAuth parent identity, private image access, immediate profile-linked image deletion and legal certification are not provided by the current session-PIN design. Any required identity or distribution change must be designed and reviewed explicitly before public launch. Collaboration, public galleries and curriculum integration remain post-v1. Ambient audio and achievements are optional polish, not substitutes for release gates.

## Execution record

Work starts from `3c8881c` on isolated branch `codex/v1-completion`. The audit baseline passed deterministic tests but failed the secured-posture smoke when local dotenv selected unreachable Redis. No production approval or beta sign-off is inferred from this record.

Implementation and local proof are recorded in [v1 implementation evidence](v1-implementation-evidence.md). The original secured-posture failure is resolved by hermetic child services. The composite release checkboxes above intentionally remain open wherever host/device/provider or human evidence is still missing; they are not an implementation completion percentage.
