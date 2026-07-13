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
  createProfile(input: { sessionId: string; ageBand: AgeBand; historyEnabled: true }): Promise<ParentProfileCreateResult>;
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
  deleteProfile(input: {
    profileId: string;
    parentAccessToken: string;
  }): Promise<{ deleted: true; profileId: string }>;
  readiness(): Promise<ParentStoreReadiness>;
  close?(): Promise<void>;
}

interface StoredProfile extends ParentProfile {
  expiresAt: string;
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

const requireHistoryConsent = (historyEnabled: unknown) => {
  if (historyEnabled !== true) {
    throw new Error('Explicit history consent is required.');
  }
};

export const createDisabledParentProfileStore = (): ParentProfileStore => ({
  mode: 'disabled',
  async createProfile(input) {
    requireHistoryConsent(input.historyEnabled);
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
  async deleteProfile() {
    throw new Error('Parent profile deletion requires persistent storage.');
  },
  async readiness() {
    return { mode: 'disabled', ready: true };
  },
});

export const createMemoryParentProfileStore = (options: StoreOptions): ParentProfileStore => {
  const profiles = new Map<string, StoredProfile>();
  const sessions = new Map<string, ParentSession>();
  const events = new Map<string, ParentHistoryEvent[]>();
  const retentionMs = options.retentionDays * 24 * 60 * 60 * 1_000;

  const purgeOwnedHistory = (profileId: string) => {
    for (const [sessionId, session] of sessions) {
      if (session.profileId === profileId) {
        sessions.delete(sessionId);
        events.delete(sessionId);
      }
    }
  };

  const deleteStoredProfile = (profileId: string) => {
    profiles.delete(profileId);
    purgeOwnedHistory(profileId);
  };

  const readAuthorizedProfile = (profileId: string, token: string) => {
    const profile = profiles.get(profileId);
    if (profile && Date.parse(profile.expiresAt) <= Date.now()) {
      deleteStoredProfile(profileId);
      return undefined;
    }
    if (!profile || !tokenMatches(profile.tokenHash, options.secret, token)) {
      return undefined;
    }
    profile.expiresAt = new Date(Date.now() + retentionMs).toISOString();
    return profile;
  };

  return {
    mode: 'memory',
    async createProfile(input) {
      requireHistoryConsent(input.historyEnabled);
      if (sessions.has(input.sessionId)) {
        throw new Error('Parent profile could not be created.');
      }
      const now = new Date().toISOString();
      const profileId = createId('kb_profile');
      const parentAccessToken = createToken();
      const profile: StoredProfile = {
        profileId,
        ageBand: input.ageBand,
        historyEnabled: true,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + retentionMs).toISOString(),
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
      if (!updated.historyEnabled) {
        purgeOwnedHistory(input.profileId);
      }
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
      if (session && session.profileId !== event.profileId) {
        return false;
      }
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
      const requestedSession = input.sessionId ? sessions.get(input.sessionId) : undefined;
      const sessionIds = input.sessionId
        ? requestedSession?.profileId === input.profileId
          ? [input.sessionId]
          : []
        : [...sessions.values()]
            .filter((session) => session.profileId === input.profileId)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((session) => session.sessionId);
      return sessionIds.flatMap((sessionId) => events.get(sessionId) ?? []).slice(0, limit);
    },
    async deleteProfile(input) {
      const profile = readAuthorizedProfile(input.profileId, input.parentAccessToken);
      if (!profile) {
        throw new Error('Invalid parent access token.');
      }
      deleteStoredProfile(input.profileId);
      return { deleted: true, profileId: input.profileId };
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
    commandTimeout: 5_000,
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
    const expiresAt = new Date(Date.now() + retentionSeconds * 1_000).toISOString();
    const renewed = await client.eval(
      `local profileRaw = redis.call('GET', KEYS[1])
       if not profileRaw then return 0 end
       local okProfile, storedProfile = pcall(cjson.decode, profileRaw)
       if not okProfile or storedProfile.profileId ~= ARGV[1] then return 0 end
       storedProfile.expiresAt = ARGV[3]
       redis.call('SET', KEYS[1], cjson.encode(storedProfile), 'EX', ARGV[2])
       local sessionIds = redis.call('ZRANGE', KEYS[2], 0, -1)
       if #sessionIds > 0 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
       for _, sessionId in ipairs(sessionIds) do
         redis.call('EXPIRE', 'kidbot:session:' .. sessionId, ARGV[2])
         redis.call('EXPIRE', 'kidbot:session:' .. sessionId .. ':events', ARGV[2])
       end
       return 1`,
      2,
      profileKey(profileId),
      profileSessionsKey(profileId),
      profileId,
      retentionSeconds,
      expiresAt,
    );
    if (renewed !== 1) return undefined;
    profile.expiresAt = expiresAt;
    return profile;
  };

  return {
    mode: 'redis',
    async createProfile(input) {
      requireHistoryConsent(input.historyEnabled);
      const now = new Date().toISOString();
      const profileId = createId('kb_profile');
      const parentAccessToken = createToken();
      const profile: StoredProfile = {
        profileId,
        ageBand: input.ageBand,
        historyEnabled: true,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + retentionSeconds * 1_000).toISOString(),
        tokenHash: hashToken(options.secret, parentAccessToken),
      };
      const session: ParentSession = {
        sessionId: input.sessionId,
        profileId,
        ageBand: input.ageBand,
        createdAt: now,
        updatedAt: now,
      };
      const created = await client.eval(
        `if redis.call('EXISTS', KEYS[2]) == 1 then
           return 0
         end
         redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[5])
         redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[5])
         redis.call('ZADD', KEYS[3], ARGV[3], ARGV[4])
         redis.call('EXPIRE', KEYS[3], ARGV[5])
         return 1`,
        3,
        profileKey(profileId),
        sessionKey(input.sessionId),
        profileSessionsKey(profileId),
        JSON.stringify(profile),
        JSON.stringify(session),
        Date.now(),
        input.sessionId,
        retentionSeconds,
      );
      if (created !== 1) {
        throw new Error('Parent profile could not be created.');
      }
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
      const updatePatch = {
        ...(input.ageBand === undefined ? {} : { ageBand: input.ageBand }),
        ...(input.historyEnabled === undefined ? {} : { historyEnabled: input.historyEnabled }),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + retentionSeconds * 1_000).toISOString(),
      };
      const saved = await client.eval(
        `local profileRaw = redis.call('GET', KEYS[1])
         if not profileRaw then return 0 end
         local okProfile, storedProfile = pcall(cjson.decode, profileRaw)
         if not okProfile or storedProfile.profileId ~= ARGV[1] then return 0 end
         local okPatch, patch = pcall(cjson.decode, ARGV[2])
         if not okPatch then return 0 end
         if patch.ageBand ~= nil then storedProfile.ageBand = patch.ageBand end
         if patch.historyEnabled ~= nil then storedProfile.historyEnabled = patch.historyEnabled end
         storedProfile.updatedAt = patch.updatedAt
         storedProfile.expiresAt = patch.expiresAt
         if patch.historyEnabled == false then
           local sessionIds = redis.call('ZRANGE', KEYS[2], 0, -1)
           for _, sessionId in ipairs(sessionIds) do
             redis.call('DEL', 'kidbot:session:' .. sessionId, 'kidbot:session:' .. sessionId .. ':events')
           end
           redis.call('DEL', KEYS[2])
         end
         local updatedRaw = cjson.encode(storedProfile)
         redis.call('SET', KEYS[1], updatedRaw, 'EX', ARGV[3])
         return updatedRaw`,
        2,
        profileKey(input.profileId),
        profileSessionsKey(input.profileId),
        input.profileId,
        JSON.stringify(updatePatch),
        retentionSeconds,
      );
      if (typeof saved !== 'string') throw new Error('Invalid parent access token.');
      const updated = JSON.parse(saved) as StoredProfile;
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
      const session: ParentSession = {
        sessionId: event.sessionId,
        profileId: event.profileId,
        ageBand: event.ageBand,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      };
      const recorded = await client.eval(
        `local profileRaw = redis.call('GET', KEYS[1])
         if not profileRaw then return 0 end
         local okProfile, storedProfile = pcall(cjson.decode, profileRaw)
         if not okProfile or storedProfile.profileId ~= ARGV[1] or storedProfile.historyEnabled ~= true then
           return 0
         end
         local sessionRaw = redis.call('GET', KEYS[2])
         local session = cjson.decode(ARGV[2])
         if sessionRaw then
           local okSession, storedSession = pcall(cjson.decode, sessionRaw)
           if not okSession or storedSession.profileId ~= ARGV[1] then return 0 end
           session.createdAt = storedSession.createdAt
         end
         redis.call('SET', KEYS[2], cjson.encode(session), 'EX', ARGV[6])
         redis.call('ZADD', KEYS[3], ARGV[3], ARGV[4])
         redis.call('EXPIRE', KEYS[3], ARGV[6])
         redis.call('LPUSH', KEYS[4], ARGV[5])
         redis.call('LTRIM', KEYS[4], 0, tonumber(ARGV[7]) - 1)
         redis.call('EXPIRE', KEYS[4], ARGV[6])
         return 1`,
        4,
        profileKey(event.profileId),
        sessionKey(event.sessionId),
        profileSessionsKey(event.profileId),
        sessionEventsKey(event.sessionId),
        event.profileId,
        JSON.stringify(session),
        Date.now(),
        event.sessionId,
        JSON.stringify(event),
        retentionSeconds,
        options.maxEvents,
      );
      return recorded === 1;
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
        const rawEvents = await client.eval(
          `local sessionRaw = redis.call('GET', KEYS[1])
           if not sessionRaw then return {} end
           local okSession, session = pcall(cjson.decode, sessionRaw)
           if not okSession or session.profileId ~= ARGV[1] then return {} end
           local clean = {}
           local rawEvents = redis.call('LRANGE', KEYS[2], 0, -1)
           for _, rawEvent in ipairs(rawEvents) do
             local okEvent, event = pcall(cjson.decode, rawEvent)
             if okEvent and event.profileId == ARGV[1] and event.sessionId == ARGV[3] then
               table.insert(clean, rawEvent)
               if #clean >= tonumber(ARGV[2]) then break end
             end
           end
           return clean`,
          2,
          sessionKey(sessionId),
          sessionEventsKey(sessionId),
          input.profileId,
          limit,
          sessionId,
        ) as string[];
        allEvents.push(...rawEvents.map((raw: string) => JSON.parse(raw) as ParentHistoryEvent));
        if (allEvents.length >= limit) {
          break;
        }
      }
      return allEvents.slice(0, limit);
    },
    async deleteProfile(input) {
      const profile = await readAuthorizedProfile(input.profileId, input.parentAccessToken);
      if (!profile) {
        throw new Error('Invalid parent access token.');
      }
      const deleted = await client.eval(
        `local profileRaw = redis.call('GET', KEYS[1])
         if not profileRaw then return 0 end
         local okProfile, storedProfile = pcall(cjson.decode, profileRaw)
         if not okProfile or storedProfile.profileId ~= ARGV[1] then return 0 end
         local sessionIds = redis.call('ZRANGE', KEYS[2], 0, -1)
         for _, sessionId in ipairs(sessionIds) do
           redis.call('DEL', 'kidbot:session:' .. sessionId, 'kidbot:session:' .. sessionId .. ':events')
         end
         redis.call('DEL', KEYS[2], KEYS[1])
         return 1`,
        2,
        profileKey(input.profileId),
        profileSessionsKey(input.profileId),
        input.profileId,
      );
      if (deleted !== 1) throw new Error('Invalid parent access token.');
      return { deleted: true, profileId: input.profileId };
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
