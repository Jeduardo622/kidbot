import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Redis } from 'ioredis';
import type { McpServerConfig } from './config.js';

export type AgeBand = '4-6' | '7-9' | '10-12';

export interface ParentProfile {
  profileId: string;
  ageBand: AgeBand;
  historyEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ParentSession {
  sessionId: string;
  profileId: string;
  ageBand: AgeBand;
  createdAt: string;
  updatedAt: string;
}

export interface ParentHistoryEvent {
  id: string;
  timestamp: string;
  tool: string;
  sessionId: string;
  profileId: string;
  ageBand: AgeBand;
  status: 'ok' | 'blocked' | 'degraded' | 'error';
  blocked?: boolean;
  degraded?: boolean;
  providerFallback?: boolean;
  fallbackReason?: string;
  correlationId?: string;
  inputLength: number;
  outputLength: number;
}

export interface ParentStoreReadiness {
  mode: 'disabled' | 'memory' | 'redis';
  ready: boolean;
  details?: string;
}

export interface ParentProfileCreateResult extends ParentProfile {
  parentAccessToken?: string;
}

export interface ParentProfileStore {
  mode: 'disabled' | 'memory' | 'redis';
  createProfile(input: { sessionId: string; ageBand: AgeBand }): Promise<ParentProfileCreateResult>;
  updateProfile(input: {
    profileId: string;
    parentAccessToken: string;
    ageBand?: AgeBand;
    historyEnabled?: boolean;
  }): Promise<ParentProfile>;
  validateAccess(profileId: string, parentAccessToken: string | undefined): Promise<boolean>;
  recordEvent(event: ParentHistoryEvent, parentAccessToken: string | undefined): Promise<boolean>;
  listHistory(input: {
    profileId: string;
    parentAccessToken: string;
    sessionId?: string;
    limit?: number;
  }): Promise<ParentHistoryEvent[]>;
  readiness(): Promise<ParentStoreReadiness>;
  close?(): Promise<void>;
}

interface StoredProfile extends ParentProfile {
  tokenHash: string;
}

interface StoreOptions {
  maxEvents: number;
  retentionDays: number;
  secret: string;
}

const disabledProfile: ParentProfile = {
  profileId: 'local-default',
  ageBand: '7-9',
  historyEnabled: false,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const createId = (prefix: 'kb_profile' | 'kb_event') => {
  const uuid = typeof randomUUID === 'function' ? randomUUID().replace(/-/g, '') : randomBytes(16).toString('hex');
  return `${prefix}_${uuid}`;
};

const createToken = () => `kb_parent_${randomBytes(32).toString('base64url')}`;

const hashToken = (secret: string, token: string) =>
  createHmac('sha256', secret).update(token).digest('base64url');

const tokenMatches = (expectedHash: string, secret: string, token: string) => {
  const actualHash = hashToken(secret, token);
  const expected = Buffer.from(expectedHash);
  const actual = Buffer.from(actualHash);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const profileKey = (profileId: string) => `kidbot:profile:${profileId}`;
const sessionKey = (sessionId: string) => `kidbot:session:${sessionId}`;
const profileSessionsKey = (profileId: string) => `kidbot:profile:${profileId}:sessions`;
const sessionEventsKey = (sessionId: string) => `kidbot:session:${sessionId}:events`;

export const createDisabledParentProfileStore = (): ParentProfileStore => ({
  mode: 'disabled',
  async createProfile(input) {
    return { ...disabledProfile, ageBand: input.ageBand };
  },
  async updateProfile(input) {
    return { ...disabledProfile, profileId: input.profileId, ageBand: input.ageBand ?? disabledProfile.ageBand };
  },
  async validateAccess() {
    return false;
  },
  async recordEvent() {
    return false;
  },
  async listHistory() {
    return [];
  },
  async readiness() {
    return { mode: 'disabled', ready: true };
  },
});

export const createMemoryParentProfileStore = (options: StoreOptions): ParentProfileStore => {
  const profiles = new Map<string, StoredProfile>();
  const sessions = new Map<string, ParentSession>();
  const events = new Map<string, ParentHistoryEvent[]>();

  const readAuthorizedProfile = (profileId: string, token: string) => {
    const profile = profiles.get(profileId);
    if (!profile || !tokenMatches(profile.tokenHash, options.secret, token)) {
      return undefined;
    }
    return profile;
  };

  return {
    mode: 'memory',
    async createProfile(input) {
      const now = new Date().toISOString();
      const profileId = createId('kb_profile');
      const parentAccessToken = createToken();
      const profile: StoredProfile = {
        profileId,
        ageBand: input.ageBand,
        historyEnabled: true,
        createdAt: now,
        updatedAt: now,
        tokenHash: hashToken(options.secret, parentAccessToken),
      };
      profiles.set(profileId, profile);
      sessions.set(input.sessionId, {
        sessionId: input.sessionId,
        profileId,
        ageBand: input.ageBand,
        createdAt: now,
        updatedAt: now,
      });
      return {
        profileId,
        ageBand: profile.ageBand,
        historyEnabled: profile.historyEnabled,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        parentAccessToken,
      };
    },
    async updateProfile(input) {
      const profile = readAuthorizedProfile(input.profileId, input.parentAccessToken);
      if (!profile) {
        throw new Error('Invalid parent access token.');
      }
      const updated: StoredProfile = {
        ...profile,
        ageBand: input.ageBand ?? profile.ageBand,
        historyEnabled: input.historyEnabled ?? profile.historyEnabled,
        updatedAt: new Date().toISOString(),
      };
      profiles.set(input.profileId, updated);
      return {
        profileId: updated.profileId,
        ageBand: updated.ageBand,
        historyEnabled: updated.historyEnabled,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    },
    async validateAccess(profileId, parentAccessToken) {
      return Boolean(parentAccessToken && readAuthorizedProfile(profileId, parentAccessToken));
    },
    async recordEvent(event, parentAccessToken) {
      const profile = parentAccessToken ? readAuthorizedProfile(event.profileId, parentAccessToken) : undefined;
      if (!profile?.historyEnabled) {
        return false;
      }
      const session = sessions.get(event.sessionId);
      const now = event.timestamp;
      sessions.set(event.sessionId, {
        sessionId: event.sessionId,
        profileId: event.profileId,
        ageBand: event.ageBand,
        createdAt: session?.createdAt ?? now,
        updatedAt: now,
      });
      const sessionEvents = [event, ...(events.get(event.sessionId) ?? [])].slice(0, options.maxEvents);
      events.set(event.sessionId, sessionEvents);
      return true;
    },
    async listHistory(input) {
      const profile = readAuthorizedProfile(input.profileId, input.parentAccessToken);
      if (!profile) {
        throw new Error('Invalid parent access token.');
      }
      const limit = input.limit ?? options.maxEvents;
      const sessionIds = input.sessionId
        ? [input.sessionId]
        : [...sessions.values()]
            .filter((session) => session.profileId === input.profileId)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((session) => session.sessionId);
      return sessionIds.flatMap((sessionId) => events.get(sessionId) ?? []).slice(0, limit);
    },
    async readiness() {
      return { mode: 'memory', ready: true };
    },
  };
};

export const createRedisParentProfileStore = (
  redisUrl: string,
  options: StoreOptions,
): ParentProfileStore => {
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  client.on('error', () => {
    // Request-time Redis failures are surfaced through store promises/readiness.
  });
  const retentionSeconds = options.retentionDays * 24 * 60 * 60;

  const readProfile = async (profileId: string): Promise<StoredProfile | undefined> => {
    const raw = await client.get(profileKey(profileId));
    return raw ? (JSON.parse(raw) as StoredProfile) : undefined;
  };

  const readAuthorizedProfile = async (profileId: string, token: string) => {
    const profile = await readProfile(profileId);
    if (!profile || !tokenMatches(profile.tokenHash, options.secret, token)) {
      return undefined;
    }
    return profile;
  };

  return {
    mode: 'redis',
    async createProfile(input) {
      const now = new Date().toISOString();
      const profileId = createId('kb_profile');
      const parentAccessToken = createToken();
      const profile: StoredProfile = {
        profileId,
        ageBand: input.ageBand,
        historyEnabled: true,
        createdAt: now,
        updatedAt: now,
        tokenHash: hashToken(options.secret, parentAccessToken),
      };
      const session: ParentSession = {
        sessionId: input.sessionId,
        profileId,
        ageBand: input.ageBand,
        createdAt: now,
        updatedAt: now,
      };
      await client
        .multi()
        .set(profileKey(profileId), JSON.stringify(profile))
        .set(sessionKey(input.sessionId), JSON.stringify(session), 'EX', retentionSeconds)
        .zadd(profileSessionsKey(profileId), Date.now(), input.sessionId)
        .expire(profileSessionsKey(profileId), retentionSeconds)
        .exec();
      return {
        profileId,
        ageBand: profile.ageBand,
        historyEnabled: profile.historyEnabled,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        parentAccessToken,
      };
    },
    async updateProfile(input) {
      const profile = await readAuthorizedProfile(input.profileId, input.parentAccessToken);
      if (!profile) {
        throw new Error('Invalid parent access token.');
      }
      const updated: StoredProfile = {
        ...profile,
        ageBand: input.ageBand ?? profile.ageBand,
        historyEnabled: input.historyEnabled ?? profile.historyEnabled,
        updatedAt: new Date().toISOString(),
      };
      await client.set(profileKey(input.profileId), JSON.stringify(updated));
      return {
        profileId: updated.profileId,
        ageBand: updated.ageBand,
        historyEnabled: updated.historyEnabled,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    },
    async validateAccess(profileId, parentAccessToken) {
      return Boolean(parentAccessToken && (await readAuthorizedProfile(profileId, parentAccessToken)));
    },
    async recordEvent(event, parentAccessToken) {
      const profile = parentAccessToken
        ? await readAuthorizedProfile(event.profileId, parentAccessToken)
        : undefined;
      if (!profile?.historyEnabled) {
        return false;
      }
      const existingSessionRaw = await client.get(sessionKey(event.sessionId));
      const existingSession = existingSessionRaw ? (JSON.parse(existingSessionRaw) as ParentSession) : undefined;
      const session: ParentSession = {
        sessionId: event.sessionId,
        profileId: event.profileId,
        ageBand: event.ageBand,
        createdAt: existingSession?.createdAt ?? event.timestamp,
        updatedAt: event.timestamp,
      };
      await client
        .multi()
        .set(sessionKey(event.sessionId), JSON.stringify(session), 'EX', retentionSeconds)
        .zadd(profileSessionsKey(event.profileId), Date.now(), event.sessionId)
        .expire(profileSessionsKey(event.profileId), retentionSeconds)
        .lpush(sessionEventsKey(event.sessionId), JSON.stringify(event))
        .ltrim(sessionEventsKey(event.sessionId), 0, options.maxEvents - 1)
        .expire(sessionEventsKey(event.sessionId), retentionSeconds)
        .exec();
      return true;
    },
    async listHistory(input) {
      const profile = await readAuthorizedProfile(input.profileId, input.parentAccessToken);
      if (!profile) {
        throw new Error('Invalid parent access token.');
      }
      const limit = input.limit ?? options.maxEvents;
      const sessionIds = input.sessionId
        ? [input.sessionId]
        : await client.zrevrange(profileSessionsKey(input.profileId), 0, options.maxEvents - 1);
      const allEvents: ParentHistoryEvent[] = [];
      for (const sessionId of sessionIds) {
        const rawEvents = await client.lrange(sessionEventsKey(sessionId), 0, limit - 1);
        allEvents.push(...rawEvents.map((raw: string) => JSON.parse(raw) as ParentHistoryEvent));
        if (allEvents.length >= limit) {
          break;
        }
      }
      return allEvents.slice(0, limit);
    },
    async readiness() {
      try {
        const response = await client.ping();
        return { mode: 'redis', ready: response === 'PONG', details: response };
      } catch (error) {
        const details = error instanceof Error ? error.message : 'Unknown Redis readiness error';
        return { mode: 'redis', ready: false, details: details.slice(0, 160) };
      }
    },
    async close() {
      client.disconnect();
    },
  };
};

export const createParentProfileStoreFromConfig = (
  config: McpServerConfig,
  env: Partial<Record<'REDIS_URL', string>> = process.env,
): ParentProfileStore => {
  if (config.parentProfileStore === 'disabled') {
    return createDisabledParentProfileStore();
  }
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_URL is required when PARENT_PROFILE_STORE=redis.');
  }
  return createRedisParentProfileStore(redisUrl, {
    maxEvents: config.parentHistoryMaxEvents,
    retentionDays: config.parentHistoryRetentionDays,
    secret: config.parentAuthSecret ?? '',
  });
};
