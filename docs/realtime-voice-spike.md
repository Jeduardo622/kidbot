# Realtime voice: design spike

**Status:** design only, nothing implemented. Timebox: 3 days.
**Decision it feeds:** whether spoken voice ships in v1.1, or the text-plus-
speech-synthesis experience stays as it is.

## What exists today

The Voice tab sends text to `voice_chat` and speaks the reply with the
browser's `speechSynthesis`. Personas change rate and pitch. Input capture uses
`webkitSpeechRecognition`, which is Chrome-only and is expected to be blocked
inside the ChatGPT iframe, so in practice a child types and Kidbot talks back.

There is no audio anywhere in the services. The spec's promise of spoken
conversation with barge-in is not partially built; it is not built.

## Proposed shape

```
widget (iframe)  --WebRTC audio-->  OpenAI Realtime
      |                                   ^
      | POST /voice/session               | ephemeral client secret
      v                                   |
 mcp-server  ---->  agent-service  --------+
                      (mints the session, holds the API key)
```

1. The widget asks the MCP server for a voice session.
2. agent-service mints a short-lived Realtime client secret with the OpenAI
   key, which never leaves the server, and returns it with a TTL of a minute or
   two.
3. The widget opens a WebRTC peer connection straight to the Realtime endpoint
   using that secret. Audio does not transit our services.
4. Transcripts, both the child's and Kidbot's, come back over the data channel
   and are posted to the existing moderation path.

## The hard parts, in the order they can kill it

1. **Moderation is no longer in the request path.** Every other tool moderates
   input before generation and output before display. Streaming audio bypasses
   both. The spike has to answer: does a moderation hit stop playback fast
   enough to matter, and what does a child hear when it fires? A safety layer
   that arrives after the sentence is spoken is not a safety layer. If this has
   no clean answer, stop here.
2. **Iframe permissions.** The ChatGPT iframe must grant microphone access to
   our origin. If it does not, the whole design is moot on the host that
   matters. Verify this before writing any server code.
3. **Session brokering and abuse.** An ephemeral secret is a spendable
   credential. It needs the same per-caller and global budgets the tools have,
   plus a hard cap on session length and concurrent sessions.
4. **Age banding.** Voice instructions, speed, and vocabulary have to follow
   the locked band the same way text does.
5. **Cost.** Realtime audio is billed per minute in both directions. A child
   who leaves the tab open is a runaway bill unless sessions expire on silence.

## Spike plan

| Day | Work | Output |
|-----|------|--------|
| 1 | Microphone permission and WebRTC reachability from inside the real ChatGPT iframe, on web and mobile | Yes/no, with evidence. A no ends the spike |
| 2 | Throwaway session-minting route in agent-service; measure time from a moderation verdict to audio actually stopping | Latency number and the child-facing interruption behaviour |
| 3 | Write up cost per session, the session limits needed, and the moderation design | Recommendation: ship in v1.1, or keep text |

## Exit criteria

Ship it only if all four hold:

- The microphone works in the real ChatGPT iframe on web and mobile.
- Unsafe content stops playback within roughly a second, and what the child
  hears is a friendly redirect rather than a cut-off.
- A session cannot exceed a bounded cost, and budgets apply per caller.
- Age band changes what the child hears.

Otherwise keep the current text plus speech-synthesis experience, and stop
describing Kidbot as having voice conversation.
