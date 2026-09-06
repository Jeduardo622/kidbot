# Smoke log

Dated evidence that the provider-backed path works end to end. Append a row
after each live run; keep secrets and full image URLs out.

| Date | Run | Branch / commit | Result |
|------|-----|-----------------|--------|
| 2026-09-06 | `pnpm run smoke:provider-preflight` (local, Supabase image storage) | `feat/phase-0-1` on top of `3c128a4` | ok: moderation `omni-moderation-latest` not flagged; `/story-panels` 200, 2 panels, 2 Supabase public image URLs; first PNG fetched 200 `image/png` 1,678,519 bytes |

## Notes

- 2026-09-06: first recorded live run. Text, moderation, and `gpt-image-2` image
  generation all succeed against the current OpenAI SDK, so the earlier concern
  that the image parameters had never worked live is closed.
