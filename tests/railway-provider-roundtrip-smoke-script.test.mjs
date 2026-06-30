import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  classifyImageUrl,
  runHostedProviderRoundtripSmoke,
} from '../scripts/smoke-railway-provider-roundtrip.mjs';

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

test('Railway hosted smoke validates health, Supabase image URLs, and PNG fetch without exposing token', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ authorization: options.headers?.Authorization, url });

    if (url.endsWith('/healthz')) {
      return jsonResponse({
        ok: true,
        rateLimitStore: { mode: 'redis', ready: true },
        startupPosture: 'secured',
      });
    }

    if (url.endsWith('/story-panels')) {
      return jsonResponse({
        blocked: false,
        correlationId: 'kb_test',
        panels: [
          {
            imageUrl:
              'https://project-ref.supabase.co/storage/v1/object/public/kidbot-images/story-panels/one.png',
          },
          {
            imageUrl:
              'https://project-ref.supabase.co/storage/v1/object/public/kidbot-images/story-panels/two.png',
          },
        ],
      });
    }

    return new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { 'content-type': 'image/png' },
      status: 200,
    });
  };

  const result = await runHostedProviderRoundtripSmoke({
    baseUrl: 'https://kidbot-production.up.railway.app/path-that-is-trimmed',
    fetchImpl,
    serviceToken: 'service-token-abcdefghijklmnopqrstuvwxyz0123456789',
  });

  assert.equal(result.ok, true);
  assert.equal(result.baseUrl, 'https://kidbot-production.up.railway.app');
  assert.equal(result.storyPanels.imageUrlCount, 2);
  assert.deepEqual(result.storyPanels.imageUrlShapes, ['supabase-public-url', 'supabase-public-url']);
  assert.equal(result.storyPanels.firstImageFetch.contentType, 'image/png');
  assert.equal(JSON.stringify(result).includes('service-token'), false);
  assert.equal(calls[1].authorization, 'Bearer service-token-abcdefghijklmnopqrstuvwxyz0123456789');
});

test('Railway hosted smoke fails when provider response omits generated image URLs', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/healthz')) {
      return jsonResponse({
        ok: true,
        rateLimitStore: { mode: 'redis', ready: true },
        startupPosture: 'secured',
      });
    }
    return jsonResponse({
      blocked: false,
      panels: [{ imageUrl: null }, { imageUrl: null }],
    });
  };

  await assert.rejects(
    () =>
      runHostedProviderRoundtripSmoke({
        fetchImpl,
        serviceToken: 'service-token-abcdefghijklmnopqrstuvwxyz0123456789',
      }),
    /unexpected image URL shapes/i,
  );
});

test('Railway hosted smoke reports degraded provider failures without leaking token', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/healthz')) {
      return jsonResponse({
        ok: true,
        rateLimitStore: { mode: 'redis', ready: true },
        startupPosture: 'secured',
      });
    }
    return jsonResponse(
      {
        error: 'Service temporarily degraded',
        fallbackReason: 'generation_timeout',
        correlationId: 'kb_timeout',
      },
      503,
    );
  };

  await assert.rejects(
    () =>
      runHostedProviderRoundtripSmoke({
        fetchImpl,
        serviceToken: 'service-token-abcdefghijklmnopqrstuvwxyz0123456789',
      }),
    (error) =>
      error instanceof Error &&
      /generation_timeout/.test(error.message) &&
      /kb_timeout/.test(error.message) &&
      !error.message.includes('service-token'),
  );
});

test('Railway hosted smoke image URL classifier matches supported hosted shapes', () => {
  assert.equal(
    classifyImageUrl('https://project-ref.supabase.co/storage/v1/object/public/kidbot-images/story-panels/a.png'),
    'supabase-public-url',
  );
  assert.equal(classifyImageUrl('/generated-images/a.png'), 'local-url');
  assert.equal(classifyImageUrl('data:image/png;base64,abc'), 'data-url');
});

test('production workflow wires Railway hosted smoke behind protected production secrets', async () => {
  const workflow = await readFile('.github/workflows/production-railway-provider-smoke.yml', 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /secrets\.KIDBOT_AGENT_SERVICE_TOKEN/);
  assert.match(workflow, /pnpm run smoke:railway-provider-roundtrip/);
});
