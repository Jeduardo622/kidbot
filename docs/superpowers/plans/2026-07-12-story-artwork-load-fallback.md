# Story Artwork Load Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace failed story-panel images with the existing accessible placeholder while retrying when the URL changes.

**Architecture:** Keep failure state local to `PanelArtwork`. Associate the failed state with the exact URL instead of a boolean so a new URL automatically receives a new browser load attempt without an effect-driven reset.

**Tech Stack:** React, TypeScript, Vitest, Testing Library

## Global Constraints

- Preserve the existing `story_panels` and `StoryPanel.imageUrl` contracts.
- Reuse the current prompt-derived accessible placeholder.
- Do not change service, MCP, storage, schema, configuration, or production workflows.

---

### Task 1: Story artwork load fallback

**Files:**
- Modify: `apps/web-widget/src/components/ComicBoard.artwork.test.tsx`
- Modify: `apps/web-widget/src/components/ComicBoard.tsx:30-46`

**Interfaces:**
- Consumes: `StoryPanel.imageUrl: string | null` and `StoryPanel.imagePrompt: string`
- Produces: `PanelArtwork` behavior that attempts each URL and falls back accessibly after its load error

- [ ] **Step 1: Write the failing image-error test**

Render a panel with a real URL, dispatch `error` on its image, and assert that the image disappears while the existing `role="img"` placeholder retains the prompt-derived label and the panel caption remains.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `pnpm --filter web-widget exec vitest run src/components/ComicBoard.artwork.test.tsx`

Expected: FAIL because the image remains mounted after its error event.

- [ ] **Step 3: Implement the minimal fallback**

Track the failed URL in `PanelArtwork`. Render the image only when `panel.imageUrl` is non-null and does not equal that failed URL; set the failed URL in `onError`. Otherwise render the existing placeholder.

- [ ] **Step 4: Verify GREEN and URL reset**

Add a rerender assertion with a different URL and confirm the new image is attempted. Re-run the focused Vitest command and expect all artwork tests to pass without warnings.

- [ ] **Step 5: Run selected repository verification**

Run: `pnpm run verify-change -- apps/web-widget/src/components/ComicBoard.tsx apps/web-widget/src/components/ComicBoard.artwork.test.tsx`

Expected: standard classification followed by successful lint, typecheck, `pnpm test`, and MCP compatibility.

- [ ] **Step 6: Review and commit**

Inspect `git diff --check`, `git diff`, and `git status --short`. Commit only the design, plan, component, and test files with a focused message.
