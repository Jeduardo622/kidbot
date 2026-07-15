# Kidbot Privacy Policy

Last updated: July 13, 2026

## What Kidbot processes

Kidbot processes prompts, selected persona and age band, generated text, story image prompts and images, and optional session and parent-profile metadata needed to provide the requested feature. Parent access tokens and service credentials are used for authorization and are not included in activity history or request-summary logs.

Request-summary logs contain route, status, timing, sizes, safety and provider outcomes, age band, and keyed pseudonymous session or profile references in secured deployments. They do not contain raw session or profile identifiers, prompts, tokens, PINs, generated content, or full image URLs. Local fallback logs omit session and profile references.

## Service providers and purposes

- **OpenAI** processes prompts and generated outputs for moderation and AI text or image generation when provider-backed features are enabled.
- **Railway** hosts the Kidbot services and Redis deployment, so it processes requests, operational logs, parent profiles, and consented metadata-only activity history as needed to operate the service.
- **Supabase Storage** stores generated story-panel images when production image storage is configured for Supabase. The image object URL is public while the object exists and may be cached by browsers or networks.
- **Browser speech services** may send microphone audio to the browser, operating-system, or speech-service provider chosen by the user agent. Kidbot receives the recognized text, not the raw microphone audio. Browser speech synthesis uses the browser or operating system to play returned text.

## Retention

When a parent explicitly enables history, Kidbot retains the parent profile and metadata-only session history for **30 days** from activity, subject to the configured history event limit. History does not include prompts, responses, PINs, tokens, or generated artifacts.

Generated story images are configured for a **24 hours** retention period. Cleanup of local or Supabase image objects is best effort, and cached copies may remain outside Kidbot after the source object expires.

Kidbot does not set or guarantee each provider's independent security, backup, abuse-monitoring, or legal retention. Provider terms and the operator's account settings also apply.

## Deletion and limitations

An authorized parent can use the parent profile deletion control to delete the Kidbot parent profile and its associated session and history records from the active Kidbot store.

That deletion cannot recall data already processed or independently retained by OpenAI, Railway, Supabase, browser or operating-system speech services, backups, or caches. Kidbot does not currently offer an individual generated-image deletion control; image cleanup follows the 24 hours best-effort retention process.

## Contact

For privacy, deletion, or support requests, open an issue at <https://github.com/Jeduardo622/kidbot/issues>.

This operational disclosure describes the current Kidbot implementation. Privacy and legal review is required before public launch.
