import { describe, expect, it, vi } from 'vitest';

const redisCalls = vi.hoisted(() => ({ eval: [] as unknown[][] }));

vi.mock('ioredis', () => ({
  Redis: class {
    on() {}

    async eval(...args: unknown[]) {
      redisCalls.eval.push(args);
      return [1, 5_000];
    }

    async incr() {
      throw new Error('non-atomic increment path used');
    }

    async pexpire() {
      throw new Error('non-atomic expiry path used');
    }

    async pttl() {
      throw new Error('separate ttl read used');
    }

    disconnect() {}
  },
}));

import { createRedisRateLimitStore } from '../rateLimit.js';

describe('Redis rate limit atomicity', () => {
  it('increments and applies expiry in one Redis script', async () => {
    const store = createRedisRateLimitStore('redis://example.invalid');

    await expect(store.increment('voice:test', 5_000)).resolves.toMatchObject({
      count: 1,
    });
    expect(redisCalls.eval).toHaveLength(1);
    expect(redisCalls.eval[0]?.slice(1)).toEqual([1, 'voice:test', 5_000]);
  });
});
