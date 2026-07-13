import { createHmac, randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import type { McpServerConfig } from './config.js';

export interface RequestControlLimits {
  callerRequestsPerMinute: number;
  networkRequestsPerMinute: number;
  globalRequestsPerMinute: number;
  callerCostPerMinute: number;
  networkCostPerMinute: number;
  globalCostPerMinute: number;
  callerConcurrency: number;
  networkConcurrency: number;
  globalConcurrency: number;
  leaseMs: number;
}

export type RequestControlRejectionReason =
  | 'caller_requests'
  | 'network_requests'
  | 'global_requests'
  | 'caller_cost'
  | 'network_cost'
  | 'global_cost'
  | 'caller_concurrency'
  | 'network_concurrency'
  | 'global_concurrency';

export type RequestControlLease =
  | { allowed: true; release: () => Promise<void> }
  | { allowed: false; reason: RequestControlRejectionReason; retryAfterMs: number };

export interface RequestControlStore {
  mode: 'memory' | 'redis';
  acquire(input: {
    callerKey: string;
    networkKey: string;
    cost: number;
    limits: RequestControlLimits;
  }): Promise<RequestControlLease>;
  readiness(): Promise<{ mode: 'memory' | 'redis'; ready: boolean; details?: string }>;
  close?(): Promise<void>;
}

interface Clock {
  now(): number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const minuteMs = 60_000;

export const computeToolCost = (toolName: string, input: unknown): number => {
  if (toolName === 'story_panels') {
    const panels = typeof input === 'object' && input !== null && 'panels' in input
      ? Number((input as { panels?: unknown }).panels)
      : 4;
    return 3 + (Number.isInteger(panels) ? Math.min(8, Math.max(2, panels)) : 4);
  }
  if (toolName === 'voice_chat' || toolName === 'science_sim') {
    return 3;
  }
  if (toolName === 'coloring_outline') {
    return 2;
  }
  return 1;
};

const headerValue = (headers: Record<string, string | string[] | undefined>, name: string): string => {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
};

export const createCallerKey = ({
  secret,
  subject,
  headers,
  remoteAddress,
}: {
  secret: string;
  subject?: string;
  headers: Record<string, string | string[] | undefined>;
  remoteAddress: string | undefined;
}): string => {
  if (subject) {
    return `subject:${createHmac('sha256', secret).update(subject).digest('hex')}`;
  }
  const source = `${remoteAddress || 'unknown'}\n${headerValue(headers, 'user-agent')}`;
  return `network:${createHmac('sha256', secret).update(source).digest('hex')}`;
};

export const createNetworkKey = ({
  secret,
  networkIdentity,
}: {
  secret: string;
  networkIdentity: string;
}): string => `network:${createHmac('sha256', secret).update(networkIdentity).digest('hex')}`;

export const createMemoryRequestControlStore = (
  clock: Clock = { now: () => Date.now() },
): RequestControlStore => {
  const buckets = new Map<string, Bucket>();
  const concurrency = new Map<string, Map<string, number>>();

  const readBucket = (key: string, now: number): Bucket => {
    const current = buckets.get(key);
    return current && current.resetAt > now ? current : { count: 0, resetAt: now + minuteMs };
  };
  const readConcurrency = (key: string, now: number): Map<string, number> => {
    const current = concurrency.get(key) ?? new Map<string, number>();
    for (const [leaseId, expiresAt] of current) {
      if (expiresAt <= now) current.delete(leaseId);
    }
    return current;
  };

  return {
    mode: 'memory',
    async acquire({ callerKey, networkKey, cost, limits }) {
      const now = clock.now();
      const callerConcurrencyKey = `concurrency:caller:${callerKey}`;
      const networkConcurrencyKey = `concurrency:network:${networkKey}`;
      const globalConcurrencyKey = 'concurrency:global';
      const callerActive = readConcurrency(callerConcurrencyKey, now);
      const networkActive = readConcurrency(networkConcurrencyKey, now);
      const globalActive = readConcurrency(globalConcurrencyKey, now);
      const retryFor = (active: Map<string, number>) =>
        Math.max(1, Math.min(...active.values()) - now);
      if (callerActive.size >= limits.callerConcurrency) {
        return {
          allowed: false,
          reason: 'caller_concurrency',
          retryAfterMs: retryFor(callerActive),
        };
      }
      if (networkActive.size >= limits.networkConcurrency) {
        return {
          allowed: false,
          reason: 'network_concurrency',
          retryAfterMs: retryFor(networkActive),
        };
      }
      if (globalActive.size >= limits.globalConcurrency) {
        return {
          allowed: false,
          reason: 'global_concurrency',
          retryAfterMs: retryFor(globalActive),
        };
      }

      const checks: Array<[string, number, number, RequestControlRejectionReason]> = [
        [`requests:caller:${callerKey}`, 1, limits.callerRequestsPerMinute, 'caller_requests'],
        [`requests:network:${networkKey}`, 1, limits.networkRequestsPerMinute, 'network_requests'],
        ['requests:global', 1, limits.globalRequestsPerMinute, 'global_requests'],
        [`cost:caller:${callerKey}`, cost, limits.callerCostPerMinute, 'caller_cost'],
        [`cost:network:${networkKey}`, cost, limits.networkCostPerMinute, 'network_cost'],
        ['cost:global', cost, limits.globalCostPerMinute, 'global_cost'],
      ];
      const resolved = checks.map(([key, amount, limit, reason]) => ({
        key,
        amount,
        limit,
        reason,
        bucket: readBucket(key, now),
      }));
      const rejected = resolved.find(({ amount, limit, bucket }) => bucket.count + amount > limit);
      if (rejected) {
        return {
          allowed: false,
          reason: rejected.reason,
          retryAfterMs: Math.max(1, rejected.bucket.resetAt - now),
        };
      }
      for (const item of resolved) {
        item.bucket.count += item.amount;
        buckets.set(item.key, item.bucket);
      }

      const expiresAt = now + limits.leaseMs;
      const leaseId = randomUUID();
      for (const [key, active] of [
        [callerConcurrencyKey, callerActive],
        [networkConcurrencyKey, networkActive],
        [globalConcurrencyKey, globalActive],
      ] as const) {
        active.set(leaseId, expiresAt);
        concurrency.set(key, active);
      }
      let released = false;
      return {
        allowed: true,
        async release() {
          if (released) return;
          released = true;
          for (const key of [callerConcurrencyKey, networkConcurrencyKey, globalConcurrencyKey]) {
            const active = readConcurrency(key, clock.now());
            active.delete(leaseId);
            if (active.size === 0) {
              concurrency.delete(key);
            } else {
              concurrency.set(key, active);
            }
          }
        },
      };
    },
    async readiness() {
      return { mode: 'memory', ready: true };
    },
  };
};

export const createRedisRequestControlStore = (
  redisUrl: string,
  { keyPrefix = 'kidbot:mcp-control' }: { keyPrefix?: string } = {},
): RequestControlStore => {
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
    commandTimeout: 5_000,
  });
  client.on('error', () => {
    // Request-time Redis failures are surfaced through acquire/readiness.
  });
  const key = (suffix: string) => `${keyPrefix}:${suffix}`;

  return {
    mode: 'redis',
    async acquire({ callerKey, networkKey, cost, limits }) {
      const leaseId = randomUUID();
      const now = Date.now();
      const result = await client.eval(
        `local now = tonumber(ARGV[13])
         local function concurrencyRetry(key)
           local first = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
           if #first >= 2 then return math.max(1, tonumber(first[2]) - now) end
           return 1
         end
         for index = 7, 9 do redis.call('ZREMRANGEBYSCORE', KEYS[index], '-inf', now) end
         if redis.call('ZCARD', KEYS[7]) >= tonumber(ARGV[8]) then
           return {2, concurrencyRetry(KEYS[7])}
         end
         if redis.call('ZCARD', KEYS[8]) >= tonumber(ARGV[9]) then
           return {3, concurrencyRetry(KEYS[8])}
         end
         if redis.call('ZCARD', KEYS[9]) >= tonumber(ARGV[10]) then
           return {4, concurrencyRetry(KEYS[9])}
         end
         local callerRequests = tonumber(redis.call('GET', KEYS[1]) or '0')
         local networkRequests = tonumber(redis.call('GET', KEYS[2]) or '0')
         local globalRequests = tonumber(redis.call('GET', KEYS[3]) or '0')
         local callerCost = tonumber(redis.call('GET', KEYS[4]) or '0')
         local networkCost = tonumber(redis.call('GET', KEYS[5]) or '0')
         local globalCost = tonumber(redis.call('GET', KEYS[6]) or '0')
         if callerRequests + 1 > tonumber(ARGV[2]) then
           return {5, math.max(1, redis.call('PTTL', KEYS[1]))}
         end
         if networkRequests + 1 > tonumber(ARGV[3]) then
           return {6, math.max(1, redis.call('PTTL', KEYS[2]))}
         end
         if globalRequests + 1 > tonumber(ARGV[4]) then
           return {7, math.max(1, redis.call('PTTL', KEYS[3]))}
         end
         if callerCost + tonumber(ARGV[1]) > tonumber(ARGV[5]) then
           return {8, math.max(1, redis.call('PTTL', KEYS[4]))}
         end
         if networkCost + tonumber(ARGV[1]) > tonumber(ARGV[6]) then
           return {9, math.max(1, redis.call('PTTL', KEYS[5]))}
         end
         if globalCost + tonumber(ARGV[1]) > tonumber(ARGV[7]) then
           return {10, math.max(1, redis.call('PTTL', KEYS[6]))}
         end
         local requestKeys = {KEYS[1], KEYS[2], KEYS[3]}
         for _, requestKey in ipairs(requestKeys) do
           local updated = redis.call('INCR', requestKey)
           if updated == 1 then redis.call('PEXPIRE', requestKey, ARGV[11]) end
         end
         local costKeys = {KEYS[4], KEYS[5], KEYS[6]}
         for _, costKey in ipairs(costKeys) do
           local updated = redis.call('INCRBY', costKey, ARGV[1])
           if updated == tonumber(ARGV[1]) then redis.call('PEXPIRE', costKey, ARGV[11]) end
         end
         local expiresAt = now + tonumber(ARGV[12])
         for index = 7, 9 do
           redis.call('ZADD', KEYS[index], expiresAt, ARGV[14])
           redis.call('PEXPIRE', KEYS[index], tonumber(ARGV[12]) * 2)
         end
         return {1, 0}`,
        9,
        key(`requests:caller:${callerKey}`),
        key(`requests:network:${networkKey}`),
        key('requests:global'),
        key(`cost:caller:${callerKey}`),
        key(`cost:network:${networkKey}`),
        key('cost:global'),
        key(`concurrency:caller:${callerKey}`),
        key(`concurrency:network:${networkKey}`),
        key('concurrency:global'),
        cost,
        limits.callerRequestsPerMinute,
        limits.networkRequestsPerMinute,
        limits.globalRequestsPerMinute,
        limits.callerCostPerMinute,
        limits.networkCostPerMinute,
        limits.globalCostPerMinute,
        limits.callerConcurrency,
        limits.networkConcurrency,
        limits.globalConcurrency,
        minuteMs,
        limits.leaseMs,
        now,
        leaseId,
      ) as [number, number];
      const [code, retryAfterMs] = result;
      if (code !== 1) {
        const reasons: Record<number, RequestControlRejectionReason> = {
          2: 'caller_concurrency',
          3: 'network_concurrency',
          4: 'global_concurrency',
          5: 'caller_requests',
          6: 'network_requests',
          7: 'global_requests',
          8: 'caller_cost',
          9: 'network_cost',
          10: 'global_cost',
        };
        return {
          allowed: false,
          reason: reasons[code] ?? 'global_requests',
          retryAfterMs: Math.max(1, retryAfterMs),
        };
      }

      let released = false;
      return {
        allowed: true,
        async release() {
          if (released) return;
          released = true;
          await client.eval(
            `for _, concurrencyKey in ipairs(KEYS) do redis.call('ZREM', concurrencyKey, ARGV[1]) end
             return 1`,
            3,
            key(`concurrency:caller:${callerKey}`),
            key(`concurrency:network:${networkKey}`),
            key('concurrency:global'),
            leaseId,
          );
        },
      };
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

export const createRequestControlStoreFromConfig = (
  config: McpServerConfig,
  env: Partial<Record<'REDIS_URL', string>> = process.env,
): RequestControlStore => {
  if (config.requestControlStore === 'memory') {
    return createMemoryRequestControlStore();
  }
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_URL is required when MCP_REQUEST_CONTROL_STORE=redis.');
  }
  return createRedisRequestControlStore(redisUrl);
};
