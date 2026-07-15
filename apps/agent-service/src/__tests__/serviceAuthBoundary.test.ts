import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 15_000 });

let tempDirs: string[] = [];

const ENV_KEYS = [
  'DOTENV_CONFIG_PATH',
  'NODE_ENV',
  'FALLBACK_WIDGET',
  'KIDBOT_LOCAL_DEV',
  'AGENT_SERVICE_TOKEN',
  'OPENAI_API_KEY',
  'PROVIDER_FAILURE_POLICY',
  'KIDBOT_IMAGE_STORAGE_MODE',
  'KIDBOT_IMAGE_STORAGE_DIR',
  'KIDBOT_IMAGE_PUBLIC_BASE_URL',
  'KIDBOT_IMAGE_MAX_BYTES',
  'KIDBOT_IMAGE_TTL_SECONDS',
  'KIDBOT_SUPABASE_URL',
  'KIDBOT_SUPABASE_SERVICE_ROLE_KEY',
  'KIDBOT_SUPABASE_IMAGE_BUCKET',
  'KIDBOT_SUPABASE_IMAGE_PREFIX',
  'RATE_LIMIT_STORE',
  'REDIS_URL',
] as const;

const withEnv = async <T>(
  overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  run: () => Promise<T>,
) => {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    const value =
      key === 'DOTENV_CONFIG_PATH' && !Object.prototype.hasOwnProperty.call(overrides, key)
        ? '__kidbot_test_env_not_found__'
        : overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

const withServer = async (
  app: {
    listen: (port: number) => { close: () => void; address: () => AddressInfo | string | null };
  },
  run: (baseUrl: string) => Promise<void>,
) => {
  const server = app.listen(0);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    server.close();
  }
};

afterEach(() => {
  vi.doUnmock('../provider.js');
  vi.unstubAllGlobals();
  vi.resetModules();
});

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs = [];
});

const createTempDir = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kidbot-service-images-'));
  tempDirs.push(dir);
  return dir;
};

describe('service auth boundary', () => {
  it('fails startup when token is required but missing', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '0',
        KIDBOT_LOCAL_DEV: undefined,
        AGENT_SERVICE_TOKEN: undefined,
        OPENAI_API_KEY: undefined,
      },
      async () => {
        await expect(import('../index.js')).rejects.toThrow(/AGENT_SERVICE_TOKEN is required/i);
      },
    );
  });

  it('rejects unauthorized service requests when token is required', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '0',
        KIDBOT_LOCAL_DEV: undefined,
        AGENT_SERVICE_TOKEN: 'test-service-token',
        OPENAI_API_KEY: undefined,
      },
      async () => {
        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/voice`, {
            method: 'POST',
            headers: {
              'x-kidbot-startup-posture': 'secured',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text: 'Tell me a cheerful moon fact.',
              persona: 'robot',
              ageBand: '7-9',
            }),
          });
          const body = (await response.json()) as { error?: string };
          expect(response.status).toBe(401);
          expect(body.error).toBe('Unauthorized');
        });
      },
    );
  });

  it('fails production secured startup when token is too short without leaking it', async () => {
    await withEnv(
      {
        NODE_ENV: 'production',
        FALLBACK_WIDGET: '0',
        KIDBOT_LOCAL_DEV: undefined,
        AGENT_SERVICE_TOKEN: 'short-token-secret',
        OPENAI_API_KEY: undefined,
      },
      async () => {
        await expect(import('../index.js')).rejects.toThrow(/at least 32 characters/i);
        try {
          await import('../index.js');
        } catch (error) {
          expect(error instanceof Error ? error.message : String(error)).not.toContain(
            'short-token-secret',
          );
        }
      },
    );
  });

  it('accepts authorized service requests with the configured token', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '0',
        KIDBOT_LOCAL_DEV: undefined,
        AGENT_SERVICE_TOKEN: 'test-service-token',
        OPENAI_API_KEY: undefined,
      },
      async () => {
        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/voice`, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer test-service-token',
              'x-kidbot-startup-posture': 'secured',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text: 'Tell me a cheerful moon fact.',
              persona: 'robot',
              ageBand: '7-9',
            }),
          });
          const body = (await response.json()) as { blocked?: boolean; error?: string };
          expect(response.status).toBe(200);
          expect(body.error).toBeUndefined();
          expect(body.blocked).toBe(false);
        });
      },
    );
  });

  it('fails startup when fallback mode is missing explicit local-dev intent', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '1',
        KIDBOT_LOCAL_DEV: undefined,
        AGENT_SERVICE_TOKEN: undefined,
        OPENAI_API_KEY: undefined,
      },
      async () => {
        await expect(import('../index.js')).rejects.toThrow(/KIDBOT_LOCAL_DEV=1/i);
      },
    );
  });

  it('allows local fallback mode only with explicit local-dev intent', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '1',
        KIDBOT_LOCAL_DEV: '1',
        AGENT_SERVICE_TOKEN: undefined,
        OPENAI_API_KEY: undefined,
      },
      async () => {
        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/voice`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text: 'Tell me a cheerful moon fact.',
              persona: 'robot',
              ageBand: '7-9',
            }),
          });
          expect(response.status).toBe(200);
        });
      },
    );
  });

  it('moderates unsafe input in local fallback mode before returning fixtures', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '1',
        KIDBOT_LOCAL_DEV: '1',
        AGENT_SERVICE_TOKEN: undefined,
        OPENAI_API_KEY: undefined,
      },
      async () => {
        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/story-panels`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              theme: 'A violent fight',
              panels: 2,
              ageBand: '7-9',
            }),
          });
          const body = (await response.json()) as { blocked?: boolean; panels?: unknown[] };
          expect(response.status).toBe(200);
          expect(body.blocked).toBe(true);
          expect(body.panels).toBeUndefined();
        });
      },
    );
  });

  it('returns 429 with Retry-After and correlationId when a route exceeds its rate limit', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '1',
        KIDBOT_LOCAL_DEV: '1',
        AGENT_SERVICE_TOKEN: undefined,
        OPENAI_API_KEY: undefined,
      },
      async () => {
        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          let limited: Response | undefined;
          for (let i = 0; i < 61; i += 1) {
            limited = await fetch(`${baseUrl}/voice`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                text: 'Tell me a cheerful moon fact.',
                persona: 'robot',
                ageBand: '7-9',
              }),
            });
          }

          expect(limited?.status).toBe(429);
          expect(limited?.headers.get('Retry-After')).toBeTruthy();
          const body = (await limited?.json()) as { error?: string; correlationId?: string };
          expect(body.error).toBe('Too Many Requests');
          expect(body.correlationId).toMatch(/^kb_/);
        });
      },
    );
  });

  it('rejects secured requests with missing startup posture header', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '0',
        KIDBOT_LOCAL_DEV: undefined,
        AGENT_SERVICE_TOKEN: 'test-service-token',
        OPENAI_API_KEY: undefined,
      },
      async () => {
        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/voice`, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer test-service-token',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text: 'Tell me a cheerful moon fact.',
              persona: 'robot',
              ageBand: '7-9',
            }),
          });
          const body = (await response.json()) as { error?: string; details?: string };
          expect(response.status).toBe(409);
          expect(body.error).toBe('Startup posture mismatch');
          expect(body.details).toMatch(/x-kidbot-startup-posture=secured/i);
        });
      },
    );
  });

  it('rejects posture mismatch when secured caller claims local-fallback', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '0',
        KIDBOT_LOCAL_DEV: undefined,
        AGENT_SERVICE_TOKEN: 'test-service-token',
        OPENAI_API_KEY: undefined,
      },
      async () => {
        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/voice`, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer test-service-token',
              'x-kidbot-startup-posture': 'local-fallback',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text: 'Tell me a cheerful moon fact.',
              persona: 'robot',
              ageBand: '7-9',
            }),
          });
          const body = (await response.json()) as { error?: string; details?: string };
          expect(response.status).toBe(409);
          expect(body.error).toBe('Startup posture mismatch');
          expect(body.details).toMatch(/service posture "secured"/i);
        });
      },
    );
  });

  it('reports limiter readiness without service auth', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '0',
        KIDBOT_LOCAL_DEV: undefined,
        AGENT_SERVICE_TOKEN: 'test-service-token',
        OPENAI_API_KEY: undefined,
      },
      async () => {
        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/healthz`);
          const body = (await response.json()) as {
            ok?: boolean;
            service?: string;
            startupPosture?: string;
            rateLimitStore?: { mode?: string; ready?: boolean };
          };

          expect(response.status).toBe(200);
          expect(body.ok).toBe(true);
          expect(body.service).toBe('agent-service');
          expect(body.startupPosture).toBe('secured');
          expect(body.rateLimitStore).toEqual({ mode: 'memory', ready: true });
        });
      },
    );
  });

  it('logs keyed session audit references without raw request data', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const serviceToken = 'test-service-token';
    const sessionId = 'kb_session_audit123';
    const profileId = 'local-default';
    const prompt = 'Tell me a cheerful moon fact.';
    const imageUrl = 'https://images.example.test/private/generated-image.png?token=raw-image-token';
    try {
      await withEnv(
        {
          NODE_ENV: 'test',
          FALLBACK_WIDGET: '0',
          KIDBOT_LOCAL_DEV: undefined,
          AGENT_SERVICE_TOKEN: serviceToken,
          OPENAI_API_KEY: undefined,
        },
        async () => {
          const mod = await import('../index.js');
          await withServer(mod.app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/voice`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${serviceToken}`,
                'x-kidbot-startup-posture': 'secured',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                text: prompt,
                persona: 'robot',
                ageBand: '4-6',
                profileId,
                sessionId,
                parentPin: '1234',
                imageUrl,
              }),
            });

            expect(response.status).toBe(200);
          });
        },
      );

      const logs = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      const sessionRef = createHmac('sha256', serviceToken)
        .update(`session:${sessionId}`)
        .digest('base64url')
        .slice(0, 24);
      const profileRef = createHmac('sha256', serviceToken)
        .update(`profile:${profileId}`)
        .digest('base64url')
        .slice(0, 24);
      expect(logs).toContain(`"sessionRef":"${sessionRef}"`);
      expect(logs).toContain(`"profileRef":"${profileRef}"`);
      expect(sessionRef).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      expect(profileRef).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      expect(logs).toContain('"ageBand":"4-6"');
      expect(logs).not.toContain(sessionId);
      expect(logs).not.toContain(profileId);
      expect(logs).not.toContain(prompt);
      expect(logs).not.toContain(serviceToken);
      expect(logs).not.toContain(imageUrl);
      expect(logs).not.toContain('raw-image-token');
      expect(logs).not.toContain('1234');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('rejects local fallback intent in production', async () => {
    await withEnv(
      {
        NODE_ENV: 'production',
        FALLBACK_WIDGET: '1',
        KIDBOT_LOCAL_DEV: '1',
        AGENT_SERVICE_TOKEN: undefined,
        OPENAI_API_KEY: undefined,
      },
      async () => {
        await expect(import('../index.js')).rejects.toThrow(/production.*fallback|fallback.*production/i);
      },
    );
  });

  it('omits session audit references in local fallback posture', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const sessionId = 'kb_session_local123';
    const profileId = 'local-default';
    try {
      await withEnv(
        {
          NODE_ENV: 'test',
          FALLBACK_WIDGET: '1',
          KIDBOT_LOCAL_DEV: '1',
          AGENT_SERVICE_TOKEN: undefined,
          OPENAI_API_KEY: undefined,
        },
        async () => {
          const mod = await import('../index.js');
          await withServer(mod.app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/voice`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: 'Tell me a moon fact.',
                persona: 'robot',
                profileId,
                sessionId,
              }),
            });
            expect(response.status).toBe(200);
          });
        },
      );

      const logs = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logs).not.toContain('sessionRef');
      expect(logs).not.toContain('profileRef');
      expect(logs).not.toContain(sessionId);
      expect(logs).not.toContain(profileId);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('returns generated story image data URLs through the HTTP route', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '0',
        KIDBOT_LOCAL_DEV: undefined,
        AGENT_SERVICE_TOKEN: 'test-service-token',
        OPENAI_API_KEY: 'test-provider-key',
        PROVIDER_FAILURE_POLICY: '503',
        KIDBOT_IMAGE_STORAGE_MODE: 'data-url',
      },
      async () => {
        vi.doMock('../provider.js', async (importOriginal) => {
          const actual = await importOriginal<typeof import('../provider.js')>();
          return {
            ...actual,
            createOpenAIProvider: () => ({
              async generateText() {
                return JSON.stringify({
                  panels: [
                    {
                      title: 'Seed',
                      caption: 'Mia plants a bean.',
                      imagePrompt: 'Mia planting a bean',
                      imageUrl: null,
                    },
                    {
                      title: 'Sprout',
                      caption: 'A green sprout pops up.',
                      imagePrompt: 'A happy sprout',
                      imageUrl: null,
                    },
                  ],
                });
              },
              async generateImage({ prompt }: { prompt: string }) {
                return Buffer.from(prompt).toString('base64');
              },
              async moderateText() {
                return { blocked: false };
              },
            }),
          };
        });

        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/story-panels`, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer test-service-token',
              'x-kidbot-startup-posture': 'secured',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              theme: 'A bean grows',
              panels: 2,
              ageBand: '7-9',
            }),
          });
          const body = (await response.json()) as {
            blocked?: boolean;
            panels?: Array<{ imageUrl?: string | null }>;
          };

          expect(response.status).toBe(200);
          expect(body.blocked).toBe(false);
          expect(body.panels?.[0]?.imageUrl).toBe(
            `data:image/png;base64,${Buffer.from('Mia planting a bean').toString('base64')}`,
          );
          expect(body.panels?.[1]?.imageUrl).toBe(
            `data:image/png;base64,${Buffer.from('A happy sprout').toString('base64')}`,
          );
        });
      },
    );
  });

  it('returns stored story image URLs through the HTTP route when local image storage is enabled', async () => {
    const imageDir = await createTempDir();
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '0',
        KIDBOT_LOCAL_DEV: undefined,
        AGENT_SERVICE_TOKEN: 'test-service-token',
        OPENAI_API_KEY: 'test-provider-key',
        PROVIDER_FAILURE_POLICY: '503',
        KIDBOT_IMAGE_STORAGE_MODE: 'local',
        KIDBOT_IMAGE_STORAGE_DIR: imageDir,
        KIDBOT_IMAGE_PUBLIC_BASE_URL: '/generated-images',
        KIDBOT_IMAGE_MAX_BYTES: '1024',
        KIDBOT_IMAGE_TTL_SECONDS: '60',
      },
      async () => {
        vi.doMock('../provider.js', async (importOriginal) => {
          const actual = await importOriginal<typeof import('../provider.js')>();
          return {
            ...actual,
            createOpenAIProvider: () => ({
              async generateText() {
                return JSON.stringify({
                  panels: [
                    {
                      title: 'Seed',
                      caption: 'Mia plants a bean.',
                      imagePrompt: 'Mia planting a bean',
                      imageUrl: null,
                    },
                    {
                      title: 'Sprout',
                      caption: 'A green sprout pops up.',
                      imagePrompt: 'A happy sprout',
                      imageUrl: null,
                    },
                  ],
                });
              },
              async generateImage({ prompt }: { prompt: string }) {
                return Buffer.from(`png:${prompt}`).toString('base64');
              },
              async moderateText() {
                return { blocked: false };
              },
            }),
          };
        });

        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/story-panels`, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer test-service-token',
              'x-kidbot-startup-posture': 'secured',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              theme: 'A bean grows',
              panels: 2,
              ageBand: '7-9',
            }),
          });
          const body = (await response.json()) as {
            blocked?: boolean;
            panels?: Array<{ imageUrl?: string | null }>;
          };

          expect(response.status).toBe(200);
          expect(body.blocked).toBe(false);
          expect(body.panels?.[0]?.imageUrl).toMatch(/^\/generated-images\/[a-f0-9-]+\.png$/);
          expect(body.panels?.[1]?.imageUrl).toMatch(/^\/generated-images\/[a-f0-9-]+\.png$/);
          expect(body.panels?.[0]?.imageUrl).not.toContain('base64');

          const storedResponse = await fetch(`${baseUrl}${body.panels?.[0]?.imageUrl}`);
          expect(storedResponse.status).toBe(200);
          expect(storedResponse.headers.get('Content-Type')).toContain('image/png');
          await expect(storedResponse.text()).resolves.toBe('png:Mia planting a bean');

          const files = await readFile(
            path.join(imageDir, path.basename(body.panels?.[0]?.imageUrl ?? '')),
            'utf-8',
          );
          expect(files).toBe('png:Mia planting a bean');
        });
      },
    );
  });

  it('returns Supabase Storage story image URLs through the HTTP route when Supabase storage is enabled', async () => {
    const originalFetch = globalThis.fetch;
    const supabaseFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://project-ref.supabase.co/storage/v1/object/kidbot-images/')) {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({
          apikey: 'server-secret-key',
          Authorization: 'Bearer server-secret-key',
          'Content-Type': 'image/png',
        });
        return new Response(JSON.stringify({ Key: 'ok' }), { status: 200 });
      }
      return originalFetch(input, init);
    });
    vi.stubGlobal('fetch', supabaseFetch);

    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '0',
        KIDBOT_LOCAL_DEV: undefined,
        AGENT_SERVICE_TOKEN: 'test-service-token',
        OPENAI_API_KEY: 'test-provider-key',
        PROVIDER_FAILURE_POLICY: '503',
        KIDBOT_IMAGE_STORAGE_MODE: 'supabase',
        KIDBOT_IMAGE_MAX_BYTES: '1024',
        KIDBOT_IMAGE_TTL_SECONDS: '60',
        KIDBOT_SUPABASE_URL: 'https://project-ref.supabase.co',
        KIDBOT_SUPABASE_SERVICE_ROLE_KEY: 'server-secret-key',
        KIDBOT_SUPABASE_IMAGE_BUCKET: 'kidbot-images',
        KIDBOT_SUPABASE_IMAGE_PREFIX: 'story-panels',
      },
      async () => {
        vi.doMock('../provider.js', async (importOriginal) => {
          const actual = await importOriginal<typeof import('../provider.js')>();
          return {
            ...actual,
            createOpenAIProvider: () => ({
              async generateText() {
                return JSON.stringify({
                  panels: [
                    {
                      title: 'Seed',
                      caption: 'Mia plants a bean.',
                      imagePrompt: 'Mia planting a bean',
                      imageUrl: null,
                    },
                    {
                      title: 'Sprout',
                      caption: 'A green sprout pops up.',
                      imagePrompt: 'A happy sprout',
                      imageUrl: null,
                    },
                  ],
                });
              },
              async generateImage({ prompt }: { prompt: string }) {
                return Buffer.from(`png:${prompt}`).toString('base64');
              },
              async moderateText() {
                return { blocked: false };
              },
            }),
          };
        });

        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/story-panels`, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer test-service-token',
              'x-kidbot-startup-posture': 'secured',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              theme: 'A bean grows',
              panels: 2,
              ageBand: '7-9',
            }),
          });
          const body = (await response.json()) as {
            blocked?: boolean;
            panels?: Array<{ imageUrl?: string | null }>;
          };

          expect(response.status).toBe(200);
          expect(body.blocked).toBe(false);
          expect(body.panels?.[0]?.imageUrl).toMatch(
            /^https:\/\/project-ref\.supabase\.co\/storage\/v1\/object\/public\/kidbot-images\/story-panels\/exp-\d+-[a-f0-9-]+\.png$/,
          );
          expect(body.panels?.[1]?.imageUrl).toMatch(
            /^https:\/\/project-ref\.supabase\.co\/storage\/v1\/object\/public\/kidbot-images\/story-panels\/exp-\d+-[a-f0-9-]+\.png$/,
          );
        });
      },
    );
  });

  it('returns degraded service when stored story image output exceeds the byte cap under 503 policy', async () => {
    const imageDir = await createTempDir();
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '0',
        KIDBOT_LOCAL_DEV: undefined,
        AGENT_SERVICE_TOKEN: 'test-service-token',
        OPENAI_API_KEY: 'test-provider-key',
        PROVIDER_FAILURE_POLICY: '503',
        KIDBOT_IMAGE_STORAGE_MODE: 'local',
        KIDBOT_IMAGE_STORAGE_DIR: imageDir,
        KIDBOT_IMAGE_PUBLIC_BASE_URL: '/generated-images',
        KIDBOT_IMAGE_MAX_BYTES: '4',
        KIDBOT_IMAGE_TTL_SECONDS: '60',
      },
      async () => {
        vi.doMock('../provider.js', async (importOriginal) => {
          const actual = await importOriginal<typeof import('../provider.js')>();
          return {
            ...actual,
            createOpenAIProvider: () => ({
              async generateText() {
                return JSON.stringify({
                  panels: [
                    {
                      title: 'Seed',
                      caption: 'Mia plants a bean.',
                      imagePrompt: 'Mia planting a bean',
                      imageUrl: null,
                    },
                    {
                      title: 'Sprout',
                      caption: 'A green sprout pops up.',
                      imagePrompt: 'A happy sprout',
                      imageUrl: null,
                    },
                  ],
                });
              },
              async generateImage() {
                return Buffer.from('too large for cap').toString('base64');
              },
              async moderateText() {
                return { blocked: false };
              },
            }),
          };
        });

        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/story-panels`, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer test-service-token',
              'x-kidbot-startup-posture': 'secured',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              theme: 'A bean grows',
              panels: 2,
              ageBand: '7-9',
            }),
          });
          const body = (await response.json()) as {
            error?: string;
            fallbackReason?: string;
            panels?: unknown[];
          };

          expect(response.status).toBe(503);
          expect(body.error).toBe('Service temporarily degraded');
          expect(body.fallbackReason).toBe('provider_unavailable');
          expect(body.panels).toBeUndefined();
        });
      },
    );
  });

  it('returns degraded service when story image generation fails under 503 policy', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '0',
        KIDBOT_LOCAL_DEV: undefined,
        AGENT_SERVICE_TOKEN: 'test-service-token',
        OPENAI_API_KEY: 'test-provider-key',
        PROVIDER_FAILURE_POLICY: '503',
      },
      async () => {
        vi.doMock('../provider.js', async (importOriginal) => {
          const actual = await importOriginal<typeof import('../provider.js')>();
          return {
            ...actual,
            createOpenAIProvider: () => ({
              async generateText() {
                return JSON.stringify({
                  panels: [
                    {
                      title: 'Seed',
                      caption: 'Mia plants a bean.',
                      imagePrompt: 'Mia planting a bean',
                      imageUrl: null,
                    },
                    {
                      title: 'Sprout',
                      caption: 'A green sprout pops up.',
                      imagePrompt: 'A happy sprout',
                      imageUrl: null,
                    },
                  ],
                });
              },
              async generateImage() {
                throw new actual.ProviderUnavailableError('image provider unavailable');
              },
              async moderateText() {
                return { blocked: false };
              },
            }),
          };
        });

        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/story-panels`, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer test-service-token',
              'x-kidbot-startup-posture': 'secured',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              theme: 'A bean grows',
              panels: 2,
              ageBand: '7-9',
            }),
          });
          const body = (await response.json()) as {
            error?: string;
            fallbackReason?: string;
            panels?: unknown[];
          };

          expect(response.status).toBe(503);
          expect(body.error).toBe('Service temporarily degraded');
          expect(body.fallbackReason).toBe('provider_unavailable');
          expect(body.panels).toBeUndefined();
        });
      },
    );
  });

  it('uses safe placeholder panels without leaking provider or request data to warnings', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const serviceToken = 'sentinel-service-token';
    const profileId = 'sentinel-profile-id';
    const sessionId = 'kb_session_sentinel-session-id';
    const prompt = 'sentinel private story prompt';
    const imageUrl = 'https://private.example/image.png?token=sentinel-image-token';
    try {
      await withEnv(
        {
          NODE_ENV: 'test',
          FALLBACK_WIDGET: '0',
          KIDBOT_LOCAL_DEV: undefined,
          AGENT_SERVICE_TOKEN: serviceToken,
          OPENAI_API_KEY: 'test-provider-key',
          PROVIDER_FAILURE_POLICY: 'fallback',
        },
        async () => {
          vi.doMock('../provider.js', async (importOriginal) => {
            const actual = await importOriginal<typeof import('../provider.js')>();
            return {
              ...actual,
              createOpenAIProvider: () => ({
                async generateText() {
                  return JSON.stringify({
                    panels: [
                      {
                        title: 'Seed',
                        caption: 'Mia plants a bean.',
                        imagePrompt: 'Mia planting a bean',
                        imageUrl: null,
                      },
                      {
                        title: 'Sprout',
                        caption: 'A green sprout pops up.',
                        imagePrompt: 'A happy sprout',
                        imageUrl: null,
                      },
                    ],
                  });
                },
                async generateImage() {
                  throw Object.assign(
                    new actual.ProviderUnavailableError(
                      `${prompt} ${serviceToken} ${profileId} ${sessionId} ${imageUrl}`,
                    ),
                    { status: 503 },
                  );
                },
                async moderateText() {
                  return { blocked: false };
                },
              }),
            };
          });

          const mod = await import('../index.js');
          await withServer(mod.app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/story-panels`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${serviceToken}`,
                'x-kidbot-startup-posture': 'secured',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                theme: prompt,
                panels: 2,
                ageBand: '7-9',
                profileId,
                sessionId,
              }),
            });
            const body = (await response.json()) as {
              blocked?: boolean;
              fallbackReason?: string;
              panels?: Array<{ imageUrl?: string | null }>;
              providerFallback?: boolean;
            };

            expect(response.status).toBe(200);
            expect(body.blocked).toBe(false);
            expect(body.providerFallback).toBe(true);
            expect(body.fallbackReason).toBe('provider_unavailable');
            expect(body.panels).toHaveLength(2);
            expect(body.panels?.every((panel) => panel.imageUrl === null)).toBe(true);

            const warnings = warnSpy.mock.calls.map((call) => String(call[0])).join('\n');
            expect(warnings).toContain('provider_unavailable');
            expect(warnings).toContain('503');
            for (const sentinel of [serviceToken, profileId, sessionId, prompt, imageUrl]) {
              expect(warnings).not.toContain(sentinel);
            }
          });
        },
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
