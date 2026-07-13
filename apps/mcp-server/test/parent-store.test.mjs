import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Redis } from 'ioredis';

const strongSecret = 'parent-secret-abcdefghijklmnopqrstuvwxyz0123456789';
const productionWidgetEnv = {
  KIDBOT_WIDGET_DOMAIN: 'https://kidbot-production.up.railway.app',
  KIDBOT_WIDGET_RESOURCE_DOMAINS: 'https://rxnwualzddplucjhclij.supabase.co',
};
process.env.AGENT_SERVICE_TOKEN ??= 'service-token-abcdefghijklmnopqrstuvwxyz0123456789';
process.env.FALLBACK_WIDGET ??= '0';

const eventForProfile = (profile, sessionId, id) => ({
  id,
  timestamp: new Date().toISOString(),
  tool: 'voice_chat',
  sessionId,
  profileId: profile.profileId,
  ageBand: profile.ageBand,
  status: 'ok',
  blocked: false,
  inputLength: 8,
  outputLength: 16,
});

const interceptAgeBandUpdate = (profileId) => {
  const originalEval = Redis.prototype.eval;
  let releaseUpdate;
  let updateObserved;
  const updateReached = new Promise((resolve) => {
    updateObserved = resolve;
  });
  const updateRelease = new Promise((resolve) => {
    releaseUpdate = resolve;
  });
  Redis.prototype.eval = async function (...args) {
    const profileUpdate = args.some((arg) => {
      if (typeof arg !== 'string' || !arg.startsWith('{')) return false;
      try {
        const value = JSON.parse(arg);
        return value.ageBand === '10-12' && typeof value.updatedAt === 'string' && !value.sessionId;
      } catch {
        return false;
      }
    });
    if (args.includes(`kidbot:profile:${profileId}`) && profileUpdate) {
      updateObserved();
      await updateRelease;
    }
    return originalEval.apply(this, args);
  };
  return {
    release: () => releaseUpdate(),
    reached: updateReached,
    restore: () => {
      releaseUpdate();
      Redis.prototype.eval = originalEval;
    },
  };
};

const {
  createMemoryParentProfileStore,
  createParentProfileStoreFromConfig,
} = await import('../dist/parentStore.js');
const { parseMcpServerConfig } = await import('../dist/config.js');

test('parent profile config is disabled by default and needs no secret', () => {
  const config = parseMcpServerConfig({
    ...productionWidgetEnv,
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
    ...productionWidgetEnv,
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
        ...productionWidgetEnv,
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
        ...productionWidgetEnv,
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
        ...productionWidgetEnv,
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
    historyEnabled: true,
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

test('memory parent store rejects cross-profile session reads and writes', async () => {
  const store = createMemoryParentProfileStore({
    maxEvents: 10,
    retentionDays: 30,
    secret: strongSecret,
  });
  const owner = await store.createProfile({
    ageBand: '7-9',
    historyEnabled: true,
    sessionId: 'kb_session_owner123',
  });
  const attacker = await store.createProfile({
    ageBand: '10-12',
    historyEnabled: true,
    sessionId: 'kb_session_attacker123',
  });
  const ownerEvent = {
    id: 'kb_event_owner',
    timestamp: new Date().toISOString(),
    tool: 'voice_chat',
    sessionId: 'kb_session_owner123',
    profileId: owner.profileId,
    ageBand: '7-9',
    status: 'ok',
    blocked: false,
    inputLength: 12,
    outputLength: 24,
  };
  assert.equal(await store.recordEvent(ownerEvent, owner.parentAccessToken), true);

  assert.deepEqual(
    await store.listHistory({
      profileId: attacker.profileId,
      parentAccessToken: attacker.parentAccessToken,
      sessionId: 'kb_session_owner123',
    }),
    [],
  );
  assert.equal(
    await store.recordEvent(
      {
        ...ownerEvent,
        id: 'kb_event_cross_profile',
        profileId: attacker.profileId,
      },
      attacker.parentAccessToken,
    ),
    false,
  );

  const ownerHistory = await store.listHistory({
    profileId: owner.profileId,
    parentAccessToken: owner.parentAccessToken,
    sessionId: 'kb_session_owner123',
  });
  assert.deepEqual(ownerHistory.map((event) => event.id), ['kb_event_owner']);
});

test('memory parent store cannot reassign a session during profile creation', async () => {
  const store = createMemoryParentProfileStore({
    maxEvents: 10,
    retentionDays: 30,
    secret: strongSecret,
  });
  const owner = await store.createProfile({
    ageBand: '7-9',
    historyEnabled: true,
    sessionId: 'kb_session_claimed123',
  });

  await assert.rejects(
    store.createProfile({
      ageBand: '10-12',
      historyEnabled: true,
      sessionId: 'kb_session_claimed123',
    }),
    /parent profile could not be created/i,
  );

  assert.equal(await store.validateAccess(owner.profileId, owner.parentAccessToken), true);
});

test('memory parent store caps history events', async () => {
  const store = createMemoryParentProfileStore({
    maxEvents: 2,
    retentionDays: 30,
    secret: strongSecret,
  });
  const profile = await store.createProfile({
    ageBand: '4-6',
    historyEnabled: true,
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

test('memory parent store requires explicit history consent', async () => {
  const store = createMemoryParentProfileStore({
    maxEvents: 10,
    retentionDays: 30,
    secret: strongSecret,
  });

  await assert.rejects(
    store.createProfile({ ageBand: '7-9', sessionId: 'kb_session_noconsent123' }),
    /explicit history consent is required/i,
  );
  await assert.rejects(
    store.createProfile({
      ageBand: '7-9',
      historyEnabled: false,
      sessionId: 'kb_session_falseconsent123',
    }),
    /explicit history consent is required/i,
  );
});

test('memory parent store expires profiles and releases their sessions', async () => {
  const store = createMemoryParentProfileStore({
    maxEvents: 10,
    retentionDays: 0,
    secret: strongSecret,
  });
  const sessionId = 'kb_session_expired123';
  const profile = await store.createProfile({ ageBand: '7-9', historyEnabled: true, sessionId });

  assert.equal(await store.validateAccess(profile.profileId, profile.parentAccessToken), false);
  await assert.rejects(
    store.listHistory({ profileId: profile.profileId, parentAccessToken: profile.parentAccessToken }),
    /invalid parent access token/i,
  );
  await assert.rejects(
    store.updateProfile({
      profileId: profile.profileId,
      parentAccessToken: profile.parentAccessToken,
      ageBand: '10-12',
    }),
    /invalid parent access token/i,
  );
  const replacement = await store.createProfile({ ageBand: '10-12', historyEnabled: true, sessionId });
  assert.notEqual(replacement.profileId, profile.profileId);
});

test('memory parent store purges history when disabled', async () => {
  const store = createMemoryParentProfileStore({
    maxEvents: 10,
    retentionDays: 30,
    secret: strongSecret,
  });
  const sessionId = 'kb_session_disable123';
  const profile = await store.createProfile({ ageBand: '7-9', historyEnabled: true, sessionId });
  await store.recordEvent({
    id: 'kb_event_disable',
    timestamp: new Date().toISOString(),
    tool: 'voice_chat',
    sessionId,
    profileId: profile.profileId,
    ageBand: '7-9',
    status: 'ok',
    inputLength: 1,
    outputLength: 2,
  }, profile.parentAccessToken);

  const disabled = await store.updateProfile({
    profileId: profile.profileId,
    parentAccessToken: profile.parentAccessToken,
    historyEnabled: false,
  });
  assert.equal(disabled.historyEnabled, false);
  const enabled = await store.updateProfile({
    profileId: profile.profileId,
    parentAccessToken: profile.parentAccessToken,
    historyEnabled: true,
  });
  assert.equal(enabled.historyEnabled, true);
  assert.deepEqual(await store.listHistory({
    profileId: profile.profileId,
    parentAccessToken: profile.parentAccessToken,
  }), []);
});

test('memory parent store deletes only with the owning token', async () => {
  const store = createMemoryParentProfileStore({
    maxEvents: 10,
    retentionDays: 30,
    secret: strongSecret,
  });
  const owner = await store.createProfile({
    ageBand: '7-9',
    historyEnabled: true,
    sessionId: 'kb_session_deleteowner123',
  });
  const other = await store.createProfile({
    ageBand: '10-12',
    historyEnabled: true,
    sessionId: 'kb_session_deleteother123',
  });

  await assert.rejects(
    store.deleteProfile({ profileId: owner.profileId, parentAccessToken: other.parentAccessToken }),
    /invalid parent access token/i,
  );
  assert.deepEqual(
    await store.deleteProfile({ profileId: owner.profileId, parentAccessToken: owner.parentAccessToken }),
    { deleted: true, profileId: owner.profileId },
  );
  assert.equal(await store.validateAccess(owner.profileId, owner.parentAccessToken), false);
  assert.equal(await store.validateAccess(other.profileId, other.parentAccessToken), true);
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
  const cleanupProfileIds = [];
  const cleanupSessionIds = [];

  try {
    const readiness = await store.readiness();
    if (!readiness.ready) {
      t.skip(`Redis is not ready: ${readiness.details ?? 'unknown'}`);
      return;
    }
    const profileSessionId = `kb_session_redis${Date.now()}`;
    const profile = await store.createProfile({
      ageBand: '10-12',
      historyEnabled: true,
      sessionId: profileSessionId,
    });
    cleanupProfileIds.push(profile.profileId);
    cleanupSessionIds.push(profileSessionId);
    const otherSessionId = `kb_session_other${Date.now()}`;
    const otherProfile = await store.createProfile({
      ageBand: '7-9',
      historyEnabled: true,
      sessionId: otherSessionId,
    });
    cleanupProfileIds.push(otherProfile.profileId);
    cleanupSessionIds.push(otherSessionId);
    for (const id of ['kb_event_redis1', 'kb_event_redis2', 'kb_event_redis3']) {
      await store.recordEvent(
        {
          id,
          timestamp: new Date().toISOString(),
          tool: 'story_panels',
          sessionId: profileSessionId,
          profileId: profile.profileId,
          ageBand: '10-12',
          status: 'ok',
          inputLength: 11,
          outputLength: 22,
        },
        profile.parentAccessToken,
      );
    }
    const seedClient = new Redis(redisUrl);
    try {
      await seedClient.lpush(
        `kidbot:session:${profileSessionId}:events`,
        JSON.stringify({
          id: 'kb_event_legacy_contamination',
          timestamp: new Date().toISOString(),
          tool: 'voice_chat',
          sessionId: profileSessionId,
          profileId: otherProfile.profileId,
          ageBand: '7-9',
          status: 'ok',
          blocked: false,
          inputLength: 99,
          outputLength: 99,
        }),
      );
    } finally {
      seedClient.disconnect();
    }
    const events = await store.listHistory({
      profileId: profile.profileId,
      parentAccessToken: profile.parentAccessToken,
      limit: 2,
    });
    assert.equal(events.length, 2);
    assert.equal(events.every((event) => event.profileId === profile.profileId), true);
    assert.equal(events.some((event) => event.id === 'kb_event_legacy_contamination'), false);
    const ownedSessionId = events[0]?.sessionId;
    assert.ok(ownedSessionId);
    assert.deepEqual(
      await store.listHistory({
        profileId: otherProfile.profileId,
        parentAccessToken: otherProfile.parentAccessToken,
        sessionId: ownedSessionId,
      }),
      [],
    );
    assert.equal(
      await store.recordEvent(
        {
          ...events[0],
          id: 'kb_event_redis_cross_profile',
          profileId: otherProfile.profileId,
        },
        otherProfile.parentAccessToken,
      ),
      false,
    );

    const ttlClient = new Redis(redisUrl);
    try {
      const ownedKeys = [
        `kidbot:profile:${profile.profileId}`,
        `kidbot:profile:${profile.profileId}:sessions`,
        `kidbot:session:${profileSessionId}`,
        `kidbot:session:${profileSessionId}:events`,
      ];
      for (const key of ownedKeys) assert.ok(await ttlClient.pttl(key) > 0, `${key} must expire`);
      for (const key of ownedKeys) await ttlClient.pexpire(key, 1_000);
      assert.equal(await store.validateAccess(profile.profileId, profile.parentAccessToken), true);
      for (const key of ownedKeys) assert.ok(await ttlClient.pttl(key) > 1_000, `${key} must renew`);

      const purgeSessionId = `kb_session_purge${Date.now()}`;
      cleanupSessionIds.push(purgeSessionId);
      const purgeProfile = await store.createProfile({
        ageBand: '7-9',
        historyEnabled: true,
        sessionId: purgeSessionId,
      });
      cleanupProfileIds.push(purgeProfile.profileId);
      await store.recordEvent(
        eventForProfile(purgeProfile, purgeSessionId, 'kb_event_purge'),
        purgeProfile.parentAccessToken,
      );
      const disabled = await store.updateProfile({
        profileId: purgeProfile.profileId,
        parentAccessToken: purgeProfile.parentAccessToken,
        historyEnabled: false,
      });
      assert.equal(disabled.historyEnabled, false);
      assert.ok(await ttlClient.pttl(`kidbot:profile:${purgeProfile.profileId}`) > 0);
      assert.equal(await ttlClient.exists(`kidbot:profile:${purgeProfile.profileId}:sessions`), 0);
      assert.equal(await ttlClient.exists(`kidbot:session:${purgeSessionId}`), 0);
      assert.equal(await ttlClient.exists(`kidbot:session:${purgeSessionId}:events`), 0);
    } finally {
      ttlClient.disconnect();
    }

    const sharedSessionId = `kb_session_shared${Date.now()}`;
    cleanupSessionIds.push(sharedSessionId);
    const eventFor = (owner, id) => ({
      id,
      timestamp: new Date().toISOString(),
      tool: 'voice_chat',
      sessionId: sharedSessionId,
      profileId: owner.profileId,
      ageBand: owner.ageBand,
      status: 'ok',
      blocked: false,
      inputLength: 8,
      outputLength: 16,
    });
    const claims = await Promise.all([
      store.recordEvent(eventFor(profile, 'kb_event_claim_a'), profile.parentAccessToken),
      store.recordEvent(eventFor(otherProfile, 'kb_event_claim_b'), otherProfile.parentAccessToken),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);

    const duplicateSessionId = `kb_session_duplicate${Date.now()}`;
    cleanupSessionIds.push(duplicateSessionId);
    const duplicateClaims = await Promise.allSettled([
      store.createProfile({ ageBand: '7-9', historyEnabled: true, sessionId: duplicateSessionId }),
      store.createProfile({ ageBand: '10-12', historyEnabled: true, sessionId: duplicateSessionId }),
    ]);
    assert.equal(duplicateClaims.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(duplicateClaims.filter((result) => result.status === 'rejected').length, 1);
    for (const result of duplicateClaims) {
      if (result.status === 'fulfilled') cleanupProfileIds.push(result.value.profileId);
    }

    const raceSessionId = `kb_session_race${Date.now()}`;
    cleanupSessionIds.push(raceSessionId);
    const raceProfile = await store.createProfile({
      ageBand: '7-9',
      historyEnabled: true,
      sessionId: raceSessionId,
    });
    cleanupProfileIds.push(raceProfile.profileId);
    const deleteRace = interceptAgeBandUpdate(raceProfile.profileId);
    try {
      const update = store.updateProfile({
        profileId: raceProfile.profileId,
        parentAccessToken: raceProfile.parentAccessToken,
        ageBand: '10-12',
      });
      await deleteRace.reached;
      await store.deleteProfile({
        profileId: raceProfile.profileId,
        parentAccessToken: raceProfile.parentAccessToken,
      });
      deleteRace.release();
      await assert.rejects(update, /invalid parent access token/i);
      assert.equal(await store.validateAccess(raceProfile.profileId, raceProfile.parentAccessToken), false);
    } finally {
      deleteRace.restore();
    }

    const consentRaceSessionId = `kb_session_consentrace${Date.now()}`;
    cleanupSessionIds.push(consentRaceSessionId);
    const consentRaceProfile = await store.createProfile({
      ageBand: '7-9',
      historyEnabled: true,
      sessionId: consentRaceSessionId,
    });
    cleanupProfileIds.push(consentRaceProfile.profileId);
    const consentRace = interceptAgeBandUpdate(consentRaceProfile.profileId);
    try {
      const ageBandUpdate = store.updateProfile({
        profileId: consentRaceProfile.profileId,
        parentAccessToken: consentRaceProfile.parentAccessToken,
        ageBand: '10-12',
      });
      await consentRace.reached;
      const disabled = await store.updateProfile({
        profileId: consentRaceProfile.profileId,
        parentAccessToken: consentRaceProfile.parentAccessToken,
        historyEnabled: false,
      });
      assert.equal(disabled.historyEnabled, false);
      consentRace.release();
      const updated = await ageBandUpdate;
      assert.equal(updated.ageBand, '10-12');
      assert.equal(updated.historyEnabled, false);
      assert.equal(
        await store.recordEvent(
          eventForProfile(consentRaceProfile, consentRaceSessionId, 'kb_event_after_disable_race'),
          consentRaceProfile.parentAccessToken,
        ),
        false,
      );
    } finally {
      consentRace.restore();
    }

    await assert.rejects(
      store.deleteProfile({
        profileId: profile.profileId,
        parentAccessToken: otherProfile.parentAccessToken,
      }),
      /invalid parent access token/i,
    );
    assert.deepEqual(
      await store.deleteProfile({
        profileId: profile.profileId,
        parentAccessToken: profile.parentAccessToken,
      }),
      { deleted: true, profileId: profile.profileId },
    );
    assert.equal(await store.validateAccess(profile.profileId, profile.parentAccessToken), false);
    const deletionClient = new Redis(redisUrl);
    try {
      assert.equal(await deletionClient.exists(`kidbot:profile:${profile.profileId}`), 0);
      assert.equal(await deletionClient.exists(`kidbot:profile:${profile.profileId}:sessions`), 0);
      assert.equal(await deletionClient.exists(`kidbot:session:${profileSessionId}`), 0);
      assert.equal(await deletionClient.exists(`kidbot:session:${profileSessionId}:events`), 0);
    } finally {
      deletionClient.disconnect();
    }
  } finally {
    await store.close?.();
    const cleanupClient = new Redis(redisUrl);
    try {
      const keys = [
        ...cleanupProfileIds.flatMap((profileId) => [
          `kidbot:profile:${profileId}`,
          `kidbot:profile:${profileId}:sessions`,
        ]),
        ...cleanupSessionIds.flatMap((sessionId) => [
          `kidbot:session:${sessionId}`,
          `kidbot:session:${sessionId}:events`,
        ]),
      ];
      if (keys.length > 0) await cleanupClient.del(...keys);
    } finally {
      cleanupClient.disconnect();
    }
  }
});
