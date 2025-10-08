import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

const listen = async (server: Server): Promise<AddressInfo> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (address && typeof address !== 'string') {
        resolve(address);
        return;
      }
      reject(new Error('Failed to resolve server address'));
    });
  });

const close = async (server: Server | undefined): Promise<void> => {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

const startService = async ({
  apiKey,
  fallback
}: {
  apiKey?: string;
  fallback?: boolean;
}) => {
  vi.resetModules();
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0';
  process.env.AGENT_PORT = '';
  if (apiKey) {
    process.env.OPENAI_API_KEY = apiKey;
  } else {
    delete process.env.OPENAI_API_KEY;
  }
  if (fallback) {
    process.env.FALLBACK_WIDGET = '1';
  } else {
    delete process.env.FALLBACK_WIDGET;
  }

  const mod = await import('../index.js');
  const server = mod.start();
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { server, baseUrl };
};

const postJson = async (
  url: string,
  payload: unknown,
  headers: Record<string, string> = {}
) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  return { status: response.status, data };
};

describe('agent service stub mode', () => {
  let server: Server | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    const started = await startService({ apiKey: undefined });
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterAll(async () => {
    await close(server);
  });

  test('returns fixture backed voice replies when no API key is configured', async () => {
    const { status, data } = await postJson(`${baseUrl}/voice`, {
      text: 'Tell me a moon fact',
      persona: 'robot',
      ageBand: '7-9'
    });

    expect(status).toBe(200);
    expect(data.blocked).toBe(false);
    expect(data.source).toBe('stub');
    expect(data.text).toContain('Moon');
    expect(data).toHaveProperty('correlationId');
  });

  test('provides story panels sourced from fixtures', async () => {
    const { status, data } = await postJson(`${baseUrl}/story-panels`, {
      theme: 'A shy dragon makes a friend',
      panels: 4,
      ageBand: '7-9'
    });

    expect(status).toBe(200);
    expect(data.blocked).toBe(false);
    expect(data.source).toBe('stub');
    expect(data.panels).toHaveLength(4);
    expect(data.panels[0].title).toBe('Quiet Cave');
  });

  test('serves coloring outlines from SVG fixtures', async () => {
    const { status, data } = await postJson(`${baseUrl}/coloring-outline`, {
      scene: 'space cat'
    });

    expect(status).toBe(200);
    expect(data.blocked).toBe(false);
    expect(data.source).toBe('stub');
    expect(data.svg).toContain('<svg');
  });

  test('delivers science experiments and preserves the topic', async () => {
    const { status, data } = await postJson(`${baseUrl}/science-sim`, {
      topic: 'buoyancy',
      ageBand: '7-9'
    });

    expect(status).toBe(200);
    expect(data.blocked).toBe(false);
    expect(data.source).toBe('stub');
    expect(data.topic).toBe('buoyancy');
    expect(data.explanation).toContain('float');
  });

  test('rejects invalid payloads with helpful errors', async () => {
    const response = await fetch(`${baseUrl}/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '', persona: 'robot' })
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Bad Request');
    expect(body).toHaveProperty('details');
  });
});

describe('agent service authorization and local responses', () => {
  let server: Server | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    const started = await startService({ apiKey: 'sekret' });
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterAll(async () => {
    await close(server);
  });

  test('rejects requests without the required bearer token', async () => {
    const response = await fetch(`${baseUrl}/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hi there', persona: 'robot', ageBand: '7-9' })
    });

    expect(response.status).toBe(401);
  });

  test('produces local agent responses when authorized', async () => {
    const { status, data } = await postJson(
      `${baseUrl}/voice`,
      { text: 'Share a rainbow fact', persona: 'explorer', ageBand: '7-9' },
      { Authorization: 'Bearer sekret' }
    );

    expect(status).toBe(200);
    expect(data.blocked).toBe(false);
    expect(data.source).toBe('local');
    expect(data.persona).toBe('explorer');
  });
});

