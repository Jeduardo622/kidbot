import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  classifyImageUrl,
  runProductionMcpStoryPanelsSmoke,
} from '../scripts/smoke-production-mcp-story-panels.mjs';

const sseResponse = (body, status = 200) =>
  new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
    status,
  });

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

test('production MCP story panels smoke validates MCP health, Supabase image URLs, and PNG fetch', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ body: options.body, method: options.method, url });

    if (url.endsWith('/healthz')) {
      return jsonResponse({
        ok: true,
        parentProfileStore: { mode: 'redis', ready: true },
      });
    }

    if (url.endsWith('/mcp')) {
      return sseResponse({
        jsonrpc: '2.0',
        id: 301,
        result: {
          structuredContent: {
            blocked: false,
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
          },
        },
      });
    }

    return new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { 'content-type': 'image/png' },
      status: 200,
    });
  };

  const result = await runProductionMcpStoryPanelsSmoke({
    fetchImpl,
    mcpBaseUrl: 'https://kidbot-mcp-production.up.railway.app/mcp',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mcpBaseUrl, 'https://kidbot-mcp-production.up.railway.app');
  assert.equal(result.health.ok, true);
  assert.equal(result.health.parentProfileMode, 'redis');
  assert.equal(result.storyPanels.blocked, false);
  assert.equal(result.storyPanels.panelCount, 2);
  assert.equal(result.storyPanels.imageUrlCount, 2);
  assert.deepEqual(result.storyPanels.imageUrlShapes, ['supabase-public-url', 'supabase-public-url']);
  assert.equal(result.storyPanels.firstImageFetch.contentType, 'image/png');

  const mcpCall = JSON.parse(calls.find((call) => call.url.endsWith('/mcp')).body);
  assert.equal(mcpCall.method, 'tools/call');
  assert.equal(mcpCall.params.name, 'story_panels');
  assert.equal(mcpCall.params.arguments.panels, 2);
  assert.equal(mcpCall.params.arguments.ageBand, '7-9');
});

test('production MCP story panels smoke rejects missing generated image URLs', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/healthz')) {
      return jsonResponse({
        ok: true,
        parentProfileStore: { mode: 'redis', ready: true },
      });
    }

    return sseResponse({
      jsonrpc: '2.0',
      id: 301,
      result: {
        structuredContent: {
          blocked: false,
          panels: [{ imageUrl: null }, { imageUrl: null }],
        },
      },
    });
  };

  await assert.rejects(
    () =>
      runProductionMcpStoryPanelsSmoke({
        fetchImpl,
        mcpBaseUrl: 'https://kidbot-mcp-production.up.railway.app',
      }),
    /unexpected image URL shapes/i,
  );
});

test('production MCP story panels smoke reports MCP tool errors without leaking image URLs', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/healthz')) {
      return jsonResponse({
        ok: true,
        parentProfileStore: { mode: 'redis', ready: true },
      });
    }

    return sseResponse({
      jsonrpc: '2.0',
      id: 301,
      result: {
        isError: true,
        structuredContent: {
          error: 'Service temporarily degraded',
          fallbackReason: 'generation_timeout',
          correlationId: 'kb_timeout',
        },
      },
    });
  };

  await assert.rejects(
    () =>
      runProductionMcpStoryPanelsSmoke({
        fetchImpl,
        mcpBaseUrl: 'https://kidbot-mcp-production.up.railway.app',
      }),
    (error) =>
      error instanceof Error &&
      /generation_timeout/.test(error.message) &&
      /kb_timeout/.test(error.message) &&
      !error.message.includes('/storage/v1/object/public/'),
  );
});

test('production MCP story panels image URL classifier matches hosted shapes', () => {
  assert.equal(
    classifyImageUrl('https://project-ref.supabase.co/storage/v1/object/public/kidbot-images/story-panels/a.png'),
    'supabase-public-url',
  );
  assert.equal(classifyImageUrl('/generated-images/a.png'), 'local-url');
  assert.equal(classifyImageUrl('data:image/png;base64,abc'), 'data-url');
});

test('production MCP story panels workflow uses protected remote MCP URL secret', async () => {
  const workflow = await readFile('.github/workflows/production-mcp-story-panels-smoke.yml', 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /secrets\.KIDBOT_REMOTE_MCP_URL/);
  assert.match(workflow, /pnpm run smoke:production-mcp-story-panels/);
});
