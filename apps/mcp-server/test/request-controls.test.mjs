import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.AGENT_SERVICE_TOKEN ??= 'service-token-abcdefghijklmnopqrstuvwxyz0123456789';
process.env.FALLBACK_WIDGET ??= '0';

const {
  computeToolCost,
  createCallerKey,
  createMemoryRequestControlStore,
  createRedisRequestControlStore,
  createRequestControlStoreFromConfig,
} = await import('../dist/requestControls.js');
const { parseMcpServerConfig } = await import('../dist/config.js');

const limits = {
  callerRequestsPerMinute: 10,
  networkRequestsPerMinute: 10,
  globalRequestsPerMinute: 10,
  callerCostPerMinute: 5,
  networkCostPerMinute: 10,
  globalCostPerMinute: 8,
  callerConcurrency: 1,
  networkConcurrency: 2,
  globalConcurrency: 2,
  leaseMs: 1_000,
};

test('tool costs reflect provider fan-out', () => {
  assert.equal(computeToolCost('parent_history_list', {}), 1);
  assert.equal(computeToolCost('voice_chat', {}), 3);
  assert.equal(computeToolCost('story_panels', { panels: 6 }), 9);
  assert.equal(computeToolCost('coloring_outline', {}), 2);
  assert.equal(computeToolCost('science_sim', {}), 3);
});

test('production parent storage defaults MCP controls to shared Redis with bounded limits', () => {
  const config = parseMcpServerConfig({
    AGENT_SERVICE_TOKEN: 'service-token-abcdefghijklmnopqrstuvwxyz0123456789',
    FALLBACK_WIDGET: '0',
    NODE_ENV: 'production',
    PARENT_AUTH_SECRET: 'parent-secret-abcdefghijklmnopqrstuvwxyz0123456789',
    PARENT_PROFILE_STORE: 'redis',
  });
  assert.equal(config.requestControlStore, 'redis');
  assert.deepEqual(config.requestControlLimits, {
    callerRequestsPerMinute: 60,
    networkRequestsPerMinute: 120,
    globalRequestsPerMinute: 600,
    callerCostPerMinute: 60,
    networkCostPerMinute: 120,
    globalCostPerMinute: 600,
    callerConcurrency: 2,
    networkConcurrency: 4,
    globalConcurrency: 8,
    leaseMs: 50_000,
  });
  assert.equal(config.agentRequestTimeoutMs, 45_000);
});

test('MCP control configuration rejects unsafe numeric values', () => {
  assert.throws(
    () => parseMcpServerConfig({
      AGENT_SERVICE_TOKEN: 'service-token-abcdefghijklmnopqrstuvwxyz0123456789',
      FALLBACK_WIDGET: '0',
      MCP_CALLER_COST_PER_MINUTE: '0',
      NODE_ENV: 'test',
    }),
    /MCP_CALLER_COST_PER_MINUTE must be a positive integer/i,
  );
});

test('Redis control configuration fails closed without REDIS_URL', () => {
  const config = parseMcpServerConfig({
    AGENT_SERVICE_TOKEN: 'service-token-abcdefghijklmnopqrstuvwxyz0123456789',
    FALLBACK_WIDGET: '0',
    NODE_ENV: 'production',
  });
  assert.throws(
    () => createRequestControlStoreFromConfig(config, {}),
    /REDIS_URL is required when MCP_REQUEST_CONTROL_STORE=redis/i,
  );
});

test('caller keys are stable and do not expose raw network identifiers', () => {
  const first = createCallerKey({
    secret: 'test-control-secret',
    profileId: undefined,
    headers: { 'user-agent': 'Kidbot-Test', 'x-forwarded-for': '203.0.113.9, 10.0.0.2' },
    remoteAddress: '10.0.0.2',
  });
  const second = createCallerKey({
    secret: 'test-control-secret',
    profileId: undefined,
    headers: { 'user-agent': 'Kidbot-Test', 'x-forwarded-for': '203.0.113.9, 10.0.0.2' },
    remoteAddress: '10.0.0.2',
  });
  assert.equal(first, second);
  assert.match(first, /^network:[a-f0-9]{64}$/);
  assert.equal(first.includes('203.0.113.9'), false);
  const profileKey = createCallerKey({
      secret: 'test-control-secret',
      profileId: 'kb_profile_authorized123',
      headers: {},
      remoteAddress: undefined,
    });
  assert.match(profileKey, /^profile:[a-f0-9]{64}$/);
  assert.equal(profileKey.includes('kb_profile_authorized123'), false);
  const subjectKey = createCallerKey({
    secret: 'test-control-secret',
    subject: 'anonymous-openai-subject',
    profileId: undefined,
    headers: {},
    remoteAddress: undefined,
  });
  assert.match(subjectKey, /^subject:[a-f0-9]{64}$/);
  assert.equal(subjectKey.includes('anonymous-openai-subject'), false);
});

test('memory controls enforce caller cost and release concurrency leases', async () => {
  let now = 1_000;
  const store = createMemoryRequestControlStore({ now: () => now });

  const first = await store.acquire({ callerKey: 'subject:a', networkKey: 'network:a', cost: 3, limits });
  assert.equal(first.allowed, true);

  const concurrent = await store.acquire({ callerKey: 'subject:a', networkKey: 'network:a', cost: 1, limits });
  assert.deepEqual(concurrent, { allowed: false, reason: 'caller_concurrency', retryAfterMs: 1_000 });

  await first.release();
  const second = await store.acquire({ callerKey: 'subject:a', networkKey: 'network:a', cost: 2, limits });
  assert.equal(second.allowed, true);
  await second.release();

  const overCost = await store.acquire({ callerKey: 'subject:a', networkKey: 'network:a', cost: 1, limits });
  assert.equal(overCost.allowed, false);
  assert.equal(overCost.reason, 'caller_cost');

  now += 60_001;
  const reset = await store.acquire({ callerKey: 'subject:a', networkKey: 'network:a', cost: 1, limits });
  assert.equal(reset.allowed, true);
  await reset.release();
});

test('memory controls enforce global request and concurrency ceilings', async () => {
  const store = createMemoryRequestControlStore({ now: () => 5_000 });
  const globalLimits = { ...limits, globalRequestsPerMinute: 3 };
  const first = await store.acquire({ callerKey: 'subject:a', networkKey: 'network:a', cost: 1, limits: globalLimits });
  const second = await store.acquire({ callerKey: 'subject:b', networkKey: 'network:b', cost: 1, limits: globalLimits });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);

  const blockedConcurrency = await store.acquire({ callerKey: 'subject:c', networkKey: 'network:c', cost: 1, limits: globalLimits });
  assert.equal(blockedConcurrency.allowed, false);
  assert.equal(blockedConcurrency.reason, 'global_concurrency');

  await first.release();
  const third = await store.acquire({ callerKey: 'subject:c', networkKey: 'network:c', cost: 1, limits: globalLimits });
  assert.equal(third.allowed, true);
  await second.release();
  await third.release();

  const blockedRequests = await store.acquire({ callerKey: 'subject:d', networkKey: 'network:d', cost: 1, limits: globalLimits });
  assert.equal(blockedRequests.allowed, false);
  assert.equal(blockedRequests.reason, 'global_requests');
});

test('rotating caller subjects cannot evade the server-derived network budget', async () => {
  const store = createMemoryRequestControlStore({ now: () => 10_000 });
  const networkLimits = { ...limits, networkRequestsPerMinute: 2 };
  for (const subject of ['subject:a', 'subject:b']) {
    const lease = await store.acquire({
      callerKey: subject, networkKey: 'network:shared', cost: 1, limits: networkLimits,
    });
    assert.equal(lease.allowed, true);
    await lease.release();
  }
  const rotated = await store.acquire({
    callerKey: 'subject:c', networkKey: 'network:shared', cost: 1, limits: networkLimits,
  });
  assert.equal(rotated.allowed, false);
  assert.equal(rotated.reason, 'network_requests');
});

test('an expired memory lease cannot release a newer concurrency owner', async () => {
  let now = 1_000;
  const store = createMemoryRequestControlStore({ now: () => now });
  const leaseLimits = {
    ...limits,
    callerConcurrency: 1,
    networkConcurrency: 1,
    globalConcurrency: 1,
    leaseMs: 10,
  };
  const first = await store.acquire({
    callerKey: 'subject:aba', networkKey: 'network:aba', cost: 1, limits: leaseLimits,
  });
  assert.equal(first.allowed, true);
  now += 11;
  const second = await store.acquire({
    callerKey: 'subject:aba', networkKey: 'network:aba', cost: 1, limits: leaseLimits,
  });
  assert.equal(second.allowed, true);
  await first.release();
  const third = await store.acquire({
    callerKey: 'subject:aba', networkKey: 'network:aba', cost: 1, limits: leaseLimits,
  });
  assert.equal(third.allowed, false);
  assert.equal(third.reason, 'caller_concurrency');
  await second.release();
});

test('redis controls share cost and concurrency limits across instances', async (t) => {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    t.skip('REDIS_URL is not set');
    return;
  }
  const keyPrefix = `test:kidbot:controls:${Date.now()}:${Math.random()}`;
  const firstStore = createRedisRequestControlStore(redisUrl, { keyPrefix });
  const secondStore = createRedisRequestControlStore(redisUrl, { keyPrefix });
  try {
    const first = await firstStore.acquire({ callerKey: 'subject:a', networkKey: 'network:a', cost: 3, limits });
    assert.equal(first.allowed, true);
    const concurrent = await secondStore.acquire({ callerKey: 'subject:a', networkKey: 'network:a', cost: 1, limits });
    assert.equal(concurrent.allowed, false);
    assert.equal(concurrent.reason, 'caller_concurrency');

    await first.release();
    const second = await secondStore.acquire({ callerKey: 'subject:a', networkKey: 'network:a', cost: 2, limits });
    assert.equal(second.allowed, true);
    await second.release();

    const overCost = await firstStore.acquire({ callerKey: 'subject:a', networkKey: 'network:a', cost: 1, limits });
    assert.equal(overCost.allowed, false);
    assert.equal(overCost.reason, 'caller_cost');

    const leaseLimits = {
      ...limits,
      callerRequestsPerMinute: 100,
      networkRequestsPerMinute: 100,
      globalRequestsPerMinute: 100,
      callerCostPerMinute: 100,
      networkCostPerMinute: 100,
      globalCostPerMinute: 100,
      callerConcurrency: 1,
      networkConcurrency: 1,
      globalConcurrency: 1,
      leaseMs: 20,
    };
    const stale = await firstStore.acquire({
      callerKey: 'subject:aba', networkKey: 'network:aba', cost: 1, limits: leaseLimits,
    });
    assert.equal(stale.allowed, true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const current = await secondStore.acquire({
      callerKey: 'subject:aba', networkKey: 'network:aba', cost: 1, limits: leaseLimits,
    });
    assert.equal(current.allowed, true);
    await stale.release();
    const blockedByCurrent = await firstStore.acquire({
      callerKey: 'subject:aba', networkKey: 'network:aba', cost: 1, limits: leaseLimits,
    });
    assert.equal(blockedByCurrent.allowed, false);
    assert.equal(blockedByCurrent.reason, 'caller_concurrency');
    await current.release();
  } finally {
    await firstStore.close?.();
    await secondStore.close?.();
  }
});
