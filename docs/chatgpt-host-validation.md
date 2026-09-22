# ChatGPT host validation checklist

Health checks prove the services are up. They do not prove a child can use
Kidbot inside ChatGPT. Everything below has to be observed by a person in the
real host before the app is submitted, on both web and mobile, because the two
differ in iframe policy, audio permission, and viewport.

Record each run in `smoke-log.md` with the date, host, and build commit
(`/healthz` reports `release.commit` on the MCP service).

## Before you start

- Confirm the connector points at the production MCP URL and that
  `GET /healthz` shows `productionReady: true`, `mode: dist`,
  `agentService.provider: openai`, and `originPolicy: allowlist`.
- Note the `release.commit` for both services so the session can be tied to a
  build.
- Use a real child-age setting: run the whole list once at 4-6 and once at
  10-12. The bands are supposed to look different; this is where that claim is
  tested.

## Web (desktop browser)

| # | Check | Pass means |
|---|-------|-----------|
| 1 | Widget loads in the conversation | React bundle renders, no fallback markup, no console CSP violation |
| 2 | Generated story images appear | Panel art renders from the Supabase public URL; the image is not blocked by the widget CSP |
| 3 | Voice tab answers a real question | Ask "what does photosynthesis mean?" and get a real answer, not a safety block |
| 4 | Read-aloud plays | `speechSynthesis` speaks; Stop halts it; switching tabs stops narration |
| 5 | Microphone | Either it records, or the disabled state explains why. A permanently dead button with no explanation is a failure |
| 6 | Coloring export | Save produces a PNG that looks like what is on screen, outline included, on a white ground |
| 7 | Dark theme | With the host in dark mode every surface is legible; no white panel on a dark page |
| 8 | Fullscreen / display mode | Requesting a larger display mode does not reset activity state |
| 9 | Scrapbook | A story, a coloring, and an experiment can be saved and are still there after switching tabs |
| 10 | Parent controls | PIN must be typed twice; five wrong tries locks for 60 seconds |

## Mobile (iOS and Android ChatGPT apps)

Repeat 1-10, then the checks that only fail on a phone:

| # | Check | Pass means |
|---|-------|-----------|
| 11 | Layout at phone width | No horizontal scroll; tabs do not overlap; 44px minimum targets are actually tappable |
| 12 | Canvas drawing with a finger | Strokes follow the finger; the page does not scroll while drawing |
| 13 | Audio with the ringer switch | Read-aloud either plays or fails visibly; no silent dead button |
| 14 | Microphone permission prompt | The OS prompt appears, and a denial produces the explained disabled state |
| 15 | Backgrounding | Leaving and returning to the app does not lose the scrapbook or the current activity |
| 16 | Long story | A 6-panel story completes inside the host's own request timeout, or degrades with child-safe copy |

## Known constraints

- `webkitSpeechRecognition` is Chrome-only and is expected to be unavailable in
  the ChatGPT iframe. Check 5 and 14 are satisfied by the *explained* disabled
  state, not by working capture. Real voice input is the Realtime spike, not
  this release. See `realtime-voice-spike.md`.
- Webfonts are not loaded; rounded system faces are intentional.
- Generated images expire after 24 hours by design, so a scrapbook entry from
  yesterday may show a missing image. That is expected, and the widget must not
  show a broken-image icon to a child.

## Submission prerequisites

These are not host checks, but the submission is blocked without them:

- Privacy policy URL: the live `/privacy` page on the MCP service.
- Support contact: a monitored address. A GitHub issues page is not a support
  contact for a product aimed at children.
- App metadata and screenshots taken from a real session at each age band.
