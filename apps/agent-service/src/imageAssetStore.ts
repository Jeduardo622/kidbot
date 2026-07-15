import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProviderUnavailableError } from './provider.js';

export type ImageAssetStorageMode = 'data-url' | 'local' | 'supabase';

export interface ImageAssetStorageConfig {
  mode: ImageAssetStorageMode;
  directory: string;
  publicBaseUrl: string;
  maxBytes: number;
  ttlMs: number;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  supabaseBucket?: string;
  supabasePrefix?: string;
}

type ImageAssetStorageEnv = Partial<
  Record<
    | 'KIDBOT_IMAGE_STORAGE_MODE'
    | 'NODE_ENV'
    | 'KIDBOT_IMAGE_STORAGE_DIR'
    | 'KIDBOT_IMAGE_PUBLIC_BASE_URL'
    | 'KIDBOT_IMAGE_MAX_BYTES'
    | 'KIDBOT_IMAGE_TTL_SECONDS'
    | 'KIDBOT_SUPABASE_URL'
    | 'KIDBOT_SUPABASE_SERVICE_ROLE_KEY'
    | 'KIDBOT_SUPABASE_IMAGE_BUCKET'
    | 'KIDBOT_SUPABASE_IMAGE_PREFIX',
    string
  >
>;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ImageAssetStoreDeps {
  fetch?: FetchLike;
}

export class ImageAssetTooLargeError extends ProviderUnavailableError {
  constructor(message = 'Generated image exceeded configured storage size limit') {
    super(message);
    this.name = 'ImageAssetTooLargeError';
  }
}

const parsePositiveInteger = (name: string, value: string | undefined, fallback: number) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
};

const trimOptional = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeSupabaseUrl = (value: string | undefined) => {
  const trimmed = trimOptional(value);
  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    return url.origin;
  } catch {
    throw new Error('KIDBOT_SUPABASE_URL must be a valid URL.');
  }
};

const normalizePrefix = (value: string | undefined) => {
  const normalized = (trimOptional(value) ?? 'story-panels')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
  if (!/^[A-Za-z0-9/_-]+$/.test(normalized)) {
    throw new Error('KIDBOT_SUPABASE_IMAGE_PREFIX may only contain letters, numbers, slash, dash, and underscore.');
  }
  return normalized;
};

const requireSupabaseValue = (
  name: 'KIDBOT_SUPABASE_URL' | 'KIDBOT_SUPABASE_SERVICE_ROLE_KEY' | 'KIDBOT_SUPABASE_IMAGE_BUCKET',
  value: string | undefined,
) => {
  const trimmed = trimOptional(value);
  if (!trimmed) {
    throw new Error(`${name} is required when KIDBOT_IMAGE_STORAGE_MODE=supabase.`);
  }
  return trimmed;
};

export const parseImageAssetStorageConfig = (
  env: ImageAssetStorageEnv = process.env,
): ImageAssetStorageConfig => {
  const mode = env.KIDBOT_IMAGE_STORAGE_MODE?.trim() || 'data-url';
  if (mode !== 'data-url' && mode !== 'local' && mode !== 'supabase') {
    throw new Error('KIDBOT_IMAGE_STORAGE_MODE must be data-url, local, or supabase.');
  }

  const supabaseUrl =
    mode === 'supabase'
      ? normalizeSupabaseUrl(requireSupabaseValue('KIDBOT_SUPABASE_URL', env.KIDBOT_SUPABASE_URL))
      : normalizeSupabaseUrl(env.KIDBOT_SUPABASE_URL);
  const supabaseBucket =
    mode === 'supabase'
      ? requireSupabaseValue('KIDBOT_SUPABASE_IMAGE_BUCKET', env.KIDBOT_SUPABASE_IMAGE_BUCKET)
      : trimOptional(env.KIDBOT_SUPABASE_IMAGE_BUCKET);
  const supabaseServiceRoleKey =
    mode === 'supabase'
      ? requireSupabaseValue(
          'KIDBOT_SUPABASE_SERVICE_ROLE_KEY',
          env.KIDBOT_SUPABASE_SERVICE_ROLE_KEY,
        )
      : trimOptional(env.KIDBOT_SUPABASE_SERVICE_ROLE_KEY);
  const supabasePrefix = normalizePrefix(env.KIDBOT_SUPABASE_IMAGE_PREFIX);
  const publicBaseUrl =
    env.KIDBOT_IMAGE_PUBLIC_BASE_URL?.trim() ||
    (mode === 'supabase' && supabaseUrl && supabaseBucket
      ? `${supabaseUrl}/storage/v1/object/public/${supabaseBucket}`
      : '/generated-images');
  const ttlSeconds = parsePositiveInteger(
    'KIDBOT_IMAGE_TTL_SECONDS',
    env.KIDBOT_IMAGE_TTL_SECONDS,
    86_400,
  );
  if (env.NODE_ENV === 'production' && ttlSeconds !== 86_400) {
    throw new Error('KIDBOT_IMAGE_TTL_SECONDS must be 86400 in production.');
  }

  return {
    mode,
    directory: env.KIDBOT_IMAGE_STORAGE_DIR?.trim() || '.kidbot/generated-images',
    publicBaseUrl,
    maxBytes: parsePositiveInteger('KIDBOT_IMAGE_MAX_BYTES', env.KIDBOT_IMAGE_MAX_BYTES, 2_500_000),
    ttlMs: ttlSeconds * 1_000,
    ...(mode === 'supabase'
      ? {
          supabaseUrl,
          supabaseServiceRoleKey,
          supabaseBucket,
          supabasePrefix,
        }
      : {}),
  };
};

const joinPublicUrl = (baseUrl: string, filename: string) =>
  `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(filename)}`;

const joinPublicObjectUrl = (baseUrl: string, objectPath: string) =>
  `${baseUrl.replace(/\/+$/, '')}/${objectPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;

const assertSupabaseConfig = (config: ImageAssetStorageConfig) => {
  if (
    !config.supabaseUrl ||
    !config.supabaseServiceRoleKey ||
    !config.supabaseBucket ||
    !config.supabasePrefix
  ) {
    throw new ProviderUnavailableError('Supabase image storage is not fully configured');
  }
};

const supabaseHeaders = (config: ImageAssetStorageConfig, extra?: Record<string, string>) => {
  assertSupabaseConfig(config);
  const serviceRoleKey = config.supabaseServiceRoleKey;
  if (!serviceRoleKey) {
    throw new ProviderUnavailableError('Supabase image storage is not fully configured');
  }
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  };
};

export interface ImageAssetStore {
  readonly config: ImageAssetStorageConfig;
  storePngBase64(base64: string): Promise<string>;
}

export const createImageAssetStore = (
  config: ImageAssetStorageConfig,
  deps: ImageAssetStoreDeps = {},
): ImageAssetStore => ({
  config,
  async storePngBase64(base64) {
    if (config.mode === 'data-url') {
      return `data:image/png;base64,${base64}`;
    }

    const bytes = Buffer.from(base64, 'base64');
    if (bytes.byteLength > config.maxBytes) {
      throw new ImageAssetTooLargeError();
    }

    if (config.mode === 'supabase') {
      assertSupabaseConfig(config);
      const fetchImpl = deps.fetch ?? fetch;
      const expiresAt = Date.now() + config.ttlMs;
      const objectPath = `${config.supabasePrefix}/exp-${expiresAt}-${randomUUID()}.png`;
      const response = await fetchImpl(
        `${config.supabaseUrl}/storage/v1/object/${config.supabaseBucket}/${objectPath}`,
        {
          method: 'POST',
          headers: supabaseHeaders(config, {
            'Content-Type': 'image/png',
            'Cache-Control': `max-age=${Math.max(1, Math.floor(config.ttlMs / 1_000))}`,
            'x-upsert': 'false',
          }),
          body: bytes,
        },
      );
      if (!response.ok) {
        throw new ProviderUnavailableError(`Supabase image upload failed with ${response.status}`);
      }
      return joinPublicObjectUrl(config.publicBaseUrl, objectPath);
    }

    await mkdir(config.directory, { recursive: true });
    const filename = `${randomUUID()}.png`;
    const fullPath = path.join(config.directory, filename);
    const expiresAt = Date.now() + config.ttlMs;
    await writeFile(fullPath, bytes);
    await writeFile(`${fullPath}.expires`, String(expiresAt));
    return joinPublicUrl(config.publicBaseUrl, filename);
  },
});

const cleanupExpiredLocalImageAssets = async (directory: string, now: number) => {
  let files: string[];
  try {
    files = await readdir(directory);
  } catch {
    return;
  }

  await Promise.all(
    files
      .filter((file) => file.endsWith('.png.expires'))
      .map(async (file) => {
        const markerPath = path.join(directory, file);
        const expiresAt = Number(await readFile(markerPath, 'utf-8').catch(() => '0'));
        if (!Number.isFinite(expiresAt) || expiresAt > now) {
          return;
        }

        const imagePath = markerPath.slice(0, -'.expires'.length);
        await Promise.all([
          rm(imagePath, { force: true }),
          rm(markerPath, { force: true }),
        ]);
      }),
  );
};

const cleanupExpiredSupabaseImageAssets = async (
  config: ImageAssetStorageConfig,
  now: number,
  deps: ImageAssetStoreDeps,
) => {
  assertSupabaseConfig(config);
  const fetchImpl = deps.fetch ?? fetch;
  const listResponse = await fetchImpl(
    `${config.supabaseUrl}/storage/v1/object/list/${config.supabaseBucket}`,
    {
      method: 'POST',
      headers: supabaseHeaders(config, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        prefix: config.supabasePrefix,
        limit: 1000,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' },
      }),
    },
  );
  if (!listResponse.ok) {
    return;
  }

  const entries = (await listResponse.json().catch(() => [])) as Array<{ name?: unknown }>;
  const expiredPrefixes = entries
    .map((entry) => (typeof entry.name === 'string' ? entry.name : undefined))
    .filter((name): name is string => Boolean(name))
    .filter((name) => {
      const match = /^exp-(\d+)-[a-f0-9-]+\.png$/.exec(path.basename(name));
      return match ? Number(match[1]) <= now : false;
    })
    .map((name) => `${config.supabasePrefix}/${name.replace(/^\/+/, '')}`);

  if (expiredPrefixes.length === 0) {
    return;
  }

  await fetchImpl(`${config.supabaseUrl}/storage/v1/object/${config.supabaseBucket}`, {
    method: 'DELETE',
    headers: supabaseHeaders(config, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: expiredPrefixes }),
  }).catch(() => undefined);
};

export const cleanupExpiredImageAssets = async (
  target: string | ImageAssetStorageConfig,
  now = Date.now(),
  deps: ImageAssetStoreDeps = {},
) => {
  try {
    if (typeof target === 'string') {
      await cleanupExpiredLocalImageAssets(target, now);
      return;
    }

    if (target.mode === 'local') {
      await cleanupExpiredLocalImageAssets(target.directory, now);
      return;
    }

    if (target.mode === 'supabase') {
      await cleanupExpiredSupabaseImageAssets(target, now, deps);
    }
  } catch {
    // Cleanup is best-effort; request handling should not fail because stale assets remain.
  }
};
