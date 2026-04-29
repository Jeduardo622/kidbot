import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 15_000 });

const ENV_KEYS = [
  'NODE_ENV',
  'FALLBACK_WIDGET',
  'KIDBOT_LOCAL_DEV',
  'AGENT_SERVICE_TOKEN',
  'OPENAI_API_KEY',
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
    const value = overrides[key];
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
  vi.resetModules();
});

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
});
