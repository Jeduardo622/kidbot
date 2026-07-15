import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

const packageDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const repositoryRoot = join(packageDir, '../..');
const mcpEntry = join(packageDir, 'dist', 'server.js');
const agentEntry = join(packageDir, '../agent-service/dist/index.js');

if (!existsSync(mcpEntry)) {
  throw new Error(
    'Missing apps/mcp-server/dist/server.js. Run `pnpm --filter mcp-server build` before startup matrix test.',
  );
}

if (!existsSync(agentEntry)) {
  throw new Error(
    'Missing apps/agent-service/dist/index.js. Run `pnpm --filter agent-service build` before startup matrix test.',
  );
}

const toolIds = [
  'voice_chat',
  'story_panels',
  'coloring_outline',
  'science_sim',
  'parent_profile_create',
  'parent_profile_update',
  'parent_profile_delete',
  'parent_history_list',
];
const strongToken = () => `matrix-token-${randomInt(1000, 9999)}-abcdefghijklmnopqrstuvwxyz0123456789`;
const localEnvBypassPath = join(packageDir, '.env.auth-matrix-not-used');
const mcpServerEnvKeys = [
  'AGENT_BASE_URL',
  'AGENT_PORT',
  'AGENT_SERVICE_TOKEN',
  'FALLBACK_WIDGET',
  'KIDBOT_LOCAL_DEV',
  'KIDBOT_WIDGET_DOMAIN',
  'KIDBOT_WIDGET_RESOURCE_DOMAINS',
  'MCP_PORT',
  'MCP_AGENT_REQUEST_TIMEOUT_MS',
  'MCP_CALLER_CONCURRENCY',
  'MCP_CALLER_COST_PER_MINUTE',
  'MCP_CALLER_REQUESTS_PER_MINUTE',
  'MCP_GLOBAL_CONCURRENCY',
  'MCP_GLOBAL_COST_PER_MINUTE',
  'MCP_GLOBAL_REQUESTS_PER_MINUTE',
  'MCP_NETWORK_CONCURRENCY',
  'MCP_NETWORK_COST_PER_MINUTE',
  'MCP_NETWORK_REQUESTS_PER_MINUTE',
  'MCP_REQUEST_CONTROL_STORE',
  'NODE_ENV',
  'PARENT_AUTH_SECRET',
  'PARENT_HISTORY_MAX_EVENTS',
  'PARENT_HISTORY_RETENTION_DAYS',
  'PARENT_PROFILE_STORE',
];
const schemaValidator = new AjvJsonSchemaValidator();
const isolatedEnvKeys = [
  ...mcpServerEnvKeys,
  'OPENAI_API_KEY',
  'PORT',
];

const childBaseEnv = () => {
  const base = { ...process.env };
  for (const key of isolatedEnvKeys) {
    delete base[key];
  }
  return base;
};

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error('Failed to allocate a free port.'));
          return;
        }
        resolve(port);
      });
    });
  });

const spawnProcess = (entry, env) =>
  spawn(process.execPath, [entry], {
    cwd: process.cwd(),
    env: {
      ...childBaseEnv(),
      DOTENV_CONFIG_PATH: localEnvBypassPath,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const waitForMcpHealth = async (baseUrl) => {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server may still be starting.
    }
    await delay(150);
  }

  throw new Error(`mcp-server did not become healthy on ${baseUrl}`);
};

const waitForAgentVoice = async (
  baseUrl,
  token,
  postureHeader = 'secured',
  diagnostics = () => '',
) => {
  let lastStatus = null;
  let lastBody = '';
  for (let i = 0; i < 40; i += 1) {
    try {
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      if (postureHeader) {
        headers['x-kidbot-startup-posture'] = postureHeader;
      }
      const response = await fetch(`${baseUrl}/voice`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text: 'Tell me a moon fact',
          persona: 'robot',
          ageBand: '7-9',
        }),
      });

      lastStatus = response.status;
      lastBody = await response.text();
      if (response.ok) {
        return;
      }
    } catch {
      // Server may still be starting.
    }
    await delay(150);
  }

  throw new Error(
    `agent-service did not become ready on ${baseUrl}; lastStatus=${lastStatus}; lastBody=${lastBody}; ${diagnostics()}`,
  );
};

const stopProcess = (child) => {
  if (child && !child.killed) {
    child.kill();
  }
};

const readExit = async (child, timeoutMs = 3000) =>
  Promise.race([
    new Promise((resolve) =>
      child.on('exit', (code, signal) => {
        resolve({ code, signal });
      }),
    ),
    delay(timeoutMs).then(() => ({ code: null, signal: 'timeout' })),
  ]);

const callMcp = async (baseUrl, payload, headers = {}) => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  return {
    status: response.status,
    body: await response.text(),
  };
};

const parseMcpResponse = (body) => {
  const dataLine = body
    .split(/\r?\n/)
    .find((line) => line.startsWith('data:'));
  if (!dataLine) {
    throw new Error(`Missing MCP data line in response body: ${body}`);
  }
  return JSON.parse(dataLine.slice('data:'.length).trim());
};

const listen = (server, port) =>
  new Promise((resolve) => {
    server.listen(port, resolve);
  });

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const redisAvailable = (redisUrl) =>
  new Promise((resolve) => {
    try {
      const parsed = new URL(redisUrl);
      const socket = createConnection({
        host: parsed.hostname,
        port: Number(parsed.port || 6379),
      });
      const done = (available) => {
        socket.destroy();
        resolve(available);
      };
      socket.setTimeout(500);
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.once('timeout', () => done(false));
    } catch {
      resolve(false);
    }
  });

const configImportEnv = Object.fromEntries(
  mcpServerEnvKeys.map((key) => [key, process.env[key]]),
);
for (const key of mcpServerEnvKeys) {
  delete process.env[key];
}
process.env.FALLBACK_WIDGET = '1';
process.env.KIDBOT_LOCAL_DEV = '1';
process.env.NODE_ENV = 'test';
const { parseMcpServerConfig } = await import('../dist/config.js');
for (const [key, value] of Object.entries(configImportEnv)) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

const productionWidgetEnv = {
  NODE_ENV: 'production',
  AGENT_SERVICE_TOKEN: 'a'.repeat(32),
  MCP_REQUEST_CONTROL_STORE: 'redis',
  KIDBOT_WIDGET_DOMAIN: 'https://kidbot-production.up.railway.app',
  KIDBOT_WIDGET_RESOURCE_DOMAINS: 'https://rxnwualzddplucjhclij.supabase.co',
};

const getToolDescriptor = async (baseUrl, name) => {
  const response = await callMcp(baseUrl, {
    jsonrpc: '2.0',
    id: `list-${name}`,
    method: 'tools/list',
    params: {},
  });
  const descriptor = parseMcpResponse(response.body).result.tools.find((tool) => tool.name === name);
  assert.ok(descriptor, `missing ${name} descriptor`);
  return descriptor;
};

const assertMatchesAdvertisedOutput = (descriptor, structuredContent) => {
  const result = schemaValidator.getValidator(descriptor.outputSchema)(structuredContent);
  assert.equal(result.valid, true, result.errorMessage);
};

test('widget CSP parses exact production origins', () => {
  const config = parseMcpServerConfig(productionWidgetEnv);

  assert.equal(config.widgetDomain, 'https://kidbot-production.up.railway.app');
  assert.deepEqual(config.widgetResourceDomains, [
    'https://rxnwualzddplucjhclij.supabase.co',
  ]);
});

test('widget CSP rejects non-exact production origins', () => {
  const invalidValues = [
    'http://rxnwualzddplucjhclij.supabase.co',
    'https://*.supabase.co',
    'https://rxnwualzddplucjhclij.supabase.co/storage',
    'https://rxnwualzddplucjhclij.supabase.co?query=1',
    'https://rxnwualzddplucjhclij.supabase.co#fragment',
    'https://user:password@rxnwualzddplucjhclij.supabase.co',
  ];

  for (const value of invalidValues) {
    assert.throws(
      () => parseMcpServerConfig({
        ...productionWidgetEnv,
        KIDBOT_WIDGET_RESOURCE_DOMAINS: value,
      }),
      /KIDBOT_WIDGET_RESOURCE_DOMAINS/,
      value,
    );
  }
});

test('widget CSP requires both production values', () => {
  for (const missingKey of ['KIDBOT_WIDGET_DOMAIN', 'KIDBOT_WIDGET_RESOURCE_DOMAINS']) {
    const env = { ...productionWidgetEnv };
    delete env[missingKey];
    assert.throws(() => parseMcpServerConfig(env), new RegExp(missingKey));
  }
});

test('widget CSP uses sandbox defaults outside production', () => {
  const config = parseMcpServerConfig({
    FALLBACK_WIDGET: '1',
    KIDBOT_LOCAL_DEV: '1',
  });

  assert.equal(config.widgetDomain, 'https://web-sandbox.oaiusercontent.com');
  assert.deepEqual(config.widgetResourceDomains, []);
});

test('production parent retention fails closed unless it is exactly 30 days', () => {
  assert.throws(
    () => parseMcpServerConfig({
      ...productionWidgetEnv,
      PARENT_HISTORY_RETENTION_DAYS: '7',
    }),
    /PARENT_HISTORY_RETENTION_DAYS must be 30 in production/i,
  );

  assert.equal(parseMcpServerConfig({
    ...productionWidgetEnv,
    PARENT_HISTORY_RETENTION_DAYS: '30',
  }).parentHistoryRetentionDays, 30);
});

test('non-fallback mode without AGENT_SERVICE_TOKEN fails closed at mcp startup', async () => {
  const mcpPort = await getFreePort();
  const mcp = spawnProcess(mcpEntry, {
    FALLBACK_WIDGET: '0',
    MCP_PORT: String(mcpPort),
  });

  let stderr = '';
  mcp.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const exit = await readExit(mcp, 3500);
    assert.notEqual(exit.code, 0);
    assert.match(stderr, /AGENT_SERVICE_TOKEN is required unless FALLBACK_WIDGET=1/i);
  } finally {
    stopProcess(mcp);
  }
});

test('non-fallback production mode with short AGENT_SERVICE_TOKEN fails closed at mcp startup', async () => {
  const mcpPort = await getFreePort();
  const mcp = spawnProcess(mcpEntry, {
    ...productionWidgetEnv,
    AGENT_SERVICE_TOKEN: 'short-token-secret',
    FALLBACK_WIDGET: '0',
    MCP_PORT: String(mcpPort),
  });

  let stderr = '';
  mcp.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const exit = await readExit(mcp, 3500);
    assert.notEqual(exit.code, 0);
    assert.match(stderr, /at least 32 characters/i);
    assert.doesNotMatch(stderr, /short-token-secret/i);
  } finally {
    stopProcess(mcp);
  }
});

test('non-fallback mode with AGENT_SERVICE_TOKEN allows mcp to call agent-service', async () => {
  const token = strongToken();
  const agentPort = await getFreePort();
  const mcpPort = await getFreePort();
  const agentBaseUrl = `http://localhost:${agentPort}`;
  const mcpBaseUrl = `http://localhost:${mcpPort}`;

  const agent = spawnProcess(agentEntry, {
    AGENT_SERVICE_TOKEN: token,
    FALLBACK_WIDGET: '0',
    OPENAI_API_KEY: '',
    PORT: String(agentPort),
  });

  const mcp = spawnProcess(mcpEntry, {
    AGENT_PORT: String(agentPort),
    AGENT_SERVICE_TOKEN: token,
    FALLBACK_WIDGET: '0',
    MCP_PORT: String(mcpPort),
  });

  let agentStdout = '';
  let agentStderr = '';
  agent.stdout.on('data', (chunk) => {
    agentStdout += chunk.toString();
  });
  agent.stderr.on('data', (chunk) => {
    agentStderr += chunk.toString();
  });

  try {
    await waitForAgentVoice(
      agentBaseUrl,
      token,
      'secured',
      () =>
        `agent stdout=${agentStdout.slice(-500)}; agent stderr=${agentStderr.slice(-500)}`,
    );
    await waitForMcpHealth(mcpBaseUrl);

    const response = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'voice_chat',
        arguments: {
          text: 'Tell me a moon fact',
          persona: 'robot',
          ageBand: '7-9',
        },
      },
    });

    assert.equal(response.status, 200);
    assert.match(response.body, /"blocked":false/);
    assert.match(response.body, /reply ready/i);
  } finally {
    stopProcess(mcp);
    stopProcess(agent);
  }
});

test('fallback mode remains explicit bypass path without AGENT_SERVICE_TOKEN', async () => {
  const mcpPort = await getFreePort();
  const mcpBaseUrl = `http://localhost:${mcpPort}`;
  const mcp = spawnProcess(mcpEntry, {
    FALLBACK_WIDGET: '1',
    KIDBOT_LOCAL_DEV: '1',
    MCP_PORT: String(mcpPort),
  });

  try {
    await waitForMcpHealth(mcpBaseUrl);

    const response = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 102,
      method: 'tools/list',
      params: {},
    });

    assert.equal(response.status, 200);
    for (const toolId of toolIds) {
      assert.match(response.body, new RegExp(`"${toolId}"`));
    }
  } finally {
    stopProcess(mcp);
  }
});

test('network admission limits list and malformed requests before dispatch', async () => {
  const mcpPort = await getFreePort();
  const mcpBaseUrl = `http://localhost:${mcpPort}`;
  const mcp = spawnProcess(mcpEntry, {
    FALLBACK_WIDGET: '1',
    KIDBOT_LOCAL_DEV: '1',
    MCP_GLOBAL_REQUESTS_PER_MINUTE: '1',
    MCP_PORT: String(mcpPort),
    MCP_REQUEST_CONTROL_STORE: 'memory',
  });
  try {
    await waitForMcpHealth(mcpBaseUrl);
    const first = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 700,
      method: 'tools/list',
      params: {},
    });
    assert.equal(first.status, 200);
    const blocked = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 701,
      method: 'resources/list',
      params: {},
    });
    assert.equal(blocked.status, 429);
    assert.match(blocked.body, /rate_limited/);
  } finally {
    stopProcess(mcp);
  }
});

test('network admission accounts oversized bodies before JSON parsing', async () => {
  const mcpPort = await getFreePort();
  const mcpBaseUrl = `http://localhost:${mcpPort}`;
  const mcp = spawnProcess(mcpEntry, {
    FALLBACK_WIDGET: '1',
    KIDBOT_LOCAL_DEV: '1',
    MCP_GLOBAL_REQUESTS_PER_MINUTE: '1',
    MCP_PORT: String(mcpPort),
    MCP_REQUEST_CONTROL_STORE: 'memory',
  });
  try {
    await waitForMcpHealth(mcpBaseUrl);
    const oversized = await fetch(`${mcpBaseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    const blocked = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0', id: 702, method: 'tools/list', params: {},
    });
    assert.equal(blocked.status, 429);
  } finally {
    stopProcess(mcp);
  }
});

test('mcp rejects local fallback intent in production', async () => {
  const mcpPort = await getFreePort();
  const mcp = spawnProcess(mcpEntry, {
    NODE_ENV: 'production',
    FALLBACK_WIDGET: '1',
    KIDBOT_LOCAL_DEV: '1',
    MCP_PORT: String(mcpPort),
  });
  let stderr = '';
  mcp.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  try {
    const exit = await readExit(mcp, 3500);
    assert.notEqual(exit.code, 0);
    assert.match(stderr, /production.*fallback|fallback.*production/i);
  } finally {
    stopProcess(mcp);
  }
});

test('privacy route publishes the source-backed data and retention contract', async () => {
  const mcpPort = await getFreePort();
  const mcpBaseUrl = `http://localhost:${mcpPort}`;
  const mcp = spawnProcess(mcpEntry, {
    FALLBACK_WIDGET: '1',
    KIDBOT_LOCAL_DEV: '1',
    MCP_PORT: String(mcpPort),
  });

  try {
    await waitForMcpHealth(mcpBaseUrl);

    const response = await fetch(`${mcpBaseUrl}/privacy`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
    for (const disclosure of [
      /OpenAI processes prompts and generated outputs/i,
      /Railway hosts the Kidbot services and Redis deployment/i,
      /Supabase Storage stores generated story-panel images/i,
      /Browser speech recognition may send microphone audio/i,
      /In production, Kidbot retains[^.]*exactly 30 days/i,
      /In production, generated story images[^.]*exactly 24 hours/i,
      /deletion cannot recall data[^.]*OpenAI, Railway, Supabase/i,
      /github\.com\/Jeduardo622\/kidbot\/issues/i,
    ]) {
      assert.match(html, disclosure);
    }

    const diag = await (await fetch(`${mcpBaseUrl}/diag`)).text();
    assert.match(diag, /href="\/privacy"/i);

    const privacyMarkdown = readFileSync(join(repositoryRoot, 'PRIVACY.md'), 'utf8');
    const decodeHtml = (value) => value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&rsquo;/g, '’');
    const normalizeDisclosure = (value) => decodeHtml(value)
      .replace(/<head>[\s\S]*?<\/head>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^[-*]\s+/gm, '')
      .replace(/\*\*/g, '')
      .replace(/<([^>]+)>/g, '$1')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .trim();
    assert.equal(normalizeDisclosure(html), normalizeDisclosure(privacyMarkdown));

    const readme = readFileSync(join(repositoryRoot, 'README.md'), 'utf8');
    const spec = readFileSync(join(repositoryRoot, 'EXECUTSPEC.md'), 'utf8');
    assert.doesNotMatch(readme, /do not store profile or session data/i);
    assert.doesNotMatch(spec, /COPPA\s*\/\s*GDPR-K aligned/i);
    assert.doesNotMatch(spec, /Session only, no external storage/i);
    assert.match(`${readme}\n${spec}`, /privacy and legal review[^\n]*required[^\n]*public launch/i);
  } finally {
    stopProcess(mcp);
  }
});

test('parent profile deletion is destructive, closed-world, and requires parent credentials', async () => {
  const mcpPort = await getFreePort();
  const mcpBaseUrl = `http://localhost:${mcpPort}`;
  const mcp = spawnProcess(mcpEntry, {
    FALLBACK_WIDGET: '1',
    KIDBOT_LOCAL_DEV: '1',
    MCP_PORT: String(mcpPort),
  });

  try {
    await waitForMcpHealth(mcpBaseUrl);
    const descriptor = await getToolDescriptor(mcpBaseUrl, 'parent_profile_delete');
    assert.equal(descriptor.annotations?.destructiveHint, true);
    assert.equal(descriptor.annotations?.openWorldHint, false);
    assert.deepEqual(descriptor.inputSchema.required?.sort(), ['parentAccessToken', 'profileId']);
    assert.equal(descriptor.inputSchema.additionalProperties, false);
  } finally {
    stopProcess(mcp);
  }
});

test('mcp returns a stable tool error when a caller exceeds its request budget', async () => {
  const mcpPort = await getFreePort();
  const mcpBaseUrl = `http://localhost:${mcpPort}`;
  const mcp = spawnProcess(mcpEntry, {
    FALLBACK_WIDGET: '1',
    KIDBOT_LOCAL_DEV: '1',
    MCP_CALLER_REQUESTS_PER_MINUTE: '1',
    MCP_GLOBAL_REQUESTS_PER_MINUTE: '100',
    MCP_PORT: String(mcpPort),
    MCP_REQUEST_CONTROL_STORE: 'memory',
  });
  const payload = {
    jsonrpc: '2.0',
    id: 120,
    method: 'tools/call',
    params: {
      name: 'voice_chat',
      arguments: {
        text: 'Tell me a moon fact',
        persona: 'robot',
        ageBand: '7-9',
      },
    },
  };

  try {
    await waitForMcpHealth(mcpBaseUrl);
    const descriptor = await getToolDescriptor(mcpBaseUrl, 'voice_chat');
    const first = await callMcp(mcpBaseUrl, payload);
    const second = await callMcp(mcpBaseUrl, { ...payload, id: 121 });
    const rejection = parseMcpResponse(second.body).result.structuredContent;

    assert.equal(first.status, 200);
    assert.match(first.body, /reply ready/i);
    assert.equal(second.status, 200);
    assert.match(second.body, /"isError":true/);
    assert.match(second.body, /"code":"rate_limited"/);
    assert.match(second.body, /"retryAfter"/);
    assertMatchesAdvertisedOutput(descriptor, rejection);
  } finally {
    stopProcess(mcp);
  }
});

test('blocked bogus profile requests do not reach Redis before request controls', async (t) => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || !(await redisAvailable(redisUrl))) {
    t.skip('REDIS_URL is not available');
    return;
  }

  const mcpPort = await getFreePort();
  const mcpBaseUrl = `http://localhost:${mcpPort}`;
  const parentSecret = strongToken();
  const profileId = `kb_profile_preflight${randomInt(100000, 999999)}`;
  const profileKey = `kidbot:profile:${profileId}`;
  const observer = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const monitor = await observer.monitor();
  const waitForMonitorBarrier = async (marker) => {
    const observed = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        monitor.off('monitor', onMonitor);
        reject(new Error(`Timed out waiting for Redis monitor barrier: ${marker}`));
      }, 2_000);
      const onMonitor = (_time, args) => {
        if (args[0]?.toLowerCase() === 'echo' && args[1] === marker) {
          clearTimeout(timeout);
          monitor.off('monitor', onMonitor);
          resolve();
        }
      };
      monitor.on('monitor', onMonitor);
    });
    await observer.echo(marker);
    await observed;
  };
  let profileReads = 0;
  monitor.on('monitor', (_time, args) => {
    if (args[0]?.toLowerCase() === 'get' && args[1] === profileKey) {
      profileReads += 1;
    }
  });
  const mcp = spawnProcess(mcpEntry, {
    FALLBACK_WIDGET: '1',
    KIDBOT_LOCAL_DEV: '1',
    MCP_CALLER_REQUESTS_PER_MINUTE: '1',
    MCP_GLOBAL_REQUESTS_PER_MINUTE: '100',
    MCP_PORT: String(mcpPort),
    MCP_REQUEST_CONTROL_STORE: 'memory',
    PARENT_AUTH_SECRET: parentSecret,
    PARENT_PROFILE_STORE: 'redis',
    REDIS_URL: redisUrl,
  });
  const payload = {
    jsonrpc: '2.0',
    id: 122,
    method: 'tools/call',
    params: {
      name: 'parent_history_list',
      arguments: {
        profileId,
        parentAccessToken: `kb_parent_bogus${randomInt(10000000, 99999999)}token`,
        limit: 1,
      },
    },
  };

  try {
    await waitForMcpHealth(mcpBaseUrl);
    await callMcp(mcpBaseUrl, payload);
    await waitForMonitorBarrier(`after-allowed-${profileId}`);
    const readsAfterAllowedRequest = profileReads;
    assert.ok(readsAfterAllowedRequest >= 1, 'allowed request should validate parent access');

    const blocked = await callMcp(mcpBaseUrl, { ...payload, id: 123 });
    await waitForMonitorBarrier(`after-blocked-${profileId}`);

    assert.match(blocked.body, /"code":"rate_limited"/);
    assert.equal(profileReads, readsAfterAllowedRequest);
  } finally {
    stopProcess(mcp);
    monitor.disconnect();
    observer.disconnect();
  }
});

test('rotated subject and forwarded headers cannot evade the network budget', async () => {
  const mcpPort = await getFreePort();
  const mcpBaseUrl = `http://localhost:${mcpPort}`;
  const mcp = spawnProcess(mcpEntry, {
    FALLBACK_WIDGET: '1',
    KIDBOT_LOCAL_DEV: '1',
    MCP_CALLER_REQUESTS_PER_MINUTE: '100',
    MCP_GLOBAL_REQUESTS_PER_MINUTE: '100',
    MCP_NETWORK_REQUESTS_PER_MINUTE: '1',
    MCP_PORT: String(mcpPort),
    MCP_REQUEST_CONTROL_STORE: 'memory',
  });
  const payload = (id, subject) => ({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: {
      _meta: { 'openai/subject': subject },
      name: 'voice_chat',
      arguments: { text: 'Tell me a moon fact', persona: 'robot', ageBand: '7-9' },
    },
  });

  try {
    await waitForMcpHealth(mcpBaseUrl);
    const first = await callMcp(
      mcpBaseUrl, payload(123, 'subject-a'), { 'x-forwarded-for': '203.0.113.10' },
    );
    const second = await callMcp(
      mcpBaseUrl, payload(124, 'subject-b'), { 'x-forwarded-for': '198.51.100.20' },
    );
    assert.equal(first.status, 200);
    assert.match(first.body, /reply ready/i);
    assert.equal(second.status, 429);
    assert.match(second.body, /"message":"rate_limited"/);
  } finally {
    stopProcess(mcp);
  }
});

test('fallback mode without KIDBOT_LOCAL_DEV fails closed at mcp startup', async () => {
  const mcpPort = await getFreePort();
  const mcp = spawnProcess(mcpEntry, {
    FALLBACK_WIDGET: '1',
    MCP_PORT: String(mcpPort),
  });

  let stderr = '';
  mcp.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const exit = await readExit(mcp, 3500);
    assert.notEqual(exit.code, 0);
    assert.match(stderr, /KIDBOT_LOCAL_DEV=1/i);
  } finally {
    stopProcess(mcp);
  }
});

test('mcp secured posture fails loudly when agent runs local fallback posture', async () => {
  const token = strongToken();
  const agentPort = await getFreePort();
  const mcpPort = await getFreePort();
  const agentBaseUrl = `http://localhost:${agentPort}`;
  const mcpBaseUrl = `http://localhost:${mcpPort}`;

  const agent = spawnProcess(agentEntry, {
    FALLBACK_WIDGET: '1',
    KIDBOT_LOCAL_DEV: '1',
    OPENAI_API_KEY: '',
    PORT: String(agentPort),
  });

  const mcp = spawnProcess(mcpEntry, {
    AGENT_PORT: String(agentPort),
    AGENT_SERVICE_TOKEN: token,
    FALLBACK_WIDGET: '0',
    MCP_PORT: String(mcpPort),
  });

  try {
    await waitForAgentVoice(agentBaseUrl, token, null);
    await waitForMcpHealth(mcpBaseUrl);

    const response = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 103,
      method: 'tools/call',
      params: {
        name: 'voice_chat',
        arguments: {
          text: 'Tell me a moon fact',
          persona: 'robot',
          ageBand: '7-9',
        },
      },
    });

    assert.equal(response.status, 200);
    assert.match(response.body, /status 409/i);
  } finally {
    stopProcess(mcp);
    stopProcess(agent);
  }
});

test('mcp surfaces provider 503 as degraded content instead of a safety block', async () => {
  const token = strongToken();
  const agentPort = await getFreePort();
  const mcpPort = await getFreePort();
  const mcpBaseUrl = `http://localhost:${mcpPort}`;

  const fakeAgent = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/voice') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Service temporarily degraded',
          fallbackReason: 'generation_timeout',
          correlationId: 'kb_test_degraded',
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await listen(fakeAgent, agentPort);

  const mcp = spawnProcess(mcpEntry, {
    AGENT_PORT: String(agentPort),
    AGENT_SERVICE_TOKEN: token,
    FALLBACK_WIDGET: '0',
    MCP_PORT: String(mcpPort),
  });

  try {
    await waitForMcpHealth(mcpBaseUrl);
    const descriptor = await getToolDescriptor(mcpBaseUrl, 'voice_chat');

    const response = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 104,
      method: 'tools/call',
      params: {
        name: 'voice_chat',
        arguments: {
          text: 'Tell me a moon fact',
          persona: 'robot',
          ageBand: '7-9',
        },
      },
    });

    assert.equal(response.status, 200);
    assert.match(response.body, /"blocked":false/);
    assert.match(response.body, /"degraded":true/);
    assert.match(response.body, /"fallbackReason":"generation_timeout"/);
    assert.match(response.body, /idea engine right now/i);
    assertMatchesAdvertisedOutput(
      descriptor,
      parseMcpResponse(response.body).result.structuredContent,
    );
  } finally {
    stopProcess(mcp);
    await closeServer(fakeAgent);
  }
});

test('mcp deadline aborts the downstream agent request', async () => {
  const token = strongToken();
  const agentPort = await getFreePort();
  const mcpPort = await getFreePort();
  const mcpBaseUrl = `http://localhost:${mcpPort}`;
  let observeAbort;
  const aborted = new Promise((resolve) => {
    observeAbort = resolve;
  });
  const fakeAgent = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/voice') {
      req.on('aborted', () => observeAbort(true));
      res.on('close', () => {
        if (!res.writableEnded) observeAbort(true);
      });
      return;
    }
    res.writeHead(404).end();
  });
  await listen(fakeAgent, agentPort);

  const mcp = spawnProcess(mcpEntry, {
    AGENT_PORT: String(agentPort),
    AGENT_SERVICE_TOKEN: token,
    FALLBACK_WIDGET: '0',
    MCP_AGENT_REQUEST_TIMEOUT_MS: '50',
    MCP_PORT: String(mcpPort),
    MCP_REQUEST_CONTROL_STORE: 'memory',
  });

  try {
    await waitForMcpHealth(mcpBaseUrl);
    const descriptor = await getToolDescriptor(mcpBaseUrl, 'voice_chat');
    const response = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 122,
      method: 'tools/call',
      params: {
        name: 'voice_chat',
        arguments: {
          text: 'Tell me a moon fact',
          persona: 'robot',
          ageBand: '7-9',
        },
      },
    });

    assert.equal(response.status, 200);
    assert.match(response.body, /"isError":true/);
    assert.match(response.body, /"code":"request_timeout"/);
    assertMatchesAdvertisedOutput(
      descriptor,
      parseMcpResponse(response.body).result.structuredContent,
    );
    assert.equal(await Promise.race([aborted, delay(1_000).then(() => false)]), true);
  } finally {
    stopProcess(mcp);
    await closeServer(fakeAgent);
  }
});

test('mcp concurrency rejection matches the advertised output contract', async () => {
  const token = strongToken();
  const agentPort = await getFreePort();
  const mcpPort = await getFreePort();
  const mcpBaseUrl = `http://localhost:${mcpPort}`;
  const fakeAgent = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/voice') {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ blocked: false, persona: 'robot', text: 'Ready.' }));
      }, 300);
      return;
    }
    res.writeHead(404).end();
  });
  await listen(fakeAgent, agentPort);
  const mcp = spawnProcess(mcpEntry, {
    AGENT_PORT: String(agentPort),
    AGENT_SERVICE_TOKEN: token,
    FALLBACK_WIDGET: '0',
    MCP_CALLER_CONCURRENCY: '1',
    MCP_GLOBAL_CONCURRENCY: '10',
    MCP_NETWORK_CONCURRENCY: '10',
    MCP_PORT: String(mcpPort),
    MCP_REQUEST_CONTROL_STORE: 'memory',
  });
  const payload = (id) => ({
    jsonrpc: '2.0', id, method: 'tools/call', params: {
      name: 'voice_chat',
      arguments: { text: 'Tell me a moon fact', persona: 'robot', ageBand: '7-9' },
    },
  });
  try {
    await waitForMcpHealth(mcpBaseUrl);
    const descriptor = await getToolDescriptor(mcpBaseUrl, 'voice_chat');
    const first = callMcp(mcpBaseUrl, payload(710));
    await delay(50);
    const second = await callMcp(mcpBaseUrl, payload(711));
    const result = parseMcpResponse(second.body).result;
    assert.equal(result.structuredContent.code, 'concurrency_limited');
    assertMatchesAdvertisedOutput(descriptor, result.structuredContent);
    await first;
  } finally {
    stopProcess(mcp);
    await closeServer(fakeAgent);
  }
});

test('mcp forwards session metadata to agent-service', async () => {
  const token = strongToken();
  const agentPort = await getFreePort();
  const mcpPort = await getFreePort();
  const mcpBaseUrl = `http://localhost:${mcpPort}`;
  let forwardedBody;

  const fakeAgent = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/voice') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        forwardedBody = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            blocked: false,
            persona: 'robot',
            text: 'Forwarding check ready.',
          }),
        );
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await listen(fakeAgent, agentPort);

  const mcp = spawnProcess(mcpEntry, {
    AGENT_PORT: String(agentPort),
    AGENT_SERVICE_TOKEN: token,
    FALLBACK_WIDGET: '0',
    MCP_PORT: String(mcpPort),
  });

  try {
    await waitForMcpHealth(mcpBaseUrl);

    const response = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 105,
      method: 'tools/call',
      params: {
        name: 'voice_chat',
        arguments: {
          text: 'Tell me a moon fact',
          persona: 'robot',
          ageBand: '4-6',
          profileId: 'local-default',
          sessionId: 'kb_session_forward123',
        },
      },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(
      {
        ageBand: forwardedBody.ageBand,
        profileId: forwardedBody.profileId,
        sessionId: forwardedBody.sessionId,
      },
      {
        ageBand: '4-6',
        profileId: 'local-default',
        sessionId: 'kb_session_forward123',
      },
    );
  } finally {
    stopProcess(mcp);
    await closeServer(fakeAgent);
  }
});

test('mcp strips parent token and saves metadata history with valid parent auth', async (t) => {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl || !(await redisAvailable(redisUrl))) {
    t.skip('Redis is not available');
    return;
  }

  const token = strongToken();
  const agentPort = await getFreePort();
  const mcpPort = await getFreePort();
  const mcpBaseUrl = `http://localhost:${mcpPort}`;
  const sessionId = `kb_session_history${Date.now()}`;
  let forwardedBody;

  const fakeAgent = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/voice') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        forwardedBody = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            blocked: false,
            correlationId: 'kb_agent_history123',
            persona: 'robot',
            text: 'History check ready.',
          }),
        );
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await listen(fakeAgent, agentPort);

  const mcp = spawnProcess(mcpEntry, {
    AGENT_PORT: String(agentPort),
    AGENT_SERVICE_TOKEN: token,
    FALLBACK_WIDGET: '0',
    MCP_PORT: String(mcpPort),
    PARENT_AUTH_SECRET: 'parent-secret-abcdefghijklmnopqrstuvwxyz0123456789',
    PARENT_HISTORY_MAX_EVENTS: '5',
    PARENT_PROFILE_STORE: 'redis',
    REDIS_URL: redisUrl,
  });

  try {
    await waitForMcpHealth(mcpBaseUrl);

    const createResponse = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 106,
      method: 'tools/call',
      params: {
        name: 'parent_profile_create',
        arguments: {
          ageBand: '4-6',
          historyEnabled: true,
          sessionId,
        },
      },
    });
    assert.equal(createResponse.status, 200);
    const createJson = parseMcpResponse(createResponse.body);
    const profile = createJson.result.structuredContent;
    assert.match(profile.profileId, /^kb_profile_/);
    assert.equal(profile.parentAccessToken, undefined);
    assert.equal(JSON.stringify(createJson.result.content).includes('kb_parent_'), false);
    assert.match(createJson.result._meta.parentAccessToken, /^kb_parent_/);
    profile.parentAccessToken = createJson.result._meta.parentAccessToken;

    const otherCreateResponse = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 1061,
      method: 'tools/call',
      params: {
        name: 'parent_profile_create',
        arguments: {
          ageBand: '7-9',
          historyEnabled: true,
          sessionId: `${sessionId}other`,
        },
      },
    });
    const otherCreateJson = parseMcpResponse(otherCreateResponse.body);
    const otherProfile = otherCreateJson.result.structuredContent;
    otherProfile.parentAccessToken = otherCreateJson.result._meta.parentAccessToken;

    const wrongTokenSessionId = `${sessionId}wrong`;
    const wrongTokenResponse = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 107,
      method: 'tools/call',
      params: {
        name: 'voice_chat',
        arguments: {
          text: 'Tell me a moon fact',
          persona: 'robot',
          ageBand: '4-6',
          profileId: profile.profileId,
          sessionId: wrongTokenSessionId,
          parentAccessToken: 'bad',
        },
      },
    });
    assert.equal(wrongTokenResponse.status, 200);

    const voiceResponse = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 108,
      method: 'tools/call',
      params: {
        name: 'voice_chat',
        arguments: {
          text: 'Tell me a moon fact',
          persona: 'robot',
          ageBand: '4-6',
          profileId: profile.profileId,
          sessionId,
          parentAccessToken: profile.parentAccessToken,
        },
      },
    });

    assert.equal(voiceResponse.status, 200);
    assert.equal(forwardedBody.parentAccessToken, undefined);
    assert.equal(forwardedBody.profileId, profile.profileId);
    assert.equal(voiceResponse.body.includes(profile.parentAccessToken), false);

    const historyResponse = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 109,
      method: 'tools/call',
      params: {
        name: 'parent_history_list',
        arguments: {
          profileId: profile.profileId,
          parentAccessToken: profile.parentAccessToken,
          sessionId,
        },
      },
    });

    assert.equal(historyResponse.status, 200);
    const historyJson = parseMcpResponse(historyResponse.body);
    const events = historyJson.result.structuredContent.events;
    assert.equal(events.length, 1);
    assert.equal(events[0].tool, 'voice_chat');
    assert.equal(events[0].correlationId, 'kb_agent_history123');
    assert.equal(JSON.stringify(events).includes('moon fact'), false);
    assert.equal(JSON.stringify(events).includes(profile.parentAccessToken), false);

    const wrongTokenHistoryResponse = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 110,
      method: 'tools/call',
      params: {
        name: 'parent_history_list',
        arguments: {
          profileId: profile.profileId,
          parentAccessToken: profile.parentAccessToken,
          sessionId: wrongTokenSessionId,
        },
      },
    });
    assert.equal(wrongTokenHistoryResponse.status, 200);
    const wrongTokenHistoryJson = parseMcpResponse(wrongTokenHistoryResponse.body);
    assert.equal(wrongTokenHistoryJson.result.structuredContent.events.length, 0);

    const foreignDeleteResponse = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 111,
      method: 'tools/call',
      params: {
        name: 'parent_profile_delete',
        arguments: {
          profileId: profile.profileId,
          parentAccessToken: otherProfile.parentAccessToken,
        },
      },
    });
    assert.match(foreignDeleteResponse.body, /invalid parent access token/i);

    const deleteResponse = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 112,
      method: 'tools/call',
      params: {
        name: 'parent_profile_delete',
        arguments: {
          profileId: profile.profileId,
          parentAccessToken: profile.parentAccessToken,
        },
      },
    });
    assert.deepEqual(parseMcpResponse(deleteResponse.body).result.structuredContent, {
      deleted: true,
      profileId: profile.profileId,
    });

    const deletedTokenHistoryResponse = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 113,
      method: 'tools/call',
      params: {
        name: 'parent_history_list',
        arguments: {
          profileId: profile.profileId,
          parentAccessToken: profile.parentAccessToken,
        },
      },
    });
    assert.match(deletedTokenHistoryResponse.body, /invalid parent access token/i);
  } finally {
    stopProcess(mcp);
    await closeServer(fakeAgent);
  }
});
