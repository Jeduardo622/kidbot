import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  assertWidgetDistPreflight,
  runProductionWidgetDistPreflight,
} from '../scripts/smoke-production-widget-dist-preflight.mjs';

const textResponse = (body, status = 200, contentType = 'text/html') =>
  new Response(body, {
    headers: { 'content-type': contentType },
    status,
  });

const jsonResponse = (body, status = 200) =>
  textResponse(JSON.stringify(body), status, 'application/json');

test('production widget dist preflight validates health mode and built widget asset', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/healthz')) {
      return jsonResponse({
        ok: true,
        mode: 'dist',
        parentProfileStore: { mode: 'redis', ready: true },
      });
    }
    return textResponse('<script type="module" src="./assets/index-BYqblii3.js"></script>');
  };

  const result = await runProductionWidgetDistPreflight({
    fetchImpl,
    mcpBaseUrl: 'https://kidbot-mcp-server-production.up.railway.app/mcp',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mcpBaseUrl, 'https://kidbot-mcp-server-production.up.railway.app');
  assert.equal(result.health.mode, 'dist');
  assert.equal(result.health.parentProfileMode, 'redis');
  assert.equal(result.widget.builtAssetReference, 'assets/index-BYqblii3.js');
  assert.deepEqual(calls, [
    'https://kidbot-mcp-server-production.up.railway.app/healthz',
    'https://kidbot-mcp-server-production.up.railway.app/widget/',
  ]);
});

test('production widget dist preflight fails early when health reports fallback mode', () => {
  assert.throws(
    () =>
      assertWidgetDistPreflight({
        health: { ok: true, mode: 'fallback' },
        widgetHtml: '<script type="module" src="./assets/index-BYqblii3.js"></script>',
      }),
    /mode is not dist/i,
  );
});

test('production widget dist preflight fails early when widget HTML lacks built asset', () => {
  assert.throws(
    () =>
      assertWidgetDistPreflight({
        health: { ok: true, mode: 'dist' },
        widgetHtml: '<script src="./kidbot-fallback.js"></script>',
      }),
    /does not reference a built assets\/index-\*\.js bundle/i,
  );
});

test('production widget smoke workflow runs dist preflight before story panels smoke', async () => {
  const workflow = await readFile('.github/workflows/production-widget-story-panels-smoke.yml', 'utf8');
  const distPreflightIndex = workflow.indexOf('pnpm run smoke:production-widget-dist-preflight');
  const storyPanelsIndex = workflow.indexOf('pnpm run smoke:production-widget-story-panels');

  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /secrets\.KIDBOT_REMOTE_MCP_URL/);
  assert.ok(distPreflightIndex > 0, 'missing widget dist preflight step');
  assert.ok(storyPanelsIndex > distPreflightIndex, 'widget story smoke must run after dist preflight');
});
