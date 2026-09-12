import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ImageAssetTooLargeError,
  cleanupExpiredImageAssets,
  createImageAssetStore,
  decodeBoundedImageBase64,
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
        KIDBOT_IMAGE_STORAGE_MODE: 'local',
        KIDBOT_IMAGE_TTL_SECONDS: '60',
      }),
    ).toThrow(/KIDBOT_IMAGE_TTL_SECONDS must be 86400 in production/i);

    expect(
      parseImageAssetStorageConfig({
        NODE_ENV: 'production',
        KIDBOT_IMAGE_STORAGE_MODE: 'local',
        KIDBOT_IMAGE_TTL_SECONDS: '86400',
      }).ttlMs,
    ).toBe(86_400_000);
  });

  it('requires bounded non-inline storage in production', () => {
    expect(() =>
      parseImageAssetStorageConfig({
        NODE_ENV: 'production',
        KIDBOT_IMAGE_STORAGE_MODE: 'data-url',
      }),
    ).toThrow(/data-url.*not allowed in production/i);
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

  it('rejects obviously oversized base64 before allocating decoded bytes', () => {
    const bufferFrom = vi.spyOn(Buffer, 'from');

    expect(() => decodeBoundedImageBase64('A'.repeat(1_000), 4)).toThrow(
      ImageAssetTooLargeError,
    );
    expect(bufferFrom).not.toHaveBeenCalled();
  });

  it('applies the configured byte cap before returning inline image data', async () => {
    const store = createImageAssetStore({
      mode: 'data-url',
      directory: '.kidbot/generated-images',
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

  it('passes request cancellation through to Supabase uploads', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
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
    const controller = new AbortController();

    await store.storePngBase64(Buffer.from('png bytes').toString('base64'), controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('does not write a local image when the request is already aborted', async () => {
    const directory = await createTempDir();
    const store = createImageAssetStore({
      mode: 'local',
      directory,
      publicBaseUrl: '/generated-images',
      maxBytes: 128,
      ttlMs: 60_000,
    });
    const controller = new AbortController();
    controller.abort(new Error('request cancelled'));

    await expect(
      store.storePngBase64(Buffer.from('png bytes').toString('base64'), controller.signal),
    ).rejects.toThrow('request cancelled');
    await expect(readFile(directory)).rejects.toThrow();
  });

  it('passes the signal to local writes and removes only its partial asset pair on failure', async () => {
    const controller = new AbortController();
    const writes: Array<{ path: string; signal?: AbortSignal }> = [];
    const removals: string[] = [];
    const generatedId = '11111111-1111-4111-8111-111111111111';
    const directory = path.join(tmpdir(), 'kidbot-test-images');
    const imagePath = path.join(directory, `${generatedId}.png`);
    const store = createImageAssetStore(
      {
        mode: 'local',
        directory,
        publicBaseUrl: '/generated-images',
        maxBytes: 128,
        ttlMs: 60_000,
      },
      {
        mkdir: vi.fn(async () => undefined),
        randomUUID: () => generatedId,
        rm: vi.fn(async (target) => {
          removals.push(String(target));
        }),
        writeFile: vi.fn(async (target, _contents, options) => {
          writes.push({ path: String(target), signal: options?.signal });
          if (String(target).endsWith('.expires')) throw new Error('marker write failed');
        }),
      },
    );

    await expect(
      store.storePngBase64(Buffer.from('png bytes').toString('base64'), controller.signal),
    ).rejects.toThrow('marker write failed');
    expect(writes).toEqual([
      { path: imagePath, signal: controller.signal },
      { path: `${imagePath}.expires`, signal: controller.signal },
    ]);
    expect(removals.sort()).toEqual([
      imagePath,
      `${imagePath}.expires`,
    ].sort());
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
