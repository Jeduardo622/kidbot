Kidbot Agent Service (Agents SDK)

Stable, kid-safe orchestration layer for Voice Chat + Persona, Story Panels, Coloring Outlines, and Science Sims.

TL;DR

Language: TypeScript (Node 20+)

Frameworks: Express, OpenAI Agents SDK, Zod

Port: 4505

Security: API key, input/output moderation, age-band tone control

Consumers: MCP server tools over HTTP (/voice, /story-panels, /coloring-outline, /science-sim)

Architecture
ChatGPT UI (Apps SDK iframe)
        │  window.openai.callTool(...)
        ▼
MCP Server (tools)
        │  POST http://agent:4505/...
        ▼
Agent Service (this)
   ├─ guardrails.ts   (moderation, prompts, age bands)
   ├─ agents/
   │   ├─ storyAgent.ts
   │   ├─ imageAgent.ts
   │   └─ experimentAgent.ts
   └─ index.ts        (Express, routing, validation, tracing)


Design goals

All inputs/outputs pass through moderation.

Agents produce structured, age-appropriate content.

Idempotent, stateless endpoints (session state kept in the UI or MCP).

Setup
Env Vars (apps/agent-service/.env)
OPENAI_API_KEY=sk-...
AGENT_SERVICE_TOKEN=<generate with: openssl rand -base64 48>
PORT=4505
LOG_LEVEL=info
DEFAULT_AGE_BAND=7-9   # one of: 4-6, 7-9, 10-12
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

Install & Run
pnpm i
pnpm --filter agent-service dev     # or: pnpm run dev:agent
# server on http://localhost:4505

Guardrails

System prompt (summarized):

Friendly, upbeat, kid-safe. Avoid adult/violent/scary content.

No medical/legal advice. Encourage curiosity. Short, simple sentences.

Adjust complexity via ageBand: 4-6 (very simple), 7-9 (simple), 10-12 (clear, slightly richer).

Moderation: block categories (violence, self-harm, hate, adult themes, personal data). On block, return:

blocked: true, message: gentle refusal + suggested safe alternatives.

Output length caps (approx):

Voice replies ≤ 80–120 words.

Story panels: 2–6 panels for MVP (max 8).

Science steps: ≤ 6 simple steps + 1 MCQ.

API

All endpoints: application/json.
Auth: Authorization: Bearer <AGENT_SERVICE_TOKEN> plus x-kidbot-startup-posture: secured.

1) POST /voice

Kid-friendly response in chosen persona.

Request

{
  "text": "Tell me about the Moon!",
  "persona": "robot",
  "ageBand": "7-9"
}


Response

{
  "blocked": false,
  "persona": "robot",
  "text": "Beep! The Moon is Earth’s rocky neighbor...",
  "ssml": "<speak>Beep! The <emphasis>Moon</emphasis> ...</speak>"
}


Personas: robot, fairy, explorer (extendable).

2) POST /story-panels

Plan a short story and split into panels (for slow-motion comics/storyboards).

Request

{
  "theme": "A shy dragon makes a friend",
  "panels": 4,
  "ageBand": "7-9"
}


Response

{
  "blocked": false,
  "theme": "A shy dragon makes a friend",
  "panels": [
    { "title": "Quiet Cave", "caption": "Dara the dragon peeks out...", "imagePrompt": "cute friendly dragon in cozy cave, soft colors", "imageUrl": null },
    { "title": "A Small Hello", "caption": "Dara whispers hi to a lost fox.", "imagePrompt": "dragon and tiny fox by forest path", "imageUrl": null },
    { "title": "Sharing Snacks", "caption": "They swap berries and stories.", "imagePrompt": "sharing berries, smiles", "imageUrl": null },
    { "title": "New Friends", "caption": "Warm hugs. A big brave grin.", "imagePrompt": "sunset, happy dragon and fox", "imageUrl": null }
  ]
}


imageUrl is null in local fallback/stub mode (UI renders placeholders). In provider-backed mode, the agent service can attach generated image URLs behind the same nullable imageUrl field. `KIDBOT_IMAGE_STORAGE_MODE=local` stores generated PNGs under `KIDBOT_IMAGE_STORAGE_DIR` and returns `/generated-images/...` URLs with byte limits and expiry cleanup. `KIDBOT_IMAGE_STORAGE_MODE=supabase` uploads generated PNGs to Supabase Storage using server-only service credentials and returns public object URLs. `KIDBOT_IMAGE_STORAGE_MODE=data-url` keeps the legacy inline data URL behavior for local compatibility.

3) POST /coloring-outline

Return a black-stroke SVG outline (no fills) for live coloring in the UI.

Request

{
  "scene": "space cat",
  "style": "space"
}


Response

{
  "blocked": false,
  "svg": "<svg viewBox='0 0 1024 1024' xmlns='http://www.w3.org/2000/svg'> ... </svg>"
}


SVG rules

stroke="#000", fill="none", clean viewBox="0 0 1024 1024".

Keep paths simple; outline foreground + few large regions to color.

4) POST /science-sim

Household-safe experiment plan + one prediction question.

Request

{
  "topic": "buoyancy",
  "ageBand": "7-9"
}


Response

{
  "blocked": false,
  "title": "Float or Sink?",
  "objective": "Explore why some things float.",
  "materials": ["Clear bowl of water", "Spoon", "Orange", "Paper clip"],
  "steps": [
    "Fill the bowl with water.",
    "Guess which items will float.",
    "Gently place each item in the water.",
    "Observe and note float or sink."
  ],
  "prediction": {
    "question": "What happens to the orange?",
    "choices": ["Floats with peel", "Sinks with peel", "Spins like a top"],
    "answerIndex": 0
  },
  "explanation": "The peel traps tiny air pockets, helping it float...",
  "supervision": "Ask an adult for help with water spills."
}

Validation

Each route validates body with Zod:

/voice: { text: string (1–320 chars), persona: enum, ageBand }

/story-panels: { theme: string, panels: int 2..8, ageBand }

/coloring-outline: { scene: string, style?: enum }

/science-sim: { topic: string, ageBand }

On validation error → 400 with { error, details }.

Error Model

400 — invalid input

401 — missing/invalid auth

429 — rate limited (see below)

500 — internal error (masked message, correlation id)

Response shape

{ "error": "Bad Request", "details": "panels must be between 2 and 8", "correlationId": "kb_2025-10-07_Tx9..." }

Rate Limiting

Simple token bucket (per IP) suggested defaults:

/voice: 60 req/min

/story-panels: 20 req/min

/coloring-outline: 15 req/min

/science-sim: 20 req/min

Return 429 with Retry-After.

Use RATE_LIMIT_STORE=redis with REDIS_URL for shared buckets across Node replicas. The memory store remains the test fallback. Self-hosted local Redis is defined in docker-compose.redis.yml, and agent-service /healthz reports limiter readiness.

Provider Failure Policy

Provider failures are classified before route-level handling:

moderation_failure, generation_timeout, malformed_output, unsafe_output, provider_unavailable.

PROVIDER_FAILURE_POLICY=503 returns a degraded-service 503. Use PROVIDER_FAILURE_POLICY=fallback only when deterministic stub content with providerFallback=true and fallbackReason is acceptable.

Logging & Tracing

correlationId per request.

Log: route, latency, moderation result, token usage (approx), truncated inputs/outputs.

No PII in logs. Redact prompts if needed.

Testing (Manual)

Voice:

curl -H "Authorization: Bearer $AGENT_SERVICE_TOKEN" \
  -H "x-kidbot-startup-posture: secured" \
  -H "Content-Type: application/json" \
  -d '{"text":"Tell me a Moon fact","persona":"robot","ageBand":"7-9"}' \
  http://localhost:4505/voice


Expect ≤ 100 words, cheerful, no scary bits.

Story Panels:

curl -H "Authorization: Bearer $AGENT_SERVICE_TOKEN" \
  -H "x-kidbot-startup-posture: secured" \
  -H "Content-Type: application/json" \
  -d '{"theme":"A shy dragon makes a friend","panels":4,"ageBand":"7-9"}' \
  http://localhost:4505/story-panels


Coloring Outline:

curl -H "Authorization: Bearer $AGENT_SERVICE_TOKEN" \
  -H "x-kidbot-startup-posture: secured" \
  -H "Content-Type: application/json" \
  -d '{"scene":"space cat"}' \
  http://localhost:4505/coloring-outline


Science Sim:

curl -H "Authorization: Bearer $AGENT_SERVICE_TOKEN" \
  -H "x-kidbot-startup-posture: secured" \
  -H "Content-Type: application/json" \
  -d '{"topic":"buoyancy","ageBand":"7-9"}' \
  http://localhost:4505/science-sim

TypeScript Interfaces (shared)
export type AgeBand = "4-6" | "7-9" | "10-12";
export type Persona = "robot" | "fairy" | "explorer";

export interface VoiceReq { text: string; persona: Persona; ageBand: AgeBand; }
export interface VoiceRes { blocked: boolean; persona: Persona; text?: string; ssml?: string; message?: string; }

export interface StoryReq { theme: string; panels: number; ageBand: AgeBand; }
export interface StoryPanel { title: string; caption: string; imagePrompt: string; imageUrl: string | null; }
export interface StoryRes { blocked: boolean; theme?: string; panels?: StoryPanel[]; message?: string; }

export interface ColoringReq { scene: string; style?: "animals"|"space"|"underwater"; }
export interface ColoringRes { blocked: boolean; svg?: string; message?: string; }

export interface ScienceReq { topic: string; ageBand: AgeBand; }
export interface ScienceRes {
  blocked: boolean;
  title?: string;
  objective?: string;
  materials?: string[];
  steps?: string[];
  prediction?: { question: string; choices: string[]; answerIndex: number; };
  explanation?: string;
  supervision?: string;
  message?: string;
}

Roadmap

v0.1 (MVP): endpoints above, browser TTS, placeholder images.

v0.2: image generation (cartoon style), panel thumbnails.

v0.3: Realtime voice agent (low-latency STT/TTS), barge-in.

v0.4: Parent dashboard, content logs, PIN, age profiles.

v1.0: A/B tested curricula, achievements, save/share scrapbook.

Notes for MCP Integration

MCP tools should sanitize and re-moderate (defense in depth).

Set "openai/widgetAccessible": true for tools the UI calls directly.

Keep payloads small; store large artifacts (images) by URL.

Safety Checklist (pre-ship)

 Age-band output audits (samples per route).

 Red-team prompts: scary/violent/romance → blocked.

 SVG outlines: no hidden fills; strokes only.

 Science sims: household-safe; supervision notes present.

 Logs contain no PII; correlation ids enabled.

 Rate limits active; 5xx alarms.
