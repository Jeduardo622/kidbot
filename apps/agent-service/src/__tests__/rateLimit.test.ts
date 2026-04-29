import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryRateLimitStore,
  createRateLimiter,
  createRateLimitStoreFromEnv,
  type RateLimitStore,
} from '../rateLimit.js';

const makeReq = (ip = '127.0.0.1') => ({ ip, socket: { remoteAddress: ip } }) as Request;

const makeRes = () => {
  const headers = new Map<string, string>();
  const res: Response & { getHeader: (name: string) => string | undefined } = {
    locals: {} as Record<string, unknown>,
    statusCode: 200,
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name, value);
      return res;
    }),
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => body) as never,
    getHeader: (name: string) => headers.get(name),
  } as unknown as Response & { getHeader: (name: string) => string | undefined };
  return res;
};

const makeNext = (): NextFunction => vi.fn() as unknown as NextFunction;

describe('rate limit stores', () => {
  it('increments within a window and resets after ttl expiry', async () => {
    let now = 1_000;
    const store = createMemoryRateLimitStore({ now: () => now });

    await expect(store.increment('voice:127.0.0.1', 1_000)).resolves.toMatchObject({
      count: 1,
      resetAt: 2_000,
    });
    await expect(store.increment('voice:127.0.0.1', 1_000)).resolves.toMatchObject({
      count: 2,
      resetAt: 2_000,
    });

    now = 2_001;
    await expect(store.increment('voice:127.0.0.1', 1_000)).resolves.toMatchObject({
      count: 1,
      resetAt: 3_001,
    });
  });

  it('uses the injected store so counts can be shared across limiter instances', async () => {
    let count = 0;
    const sharedStore: RateLimitStore = {
      async increment() {
        count += 1;
        return { count, resetAt: Date.now() + 60_000 };
      },
    };
    const first = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      store: sharedStore,
      keyPrefix: 'voice',
    });
    const second = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      store: sharedStore,
      keyPrefix: 'voice',
    });

    const firstRes = makeRes();
    await first(makeReq(), firstRes, makeNext());
    expect(firstRes.status).not.toHaveBeenCalled();

    const secondRes = makeRes();
    await second(makeReq(), secondRes, makeNext());
    expect(secondRes.status).toHaveBeenCalledWith(429);
    expect(secondRes.getHeader('Retry-After')).toBeTruthy();
  });

  it('fails fast when redis store is selected without REDIS_URL', () => {
    expect(() =>
      createRateLimitStoreFromEnv({ RATE_LIMIT_STORE: 'redis', REDIS_URL: undefined }),
    ).toThrow(/REDIS_URL is required/i);
  });

  it('rejects unknown rate limit store modes', () => {
    expect(() =>
      createRateLimitStoreFromEnv({ RATE_LIMIT_STORE: 'sqlite', REDIS_URL: undefined }),
    ).toThrow(/RATE_LIMIT_STORE/i);
  });
});
