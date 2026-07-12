import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { asyncRoute } from '../apps/mcp-server/src/async-route.ts';

test('forwards a rejected route promise to Express error middleware', async () => {
  const failure = new Error('readiness unavailable');
  let forwarded;
  const route = asyncRoute(async () => Promise.reject(failure));

  route({}, {}, (error) => {
    forwarded = error;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(forwarded, failure);
});

test('does not invoke error middleware for a resolved route', async () => {
  let forwarded = false;
  const route = asyncRoute(async () => undefined);

  route({}, {}, () => {
    forwarded = true;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(forwarded, false);
});

test('all asynchronous MCP Express routes use the rejection-forwarding adapter', async () => {
  const server = await readFile('apps/mcp-server/src/server.ts', 'utf8');
  assert.match(server, /app\.get\('\/healthz', asyncRoute\(async/);
  assert.match(server, /app\.post\('\/mcp', asyncRoute\(async/);
});
