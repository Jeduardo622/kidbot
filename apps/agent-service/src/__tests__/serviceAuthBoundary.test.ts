import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['NODE_ENV', 'FALLBACK_WIDGET', 'AGENT_SERVICE_TOKEN', 'OPENAI_API_KEY'] as const;

const withEnv = async <T>(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, run: () => Promise<T>) => {
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

const withServer = async (app: { listen: (port: number) => { close: () => void; address: () => AddressInfo | string | null } }, run: (baseUrl: string) => Promise<void>) => {
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
        AGENT_SERVICE_TOKEN: undefined,
        OPENAI_API_KEY: undefined
      },
      async () => {
        await expect(import('../index.js')).rejects.toThrow(/AGENT_SERVICE_TOKEN is required/i);
      }
    );
  });

  it('rejects unauthorized service requests when token is required', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '0',
        AGENT_SERVICE_TOKEN: 'test-service-token',
        OPENAI_API_KEY: undefined
      },
      async () => {
        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/voice`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              text: 'Tell me a cheerful moon fact.',
              persona: 'robot',
              ageBand: '7-9'
            })
          });
          const body = (await response.json()) as { error?: string };
          expect(response.status).toBe(401);
          expect(body.error).toBe('Unauthorized');
        });
      }
    );
  });

  it('accepts authorized service requests with the configured token', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '0',
        AGENT_SERVICE_TOKEN: 'test-service-token',
        OPENAI_API_KEY: undefined
      },
      async () => {
        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/voice`, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer test-service-token',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              text: 'Tell me a cheerful moon fact.',
              persona: 'robot',
              ageBand: '7-9'
            })
          });
          const body = (await response.json()) as { blocked?: boolean; error?: string };
          expect(response.status).toBe(200);
          expect(body.error).toBeUndefined();
          expect(body.blocked).toBe(false);
        });
      }
    );
  });

  it('allows local fallback mode without service token', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        FALLBACK_WIDGET: '1',
        AGENT_SERVICE_TOKEN: undefined,
        OPENAI_API_KEY: undefined
      },
      async () => {
        const mod = await import('../index.js');
        await withServer(mod.app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/voice`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              text: 'Tell me a cheerful moon fact.',
              persona: 'robot',
              ageBand: '7-9'
            })
          });
          expect(response.status).toBe(200);
        });
      }
    );
  });
});
