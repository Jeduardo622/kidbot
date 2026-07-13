# Story Artwork Load Fallback Design

## Goal

Keep every story panel usable and accessible when a generated artwork URL is expired, blocked, or otherwise fails to load in the browser.

## Design

`PanelArtwork` keeps the existing `StoryPanel.imageUrl` contract. A non-null URL is attempted as an image. If that image emits an error, the component replaces it with the existing deterministic placeholder using the same prompt-derived accessible label. Failure state belongs to the URL being rendered, so a later panel URL gets a fresh load attempt instead of inheriting the previous URL's failure.

No service, MCP, storage, or schema behavior changes. Captions, prompts, and panel layout remain visible throughout the fallback transition.

## Verification

Add widget tests that prove a failed image becomes the accessible placeholder and that a changed URL is attempted again. Follow the red-green cycle, then run the repository-selected `verify-change` command for the two modified files.
