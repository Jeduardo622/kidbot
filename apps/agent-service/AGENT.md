KidBot Agent Service (Agents SDK)

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

Idempotent, stateless endpoints (session state in UI/MCP).

Env (apps/agent-service/.env)
OPENAI_API_KEY=sk-...
PORT=4505
LOG_LEVEL=info
DEFAULT_AGE_BAND=7-9

Endpoints

POST /voice → { text, persona, ageBand } → { blocked, persona, text, ssml }

POST /story-panels → { theme, panels, ageBand } → { blocked, theme, panels[] }

POST /coloring-outline → { scene, style? } → { blocked, svg }

POST /science-sim → { topic, ageBand } → { blocked, title, objective, materials[], steps[], prediction{...}, explanation, supervision }

Validation

Zod schemas per route; on error 400.

Errors & Rate Limits

400/401/429/500 with correlationId.

Suggested limits: voice 60/m, story 20/m, coloring 15/m, science 20/m.

Testing (manual)

curl examples for each route; ensure ≤100 words for voice, panels 2–6, valid SVG, safe experiments.

Roadmap

v0.1 MVP (stubs OK)

v0.2 image gen thumbnails

v0.3 Realtime voice agent

v0.4 Parent dashboard

v1.0 achievements/scrapbook

Safety checklist

Age-band audits, red-team prompts blocked, SVG strokes-only, supervision notes, no PII in logs, rate limits, 5xx alarms.

Deliverables

All files created with working dev scripts.

Tools call the agent service and handle moderation gracefully.

Web widget renders the four tabs and basic flows (voice/comics/coloring/science).

Print a short summary and next-step TODOs (Realtime voice + image gen).
