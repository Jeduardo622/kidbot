import assert from 'node:assert/strict';
import { test } from 'node:test';

const strongSecret = 'parent-secret-abcdefghijklmnopqrstuvwxyz0123456789';
process.env.AGENT_SERVICE_TOKEN ??= 'service-token-abcdefghijklmnopqrstuvwxyz0123456789';
process.env.FALLBACK_WIDGET ??= '0';

const {
  createMemoryParentProfileStore,
  createParentProfileStoreFromConfig,
} = await import('../dist/parentStore.js');
const { parseMcpServerConfig } = await import('../dist/config.js');

test('parent profile config is disabled by default and needs no secret', () => {
  const config = parseMcpServerConfig({
    AGENT_SERVICE_TOKEN: 'service-token-abcdefghijklmnopqrstuvwxyz0123456789',
    FALLBACK_WIDGET: '0',
    NODE_ENV: 'production',
  });

  assert.equal(config.parentProfileStore, 'disabled');
  assert.equal(config.parentAuthSecret, undefined);
  assert.equal(config.agentBaseUrl, 'http://localhost:4505');
});

test('agent base url overrides local agent port for split-service deploys', () => {
  const config = parseMcpServerConfig({
    AGENT_BASE_URL: 'https://kidbot-agent-service.railway.internal/',
    AGENT_PORT: '4999',
    AGENT_SERVICE_TOKEN: 'service-token-abcdefghijklmnopqrstuvwxyz0123456789',
    FALLBACK_WIDGET: '0',
    NODE_ENV: 'production',
  });

  assert.equal(config.agentPort, 4999);
  assert.equal(config.agentBaseUrl, 'https://kidbot-agent-service.railway.internal');
});

test('agent base url rejects non-http values', () => {
  assert.throws(
    () =>
      parseMcpServerConfig({
        AGENT_BASE_URL: 'redis://kidbot-agent-service.internal',
        AGENT_SERVICE_TOKEN: 'service-token-abcdefghijklmnopqrstuvwxyz0123456789',
        FALLBACK_WIDGET: '0',
        NODE_ENV: 'production',
      }),
    /AGENT_BASE_URL must be a valid http\(s\) URL/i,
  );
});

test('redis parent profile storage requires a secret', () => {
  assert.throws(
    () =>
      parseMcpServerConfig({
        AGENT_SERVICE_TOKEN: 'service-token-abcdefghijklmnopqrstuvwxyz0123456789',
        FALLBACK_WIDGET: '0',
        NODE_ENV: 'production',
        PARENT_PROFILE_STORE: 'redis',
      }),
    /PARENT_AUTH_SECRET is required/i,
  );
});

test('redis parent profile storage rejects short production secrets without leaking them', () => {
  assert.throws(
    () =>
      parseMcpServerConfig({
        AGENT_SERVICE_TOKEN: 'service-token-abcdefghijklmnopqrstuvwxyz0123456789',
        FALLBACK_WIDGET: '0',
        NODE_ENV: 'production',
        PARENT_AUTH_SECRET: 'short-parent-secret',
        PARENT_PROFILE_STORE: 'redis',
      }),
    (error) =>
      error instanceof Error &&
      /at least 32 characters/i.test(error.message) &&
      !error.message.includes('short-parent-secret'),
  );
});

test('memory parent store saves only metadata with a valid token', async () => {
  const store = createMemoryParentProfileStore({
    maxEvents: 2,
    retentionDays: 30,
    secret: strongSecret,
  });
  const profile = await store.createProfile({
    ageBand: '7-9',
    sessionId: 'kb_session_store123',
  });

  assert.match(profile.profileId, /^kb_profile_/);
  assert.match(profile.parentAccessToken, /^kb_parent_/);
  assert.equal(await store.validateAccess(profile.profileId, profile.parentAccessToken), true);
  assert.equal(await store.validateAccess(profile.profileId, 'kb_parent_wrongtokenwrongtokenwrong'), false);
  assert.equal(JSON.stringify(profile).includes('tokenHash'), false);

  const event = {
    id: 'kb_event_one',
    timestamp: new Date().toISOString(),
    tool: 'voice_chat',
    sessionId: 'kb_session_store123',
    profileId: profile.profileId,
    ageBand: '7-9',
    status: 'ok',
    blocked: false,
    inputLength: 42,
    outputLength: 84,
  };
  assert.equal(await store.recordEvent(event, undefined), false);
  assert.equal(await store.recordEvent(event, 'kb_parent_wrongtokenwrongtokenwrong'), false);
  assert.equal(await store.recordEvent(event, profile.parentAccessToken), true);

  const events = await store.listHistory({
    profileId: profile.profileId,
    parentAccessToken: profile.parentAccessToken,
    sessionId: 'kb_session_store123',
  });
  assert.deepEqual(events, [event]);
  assert.equal(JSON.stringify(events).includes('Tell me'), false);
});

test('memory parent store caps history events', async () => {
  const store = createMemoryParentProfileStore({
    maxEvents: 2,
    retentionDays: 30,
    secret: strongSecret,
  });
  const profile = await store.createProfile({
    ageBand: '4-6',
    sessionId: 'kb_session_cap123',
  });

  for (const id of ['kb_event_one', 'kb_event_two', 'kb_event_three']) {
    await store.recordEvent(
      {
        id,
        timestamp: new Date().toISOString(),
        tool: 'science_sim',
        sessionId: 'kb_session_cap123',
        profileId: profile.profileId,
        ageBand: '4-6',
        status: 'ok',
        inputLength: 10,
        outputLength: 20,
      },
      profile.parentAccessToken,
    );
  }

  const events = await store.listHistory({
    profileId: profile.profileId,
    parentAccessToken: profile.parentAccessToken,
    sessionId: 'kb_session_cap123',
  });
  assert.deepEqual(
    events.map((event) => event.id),
    ['kb_event_three', 'kb_event_two'],
  );
});

test('redis parent store smoke records capped metadata when REDIS_URL is available', async (t) => {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    t.skip('REDIS_URL is not set');
    return;
  }

  const store = createParentProfileStoreFromConfig(
    {
      agentBaseUrl: 'http://localhost:4505',
      agentPort: 4505,
      fallbackMode: true,
      localDevIntent: true,
      mcpPort: 3000,
      parentAuthSecret: strongSecret,
      parentHistoryMaxEvents: 2,
      parentHistoryRetentionDays: 30,
      parentProfileStore: 'redis',
      serviceAuthToken: undefined,
      startupPosture: 'local-fallback',
    },
    { REDIS_URL: redisUrl },
  );

  try {
    const readiness = await store.readiness();
    if (!readiness.ready) {
      t.skip(`Redis is not ready: ${readiness.details ?? 'unknown'}`);
      return;
    }
    const profile = await store.createProfile({
      ageBand: '10-12',
      sessionId: `kb_session_redis${Date.now()}`,
    });
    for (const id of ['kb_event_redis1', 'kb_event_redis2', 'kb_event_redis3']) {
      await store.recordEvent(
        {
          id,
          timestamp: new Date().toISOString(),
          tool: 'story_panels',
          sessionId: `kb_session_redis${Date.now()}`,
          profileId: profile.profileId,
          ageBand: '10-12',
          status: 'ok',
          inputLength: 11,
          outputLength: 22,
        },
        profile.parentAccessToken,
      );
    }
    const events = await store.listHistory({
      profileId: profile.profileId,
      parentAccessToken: profile.parentAccessToken,
      limit: 2,
    });
    assert.equal(events.length, 2);
  } finally {
    await store.close?.();
  }
});
