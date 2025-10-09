# KidBot Engineering Plan (v1.0 Milestone Roadmap)

## Team
| Role | Name / Placeholder | Notes |
|------|--------------------|-------|
| CTO / Architect | Zeus | Oversees structure, integration, safety |
| AI Engineer | — | Agents SDK & Realtime integration |
| Frontend Engineer | — | Apps SDK component, UX logic |
| UX / Designer | — | Visual polish & child UI testing |
| QA Engineer | — | Scenario & regression testing |

---

## Version Milestones

### **v0.1 – Prototype Foundation (Weeks 1–3)**
**Goals:** Establish architecture, stub all four features.

| Task | Assigned To | Deliverable |
|------|--------------|-------------|
| Create monorepo, packages, build scripts | CTO | Working repo & CI |
| Build MCP server scaffold w/ fallback widget | Frontend Engineer | `/mcp` endpoint + `kidbot.html` resource |
| Implement agent service w/ stubbed endpoints | AI Engineer | `/voice`, `/story-panels`, `/coloring-outline`, `/science-sim` |
| Implement UI Tabs (Voice, Comics, Coloring, Science) | Frontend Engineer | Component renders & state sync |
| Add local moderation + safety layer | Safety Engineer | `moderate()` in both server & agent |
| QA test fallback flows | QA Engineer | Checklist & logs |

**Exit Criteria:** All tabs function w/ offline stub data; moderation returns safe results.

---

### **v0.2 – Voice Alpha (Weeks 4–6)**
**Goals:** Enable Realtime API speech in/out; kid personas active.

| Task | Assigned To | Deliverable |
|------|--------------|-------------|
| Integrate Realtime API (STT/TTS) | AI Engineer | Live speech loop |
| Add voice persona styles (Robot/Fairy/Explorer) | AI Engineer + UX | Tone templates |
| Update UI voice controls (record/play buttons) | Frontend Engineer | Interactive mic button |
| Add low-latency streaming & barge-in support | AI Engineer | <2s response latency |
| Moderate audio input (speech safety) | Safety Engineer | filter pipeline |
| Conduct latency QA & adjust thresholds | QA Engineer | test report |

**Exit Criteria:** Real-time conversation possible, stable in 80% of trials.

---

### **v0.3 – Creative Expansion (Weeks 7–9)**
**Goals:** Visual enhancements and story depth.

| Task | Assigned To | Deliverable |
|------|--------------|-------------|
| Integrate image generation for panels | AI Engineer | image URLs in story panels |
| Improve coloring outlines (procedural SVG gen) | Frontend Engineer | SVG sets & brush tools |
| Add background music / ambient sound | UX | Optional audio cues |
| Refine “Science Lab” UX (prediction quiz) | Frontend Engineer | Step-based flow |
| Add “Save creation” scrapbook (local only) | CTO | Safe cache system |
| Moderate visual output (safe images only) | Safety Engineer | image validator |

**Exit Criteria:** Comics show images; coloring has multiple outlines; science steps playable.

---

### **v0.4 – Parent & Safety (Weeks 10–12)**
**Goals:** Parental controls, dashboards, and safety compliance.

| Task | Assigned To | Deliverable |
|------|--------------|-------------|
| Implement parental PIN and dashboard summary | CTO | Configurable parental mode |
| Add activity logging (non-identifiable) | Backend / Safety | JSON logs |
| Conduct red-team safety audit | QA + Safety | report & fixes |
| Prepare privacy documentation (COPPA) | CTO | Policy.md |
| Load testing for concurrency | AI Engineer | 100 concurrent sessions test |

**Exit Criteria:** Parent mode functional; compliance checklist passed.

---

### **v1.0 – Launch Readiness (Weeks 13–16)**
**Goals:** Final polish, deploy, and review.

| Task | Assigned To | Deliverable |
|------|--------------|-------------|
| UX polish & accessibility review | UX | Verified WCAG-AA compliance |
| Performance optimization (bundle size, memory) | Frontend Engineer | <1MB UI build |
| Final content moderation audit | Safety Engineer | Sign-off sheet |
| Integration with ChatGPT App Submission | CTO | App metadata + policies |
| Prepare v1.0 release notes | CTO | Release.md |
| Public beta testing & parent feedback | QA | Feedback summary |

**Exit Criteria:** Passed audit, stable, approved by OpenAI review.

---

## Technical Dependencies
- Node 20+, pnpm 8+
- OpenAI Platform access (Apps SDK, Agents SDK, Realtime API)
- HTTPS (ngrok/localtunnel during dev)
- Optional: Playwright for interactive QA

---

## Communication & Reporting
- Weekly standup (async)
- Milestone demo every version
- GitHub Projects board for tasks
- Safety & UX review before each release

---

## Long-Term Roadmap
| Version | Focus |
|----------|-------|
| 1.1 | Collaborative story creation (multiple kids) |
| 1.2 | Safe online gallery (moderated uploads) |
| 2.0 | Educational curriculum integration |

---

## Appendix: Definitions
- **MCP Server:** Connects ChatGPT host to KidBot’s component & tools.
- **Agent Service:** Backend orchestrator for creative and reasoning logic.
- **Realtime API:** Manages live speech synthesis and recognition.
- **Widget:** The Apps SDK UI displayed inside ChatGPT.
