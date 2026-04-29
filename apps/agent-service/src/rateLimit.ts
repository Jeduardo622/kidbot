import type { RequestHandler } from 'express';
import { Redis } from 'ioredis';
import { correlationId } from './guardrails.js';

export interface Clock {
  now(): number;
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  clock?: Clock;
  store?: RateLimitStore;
  keyPrefix?: string;
}

export interface RateLimitIncrement {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  mode: 'memory' | 'redis';
  increment(key: string, windowMs: number): Promise<RateLimitIncrement>;
  reset?(key: string): Promise<void>;
  ttl?(key: string): Promise<number>;
  readiness(): Promise<RateLimitStoreReadiness>;
  close?(): Promise<void>;
}

export interface RateLimitStoreReadiness {
  mode: 'memory' | 'redis';
  ready: boolean;
  details?: string;
}

interface Bucket {
  resetAt: number;
  count: number;
}

export const createMemoryRateLimitStore = (
  clock: Clock = { now: () => Date.now() },
): RateLimitStore => {
  const buckets = new Map<string, Bucket>();

  return {
    mode: 'memory',
    async increment(key, windowMs) {
      const now = clock.now();
      const existing = buckets.get(key);
      const bucket =
        existing && existing.resetAt > now ? existing : { resetAt: now + windowMs, count: 0 };
      bucket.count += 1;
      buckets.set(key, bucket);
      return { count: bucket.count, resetAt: bucket.resetAt };
    },
    async reset(key) {
      buckets.delete(key);
    },
    async ttl(key) {
      const bucket = buckets.get(key);
      if (!bucket) {
        return -2;
      }
      return Math.max(0, bucket.resetAt - clock.now());
    },
    async readiness() {
      return { mode: 'memory', ready: true };
    },
    async close() {
      // Nothing to close for the in-process fallback.
    },
  };
};

export const createRedisRateLimitStore = (redisUrl: string): RateLimitStore => {
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  client.on('error', () => {
    // Request-time Redis failures are surfaced through increment/reset/ttl promises.
  });

  return {
    mode: 'redis',
    async increment(key, windowMs) {
      const count = await client.incr(key);
      if (count === 1) {
        await client.pexpire(key, windowMs);
      }
      const ttl = await client.pttl(key);
      return {
        count,
        resetAt: Date.now() + Math.max(ttl, 0),
      };
    },
    async reset(key) {
      await client.del(key);
    },
    async ttl(key) {
      return client.pttl(key);
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

type RateLimitStoreEnv = Partial<Record<'RATE_LIMIT_STORE' | 'REDIS_URL', string>>;

export const createRateLimitStoreFromEnv = (
  env: RateLimitStoreEnv = process.env,
): RateLimitStore => {
  const mode = env.RATE_LIMIT_STORE?.trim().toLowerCase() || 'memory';
  if (mode === 'memory') {
    return createMemoryRateLimitStore();
  }
  if (mode === 'redis') {
    if (!env.REDIS_URL?.trim()) {
      throw new Error('REDIS_URL is required when RATE_LIMIT_STORE=redis.');
    }
    return createRedisRateLimitStore(env.REDIS_URL);
  }

  throw new Error('RATE_LIMIT_STORE must be memory or redis.');
};

export const createRateLimiter = ({
  limit,
  windowMs,
  clock = { now: () => Date.now() },
  store = createMemoryRateLimitStore(clock),
  keyPrefix = 'global',
}: RateLimitOptions): RequestHandler => {
  return async (req, res, next) => {
    let bucket: RateLimitIncrement;
    const now = clock.now();
    try {
      const clientKey = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      bucket = await store.increment(`${keyPrefix}:${clientKey}`, windowMs);
    } catch (error) {
      next(error);
      return;
    }

    if (bucket.count > limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      const id = correlationId();
      res.setHeader('Retry-After', String(retryAfterSeconds));
      const body = {
        error: 'Too Many Requests',
        retryAfter: retryAfterSeconds,
        correlationId: id,
      };
      res.locals.correlationId = id;
      res.locals.outputLength = JSON.stringify(body).length;
      res.status(429).json(body);
      return;
    }

    next();
  };
};
