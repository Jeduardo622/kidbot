import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createDrainGuard,
  createServiceLifecycle,
  isAgentProductionReady,
  resolveHealthStatus,
} from '../apps/mcp-server/src/serviceLifecycle.ts';

test('MCP requires an explicit ready agent using the production provider', () => {
  assert.equal(isAgentProductionReady({ provider: { mode: 'openai' } }), false);
  assert.equal(isAgentProductionReady({ ready: false, provider: { mode: 'openai' } }), false);
  assert.equal(isAgentProductionReady({ ready: true, provider: { mode: 'stub' } }), false);
  assert.equal(isAgentProductionReady({ ready: true, provider: { mode: 'openai' } }), true);
});

test('production health fails with 503 when the complete readiness contract is false', () => {
  assert.deepEqual(
    resolveHealthStatus({ nodeEnv: 'production', productionReady: false, storesReady: true }),
    { ok: false, status: 503 },
  );
  assert.deepEqual(
    resolveHealthStatus({ nodeEnv: 'production', productionReady: true, storesReady: true }),
    { ok: true, status: 200 },
  );
});

test('MCP drain guard rejects new MCP requests with 503', () => {
  let status;
  let body;
  let nextCalled = false;
  const response = {
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      body = value;
    },
  };

  createDrainGuard(() => true)({}, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(status, 503);
  assert.equal(body.error.message, 'service_draining');
});

test('MCP lifecycle drains before closing and releases stores on graceful close', async () => {
  const calls = [];
  let closeCallback;
  const lifecycle = createServiceLifecycle({
    server: {
      close(callback) {
        calls.push('server.close');
        closeCallback = callback;
      },
      closeIdleConnections() {
        calls.push('server.closeIdleConnections');
      },
    },
    closeResources: async () => calls.push('stores.close'),
    deadlineMs: 1_000,
  });

  assert.equal(lifecycle.isDraining(), false);
  const shutdown = lifecycle.shutdown();
  assert.equal(lifecycle.isDraining(), true);
  assert.deepEqual(calls, ['server.close', 'server.closeIdleConnections']);

  closeCallback();
  assert.equal(await shutdown, 'graceful');
  assert.deepEqual(calls, ['server.close', 'server.closeIdleConnections', 'stores.close']);
});

test('MCP lifecycle force-closes connections after its drain deadline', async () => {
  const calls = [];
  const lifecycle = createServiceLifecycle({
    server: {
      close() {
        calls.push('server.close');
      },
      closeAllConnections() {
        calls.push('server.closeAllConnections');
      },
    },
    closeResources: async () => calls.push('stores.close'),
    deadlineMs: 5,
  });

  assert.equal(await lifecycle.shutdown(), 'forced');
  assert.deepEqual(calls, ['server.close', 'server.closeAllConnections', 'stores.close']);
});
