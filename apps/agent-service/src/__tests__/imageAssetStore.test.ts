import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ImageAssetTooLargeError,
  cleanupExpiredImageAssets,
  createImageAssetStore,
  parseImageAssetStorageConfig,
} from '../imageAssetStore.js';

let tempDirs: string[] = [];

const createTempDir = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kidbot-image-store-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs = [];
  vi.restoreAllMocks();
});

describe('image asset storage', () => {
  it('parses explicit local storage config with safe numeric limits', () => {
    const config = parseImageAssetStorageConfig({
      KIDBOT_IMAGE_STORAGE_MODE: 'local',
      KIDBOT_IMAGE_STORAGE_DIR: 'tmp/images',
      KIDBOT_IMAGE_PUBLIC_BASE_URL: 'https://assets.example.test/kidbot',
      KIDBOT_IMAGE_MAX_BYTES: '1024',
      KIDBOT_IMAGE_TTL_SECONDS: '60',
    });

    expect(config).toEqual({
      mode: 'local',
      directory: 'tmp/images',
      publicBaseUrl: 'https://assets.example.test/kidbot',
      maxBytes: 1024,
      ttlMs: 60_000,
    });
  });

  it('rejects invalid storage mode and numeric limits without exposing secrets', () => {
    expect(() =>
      parseImageAssetStorageConfig({ KIDBOT_IMAGE_STORAGE_MODE: 'remote' }),
    ).toThrow(/KIDBOT_IMAGE_STORAGE_MODE must be data-url, local, or supabase/i);
    expect(() =>
      parseImageAssetStorageConfig({ KIDBOT_IMAGE_MAX_BYTES: '0' }),
    ).toThrow(/KIDBOT_IMAGE_MAX_BYTES must be/i);
    expect(() =>
      parseImageAssetStorageConfig({ KIDBOT_IMAGE_TTL_SECONDS: '-1' }),
    ).toThrow(/KIDBOT_IMAGE_TTL_SECONDS must be/i);
  });

  it('fails closed when production image retention differs from 24 hours', () => {
    expect(() =>
      parseImageAssetStorageConfig({
        NODE_ENV: 'production',
        KIDBOT_IMAGE_TTL_SECONDS: '60',
      }),
    ).toThrow(/KIDBOT_IMAGE_TTL_SECONDS must be 86400 in production/i);

    expect(
      parseImageAssetStorageConfig({
        NODE_ENV: 'production',
        KIDBOT_IMAGE_TTL_SECONDS: '86400',
      }).ttlMs,
    ).toBe(86_400_000);
  });

  it('parses Supabase storage config and requires server-only credentials', () => {
    const config = parseImageAssetStorageConfig({
      KIDBOT_IMAGE_STORAGE_MODE: 'supabase',
      KIDBOT_SUPABASE_URL: 'https://project-ref.supabase.co/',
      KIDBOT_SUPABASE_SERVICE_ROLE_KEY: 'server-secret-key',
      KIDBOT_SUPABASE_IMAGE_BUCKET: 'kidbot-images',
      KIDBOT_SUPABASE_IMAGE_PREFIX: 'story-panels',
      KIDBOT_IMAGE_MAX_BYTES: '1024',
      KIDBOT_IMAGE_TTL_SECONDS: '60',
    });

    expect(config).toMatchObject({
      mode: 'supabase',
      supabaseUrl: 'https://project-ref.supabase.co',
      supabaseServiceRoleKey: 'server-secret-key',
      supabaseBucket: 'kidbot-images',
      supabasePrefix: 'story-panels',
      publicBaseUrl: 'https://project-ref.supabase.co/storage/v1/object/public/kidbot-images',
      maxBytes: 1024,
      ttlMs: 60_000,
    });

    expect(() =>
      parseImageAssetStorageConfig({
        KIDBOT_IMAGE_STORAGE_MODE: 'supabase',
        KIDBOT_SUPABASE_URL: 'https://project-ref.supabase.co',
        KIDBOT_SUPABASE_SERVICE_ROLE_KEY: undefined,
        KIDBOT_SUPABASE_IMAGE_BUCKET: 'kidbot-images',
      }),
    ).toThrow(/KIDBOT_SUPABASE_SERVICE_ROLE_KEY is required/i);
  });

  it('stores PNG base64 bytes as expiring generated image URLs', async () => {
    const directory = await createTempDir();
    const store = createImageAssetStore({
      mode: 'local',
      directory,
      publicBaseUrl: '/generated-images',
      maxBytes: 128,
      ttlMs: 60_000,
    });

    const imageUrl = await store.storePngBase64(Buffer.from('png bytes').toString('base64'));

    expect(imageUrl).toMatch(/^\/generated-images\/[a-f0-9-]+\.png$/);
    const filename = path.basename(imageUrl);
    await expect(readFile(path.join(directory, filename), 'utf-8')).resolves.toContain(
      'png bytes',
    );
    await expect(stat(path.join(directory, `${filename}.expires`))).resolves.toBeTruthy();
  });

  it('rejects generated images that exceed the configured byte cap', async () => {
    const directory = await createTempDir();
    const store = createImageAssetStore({
      mode: 'local',
      directory,
      publicBaseUrl: '/generated-images',
      maxBytes: 4,
      ttlMs: 60_000,
    });

    await expect(
      store.storePngBase64(Buffer.from('too large').toString('base64')),
    ).rejects.toBeInstanceOf(ImageAssetTooLargeError);
  });

  it('uploads PNG bytes to Supabase Storage and returns a public object URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ Key: 'ok' }), { status: 200 }));
    const store = createImageAssetStore(
      {
        mode: 'supabase',
        directory: '.kidbot/generated-images',
        publicBaseUrl: 'https://project-ref.supabase.co/storage/v1/object/public/kidbot-images',
        maxBytes: 128,
        ttlMs: 60_000,
        supabaseUrl: 'https://project-ref.supabase.co',
        supabaseServiceRoleKey: 'server-secret-key',
        supabaseBucket: 'kidbot-images',
        supabasePrefix: 'story-panels',
      },
      { fetch: fetchMock },
    );

    const imageUrl = await store.storePngBase64(Buffer.from('png bytes').toString('base64'));

    expect(imageUrl).toMatch(
      /^https:\/\/project-ref\.supabase\.co\/storage\/v1\/object\/public\/kidbot-images\/story-panels\/exp-\d+-[a-f0-9-]+\.png$/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(
      /^https:\/\/project-ref\.supabase\.co\/storage\/v1\/object\/kidbot-images\/story-panels\/exp-\d+-[a-f0-9-]+\.png$/,
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      apikey: 'server-secret-key',
      Authorization: 'Bearer server-secret-key',
      'Content-Type': 'image/png',
      'Cache-Control': 'max-age=60',
      'x-upsert': 'false',
    });
    expect(Buffer.from(init.body as ArrayBuffer).toString('utf-8')).toBe('png bytes');
  });

  it('rejects Supabase image uploads that exceed the configured byte cap before network I/O', async () => {
    const fetchMock = vi.fn();
    const store = createImageAssetStore(
      {
        mode: 'supabase',
        directory: '.kidbot/generated-images',
        publicBaseUrl: 'https://project-ref.supabase.co/storage/v1/object/public/kidbot-images',
        maxBytes: 4,
        ttlMs: 60_000,
        supabaseUrl: 'https://project-ref.supabase.co',
        supabaseServiceRoleKey: 'server-secret-key',
        supabaseBucket: 'kidbot-images',
        supabasePrefix: 'story-panels',
      },
      { fetch: fetchMock },
    );

    await expect(
      store.storePngBase64(Buffer.from('too large').toString('base64')),
    ).rejects.toBeInstanceOf(ImageAssetTooLargeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cleans expired Supabase image assets without deleting fresh object keys', async () => {
    const now = 1_700_000_000_000;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { name: `exp-${now - 1}-11111111-1111-4111-8111-111111111111.png` },
            { name: `exp-${now + 60_000}-22222222-2222-4222-8222-222222222222.png` },
            { name: 'manual-upload.png' },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const config = parseImageAssetStorageConfig({
      KIDBOT_IMAGE_STORAGE_MODE: 'supabase',
      KIDBOT_SUPABASE_URL: 'https://project-ref.supabase.co',
      KIDBOT_SUPABASE_SERVICE_ROLE_KEY: 'server-secret-key',
      KIDBOT_SUPABASE_IMAGE_BUCKET: 'kidbot-images',
      KIDBOT_SUPABASE_IMAGE_PREFIX: 'story-panels',
    });

    await cleanupExpiredImageAssets(config, now, { fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://project-ref.supabase.co/storage/v1/object/list/kidbot-images',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://project-ref.supabase.co/storage/v1/object/kidbot-images',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      prefixes: [`story-panels/exp-${now - 1}-11111111-1111-4111-8111-111111111111.png`],
    });
  });

  it('cleans expired image assets and leaves fresh assets in place', async () => {
    const directory = await createTempDir();
    const expiredStore = createImageAssetStore({
      mode: 'local',
      directory,
      publicBaseUrl: '/generated-images',
      maxBytes: 128,
      ttlMs: -1,
    });
    const freshStore = createImageAssetStore({
      mode: 'local',
      directory,
      publicBaseUrl: '/generated-images',
      maxBytes: 128,
      ttlMs: 60_000,
    });
    const expiredUrl = await expiredStore.storePngBase64(Buffer.from('old').toString('base64'));
    const freshUrl = await freshStore.storePngBase64(Buffer.from('new').toString('base64'));

    await cleanupExpiredImageAssets(directory);

    await expect(stat(path.join(directory, path.basename(expiredUrl)))).rejects.toThrow();
    await expect(stat(path.join(directory, path.basename(freshUrl)))).resolves.toBeTruthy();
  });
});
