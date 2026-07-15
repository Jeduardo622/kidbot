# Kidbot Executive Specification

## Vision
**Kidbot** is a creative, safe, and voice-driven AI playground for children ages **4–12**.  
It helps kids explore curiosity through stories, science experiments, and artistic expression — all guided by a friendly voice persona they can talk to.

Kidbot combines **OpenAI’s Apps SDK** (for in-ChatGPT UI & interaction) and **Agents SDK + Realtime API** (for voice orchestration and creative reasoning).

---

## Mission Statement
Empower kids to *learn through play* by interacting with a trusted digital friend that nurtures imagination, encourages safe exploration, and promotes early STEM curiosity.

---

## Core Features (v1.0 Scope)
| Feature | Description | SDK / Tech |
|----------|--------------|-------------|
| **1. Voice Chat + Voice Persona** | Conversational voice chat with friendly characters (Robot, Fairy, Explorer). Uses OpenAI **Realtime API** for speech synthesis and recognition. | Realtime API + Agents SDK |
| **2. Slow-Motion Comic Panels / Storyboards** | Kids generate visual stories as panels with captions and evolving plots. | Apps SDK UI + Agents SDK |
| **3. Live Coloring Book** | Dynamic outline images kids can color in with touch or stylus directly inside ChatGPT. | Apps SDK (component) + Canvas API |
| **4. Science / Experiment Simulator** | Safe, household experiments with predictions and explanations (STEM learning). | Agents SDK (structured reasoning) |
| **5. Parental Dashboard (future)** | Parent summary of child’s activity and learning topics. | Backend + Secure OAuth |

---

## Audience Segmentation
| Age Band | Tone & Complexity | Example Activities |
|-----------|------------------|--------------------|
| **4–6 (Early Learners)** | Simple words, big visuals, short sentences. | Voice chat, coloring, basic “why” questions. |
| **7–9 (Curious Minds)** | Slightly more text, early experiments. | Story creation, comics, light science. |
| **10–12 (Explorers)** | Deeper reasoning, structured projects. | Multi-panel storytelling, creative challenges. |

---

## Safety & Compliance
- **Launch review:** Privacy and legal review is required before public launch; the current implementation does not claim legal certification.
- **Guardrails:** AI moderation layer filters harmful, scary, or adult content.  
- **Privacy:** No open-ended chat logs. With explicit parent consent, pseudonymous parent profiles and metadata-only activity history may be retained for 30 days; generated story images use a 24-hour expiry target with periodic best-effort cleanup. See `PRIVACY.md`.
- **Transparency:** Clear disclosure “Kidbot is an AI friend that helps you learn and play.”  
- **Parent Supervision:** Configurable via parental PIN (v0.4+).

---

## Roles & Responsibilities

| Role | Primary Focus | Key Tools / SDKs |
|------|----------------|------------------|
| **CTO (Zeus)** | Architecture, technical strategy, code review, safety governance | GitHub, Codex Cloud, OpenAI Platform |
| **AI Engineer** | Agents SDK orchestration, Realtime API voice control, moderation pipelines | OpenAI Agents SDK, Realtime API, Node.js |
| **Frontend Engineer** | ChatGPT App UI (Apps SDK), component logic, event bridges | React, Apps SDK, Vite |
| **UX / Interaction Designer** | Child-friendly interface, color/stroke interaction design | Figma, Tailwind CSS |
| **Safety Engineer** | Moderation, age filtering, privacy and safety review | OpenAI Moderation API, local guardrails |
| **QA Engineer** | Automated and manual scenario testing | Vitest, Playwright, MCP Inspector |

---

## Technology Stack

| Layer | Tech |
|-------|------|
| **UI / Frontend** | React (in Apps SDK component), HTML Canvas for coloring, Vite build |
| **MCP Server** | Node.js, Express, @modelcontextprotocol/sdk |
| **Agent Service** | Node.js + TypeScript, Express, OpenAI Agents SDK |
| **Voice** | OpenAI Realtime API (TTS/STT), Browser fallback (speechSynthesis) |
| **Data** | Local widget state; optional Redis parent profiles/history; optional Supabase generated-image storage |
| **Auth** | OpenAI App OAuth flow (future parental login) |

---

## Version Roadmap

| Version | Goal | Key Deliverables |
|----------|------|------------------|
| **v0.1 (Prototype)** | MVP UI + Agent link | Voice (text stub), comic panels, coloring, science cards |
| **v0.2 (Voice Alpha)** | Add Realtime API for live voice | Low-latency voice personas |
| **v0.3 (Creative Expansion)** | Image gen + improved coloring assets | Cartoon DALL·E integration |
| **v0.4 (Parent + Safety)** | Parent dashboard, consent layer | Privacy + logs |
| **v1.0 (Launch)** | Stable, audited build | Polished UI, content audits, parental onboarding |

---

## Key Risks & Mitigations
| Risk | Mitigation |
|------|-------------|
| Unsafe content generation | Layered moderation (`moderate()` + model filters) |
| Voice latency / mispronunciation | Local fallback, pre-cached responses |
| Child data retention | Explicit-consent metadata history expires after 30 days; generated images use a 24-hour expiry target with periodic best-effort cleanup; deletion cannot recall provider, backup, or cache copies |
| Hardware variability (touch input) | Canvas auto-scale + sensitivity tuning |
| Privacy or legal requirements drift | Privacy and legal review required before public launch; keep `PRIVACY.md` synchronized with runtime and provider configuration |

---

## Success Metrics
- 90% of prompts return in <2s round trip (voice pipeline)  
- Zero moderation incidents in logged QA tests  
- ≥4.5★ rating in internal parent tests  
- <1% crash rate in interactive coloring UI  

---

## Summary
Kidbot blends learning, storytelling, and play inside ChatGPT safely and responsibly.  
Its modular SDK architecture is designed for **extensibility**, with privacy, safety, and legal review remaining explicit launch gates.
