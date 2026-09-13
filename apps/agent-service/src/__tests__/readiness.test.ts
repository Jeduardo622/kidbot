import { describe, expect, it, vi } from 'vitest';
import { readImageStorageReadiness } from '../readiness.js';
import type { ImageAssetStorageConfig } from '../imageAssetStore.js';

const storage: ImageAssetStorageConfig = {
  mode: 'supabase', directory: '.', publicBaseUrl: 'https://storage.example/images',
  maxBytes: 1000, ttlMs: 86400000, supabaseUrl: 'https://storage.example',
  supabaseServiceRoleKey: 'synthetic-private-key', supabaseBucket: 'images', supabasePrefix: 'story',
};

describe('image storage readiness', () => {
  it('checks bucket metadata without writing objects or exposing credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'images', public: true })));
    const result = await readImageStorageReadiness(storage, fetcher);
    expect(result).toEqual({ mode: 'supabase', ready: true });
    expect(fetcher).toHaveBeenCalledWith('https://storage.example/storage/v1/bucket/images',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }));
    expect(JSON.stringify(result)).not.toContain('synthetic-private-key');
  });
  it.each([false, undefined])('fails closed if the public-image bucket is not public: %s', async (publicValue) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'images', public: publicValue })));
    expect((await readImageStorageReadiness(storage, fetcher)).ready).toBe(false);
  });
  it('sanitizes network failures', async () => {
    const result = await readImageStorageReadiness(storage, vi.fn().mockRejectedValue(new Error('synthetic-private-key')));
    expect(result).toEqual({ mode: 'supabase', ready: false });
  });
  it('checks a local writable directory without generating an image', async () => {
    expect(await readImageStorageReadiness({ ...storage, mode: 'local', directory: process.cwd() }))
      .toEqual({ mode: 'local', ready: true });
  });
  it('allows explicit non-production inline storage', async () => {
    expect(await readImageStorageReadiness({ ...storage, mode: 'data-url' }))
      .toEqual({ mode: 'data-url', ready: true });
  });
});
