import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';

const rootDir = process.cwd();
const mode = process.argv[2];
const agentEntry = join(rootDir, 'apps', 'agent-service', 'dist', 'index.js');
const mcpEntry = join(rootDir, 'apps', 'mcp-server', 'dist', 'server.js');
const forbiddenHistoryFragments = [
  'moon fact',
  'Tell me',
  'kb_parent_',
  'short-parent-secret-for-smoke',
  'PIN',
  'service-token',
];
const allowedHistoryKeys = new Set([
  'id',
  'timestamp',
  'tool',
  'sessionId',
  'profileId',
  'ageBand',
  'status',
  'blocked',
  'degraded',
  'providerFallback',
  'fallbackReason',
  'correlationId',
  'inputLength',
  'outputLength',
]);

if (mode !== 'local' && mode !== 'remote') {
  throw new Error('Usage: node scripts/smoke-parent-store.mjs <local|remote>');
}

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

const spawnService = (entry, env) => {
  const child = spawn(process.execPath, [entry], {
    cwd: rootDir,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  return {
    child,
    diagnostics: () => `stdout=${stdout.slice(-500)}; stderr=${stderr.slice(-500)}`,
    stderr: () => stderr,
  };
};

const stopService = async (service) => {
  if (!service?.child || service.child.killed) {
    return;
  }
  service.child.kill();
  await Promise.race([
    new Promise((resolve) => service.child.once('exit', resolve)),
    delay(1500),
  ]);
};

const readExit = async (service, timeoutMs = 3500) =>
  Promise.race([
    new Promise((resolve) => {
      service.child.once('exit', (code, signal) => {
        resolve({ code, signal });
      });
    }),
    delay(timeoutMs).then(() => ({ code: null, signal: 'timeout' })),
  ]);

const assertBuiltEntries = () => {
  if (!existsSync(agentEntry)) {
    throw new Error('Missing apps/agent-service/dist/index.js. Run the agent-service build first.');
  }
  if (!existsSync(mcpEntry)) {
    throw new Error('Missing apps/mcp-server/dist/server.js. Run the MCP server build first.');
  }
};

const redisReachable = (redisUrl) =>
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
      socket.setTimeout(800);
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.once('timeout', () => done(false));
    } catch {
      resolve(false);
    }
  });

const waitForHealth = async (baseUrl, name, diagnostics = () => '') => {
  let lastStatus = null;
  let lastBody = '';
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      lastStatus = response.status;
      lastBody = await response.text();
      if (response.ok) {
        return JSON.parse(lastBody);
      }
    } catch {
      // Service may still be starting.
    }
    await delay(150);
  }

  throw new Error(
    `${name} did not become healthy on ${baseUrl}; lastStatus=${lastStatus}; lastBody=${lastBody}; ${diagnostics()}`,
  );
};

const normalizeBaseUrl = (value) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error('KIDBOT_REMOTE_MCP_URL is required for remote parent store smoke.');
  }
  return trimmed.replace(/\/mcp\/?$/, '').replace(/\/$/, '');
};

const callMcp = async (baseUrl, id, name, args) => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    }),
  });

  const body = await response.text();
  return {
    body,
    parsed: parseMcpResponse(body),
    status: response.status,
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

const assertMcpOk = (response, label) => {
  assert.equal(response.status, 200, `${label} HTTP status`);
  if (response.parsed.error) {
    throw new Error(`${label} returned MCP error: ${response.parsed.error.message}`);
  }
  return response.parsed.result?.structuredContent;
};

const assertMcpError = (response, label, pattern) => {
  assert.equal(response.status, 200, `${label} HTTP status`);
  if (response.parsed.error) {
    assert.match(response.parsed.error.message, pattern);
    return;
  }
  const result = response.parsed.result;
  assert.equal(result?.isError, true, `${label} should return an MCP tool error`);
  assert.match(JSON.stringify(result), pattern);
};

const assertRedisParentHealth = (health) => {
  assert.equal(health.ok, true);
  assert.equal(health.parentProfileStore?.mode, 'redis');
  assert.equal(health.parentProfileStore?.ready, true);
  assert.equal(JSON.stringify(health).includes('PARENT_AUTH_SECRET'), false);
  assert.equal(JSON.stringify(health).includes('kb_parent_'), false);
};

const assertHistoryIsMetadataOnly = (events, secretFragments) => {
  assert.ok(Array.isArray(events), 'history events must be an array');
  assert.ok(events.length >= 1, 'expected at least one saved history event');
  const serialized = JSON.stringify(events);
  for (const fragment of forbiddenHistoryFragments) {
    assert.equal(serialized.includes(fragment), false, `history leaked forbidden fragment: ${fragment}`);
  }
  for (const fragment of secretFragments) {
    assert.equal(serialized.includes(fragment), false, 'history leaked a secret fragment');
  }

  for (const event of events) {
    for (const key of Object.keys(event)) {
      assert.ok(allowedHistoryKeys.has(key), `history event contains unexpected key: ${key}`);
    }
    assert.match(event.id, /^kb_event_/);
    assert.match(event.sessionId, /^kb_session_/);
    assert.match(event.profileId, /^kb_profile_/);
    assert.match(event.tool, /^(voice_chat|story_panels|coloring_outline|science_sim)$/);
    assert.ok(['4-6', '7-9', '10-12'].includes(event.ageBand));
    assert.ok(['ok', 'blocked', 'degraded', 'error'].includes(event.status));
    assert.equal(typeof event.inputLength, 'number');
    assert.equal(typeof event.outputLength, 'number');
  }
};

const assertChildResultAcceptable = (structuredContent) => {
  assert.ok(structuredContent, 'child call must return structured content');
  assert.notEqual(structuredContent.blocked, true, 'child call must not be treated as a safety block');
  if (structuredContent.degraded === true) {
    assert.match(structuredContent.message ?? '', /idea engine|temporarily|try again/i);
    return;
  }
  assert.equal(structuredContent.blocked, false);
};

const runParentFlow = async (baseUrl) => {
  const suffix = randomBytes(8).toString('hex');
  const sessionId = `kb_session_smoke${suffix}`;
  const wrongTokenSessionId = `kb_session_wrong${suffix}`;
  const create = await callMcp(baseUrl, 301, 'parent_profile_create', {
    ageBand: '7-9',
    sessionId,
  });
  const profile = assertMcpOk(create, 'parent_profile_create');
  assert.match(profile.profileId, /^kb_profile_/);
  assert.match(profile.parentAccessToken, /^kb_parent_/);
  assert.equal(profile.historyEnabled, true);

  const update = await callMcp(baseUrl, 302, 'parent_profile_update', {
    profileId: profile.profileId,
    parentAccessToken: profile.parentAccessToken,
    ageBand: '10-12',
    historyEnabled: true,
  });
  const updatedProfile = assertMcpOk(update, 'parent_profile_update');
  assert.equal(updatedProfile.ageBand, '10-12');
  assert.equal(updatedProfile.historyEnabled, true);

  const child = await callMcp(baseUrl, 303, 'voice_chat', {
    text: 'Tell me a moon fact',
    persona: 'robot',
    ageBand: '10-12',
    profileId: profile.profileId,
    sessionId,
    parentAccessToken: profile.parentAccessToken,
  });
  const childContent = assertMcpOk(child, 'voice_chat');
  assertChildResultAcceptable(childContent);

  const history = await callMcp(baseUrl, 304, 'parent_history_list', {
    profileId: profile.profileId,
    parentAccessToken: profile.parentAccessToken,
    sessionId,
    limit: 20,
  });
  const historyContent = assertMcpOk(history, 'parent_history_list');
  const initialEvents = historyContent.events ?? [];
  assertHistoryIsMetadataOnly(initialEvents, [profile.parentAccessToken]);

  const wrongParentToken = `kb_parent_wrong${randomBytes(24).toString('base64url')}`;
  const wrongChild = await callMcp(baseUrl, 305, 'voice_chat', {
    text: 'Tell me a moon fact',
    persona: 'robot',
    ageBand: '10-12',
    profileId: profile.profileId,
    sessionId: wrongTokenSessionId,
    parentAccessToken: wrongParentToken,
  });
  const wrongChildContent = assertMcpOk(wrongChild, 'voice_chat with wrong parent token');
  assertChildResultAcceptable(wrongChildContent);

  const wrongTokenHistory = await callMcp(baseUrl, 306, 'parent_history_list', {
    profileId: profile.profileId,
    parentAccessToken: profile.parentAccessToken,
    sessionId: wrongTokenSessionId,
    limit: 20,
  });
  const wrongTokenHistoryContent = assertMcpOk(wrongTokenHistory, 'parent_history_list after wrong token child');
  assert.equal(wrongTokenHistoryContent.events?.length ?? 0, 0);

  const unauthorizedHistory = await callMcp(baseUrl, 307, 'parent_history_list', {
    profileId: profile.profileId,
    parentAccessToken: wrongParentToken,
    sessionId,
    limit: 20,
  });
  assertMcpError(unauthorizedHistory, 'parent_history_list with wrong token', /invalid parent access token/i);

  return {
    events: initialEvents.length,
    profileId: profile.profileId,
  };
};

const assertParentSecretStartupFailures = async (redisUrl) => {
  const missingSecretPort = await getFreePort();
  const missingSecretMcp = spawnService(mcpEntry, {
    AGENT_SERVICE_TOKEN: `kidbot-service-${randomBytes(32).toString('base64url')}`,
    FALLBACK_WIDGET: '0',
    KIDBOT_LOCAL_DEV: '0',
    MCP_PORT: String(missingSecretPort),
    NODE_ENV: 'production',
    PARENT_PROFILE_STORE: 'redis',
    REDIS_URL: redisUrl,
  });

  try {
    const exit = await readExit(missingSecretMcp);
    assert.notEqual(exit.code, 0);
    assert.match(missingSecretMcp.stderr(), /PARENT_AUTH_SECRET is required/i);
  } finally {
    await stopService(missingSecretMcp);
  }

  const shortSecret = 'short-parent-secret-for-smoke';
  const shortSecretPort = await getFreePort();
  const shortSecretMcp = spawnService(mcpEntry, {
    AGENT_SERVICE_TOKEN: `kidbot-service-${randomBytes(32).toString('base64url')}`,
    FALLBACK_WIDGET: '0',
    KIDBOT_LOCAL_DEV: '0',
    MCP_PORT: String(shortSecretPort),
    NODE_ENV: 'production',
    PARENT_AUTH_SECRET: shortSecret,
    PARENT_PROFILE_STORE: 'redis',
    REDIS_URL: redisUrl,
  });

  try {
    const exit = await readExit(shortSecretMcp);
    assert.notEqual(exit.code, 0);
    assert.match(shortSecretMcp.stderr(), /at least 32 characters/i);
    assert.equal(shortSecretMcp.stderr().includes(shortSecret), false);
  } finally {
    await stopService(shortSecretMcp);
  }
};

const runLocal = async () => {
  assertBuiltEntries();
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for local parent store Redis smoke.');
  }
  if (!(await redisReachable(redisUrl))) {
    throw new Error(`Redis is not reachable at REDIS_URL=${redisUrl}`);
  }

  await assertParentSecretStartupFailures(redisUrl);

  const serviceToken = `kidbot-service-${randomBytes(32).toString('base64url')}`;
  const parentSecret = `kidbot-parent-secret-${randomBytes(48).toString('base64url')}`;
  const agentPort = await getFreePort();
  const mcpPort = await getFreePort();
  const agentBaseUrl = `http://127.0.0.1:${agentPort}`;
  const mcpBaseUrl = `http://127.0.0.1:${mcpPort}`;
  const agent = spawnService(agentEntry, {
    AGENT_SERVICE_TOKEN: serviceToken,
    FALLBACK_WIDGET: '0',
    KIDBOT_LOCAL_DEV: '0',
    NODE_ENV: 'production',
    OPENAI_API_KEY: '',
    PORT: String(agentPort),
    PROVIDER_FAILURE_POLICY: '503',
    RATE_LIMIT_STORE: 'memory',
  });
  const mcp = spawnService(mcpEntry, {
    AGENT_PORT: String(agentPort),
    AGENT_SERVICE_TOKEN: serviceToken,
    FALLBACK_WIDGET: '0',
    KIDBOT_LOCAL_DEV: '0',
    MCP_PORT: String(mcpPort),
    NODE_ENV: 'production',
    PARENT_AUTH_SECRET: parentSecret,
    PARENT_HISTORY_MAX_EVENTS: '20',
    PARENT_PROFILE_STORE: 'redis',
    REDIS_URL: redisUrl,
  });

  try {
    await waitForHealth(agentBaseUrl, 'agent-service', agent.diagnostics);
    const health = await waitForHealth(mcpBaseUrl, 'mcp-server', mcp.diagnostics);
    assertRedisParentHealth(health);
    await runParentFlow(mcpBaseUrl);
    console.log('Parent store Redis smoke passed.');
  } finally {
    await stopService(mcp);
    await stopService(agent);
  }
};

const runRemote = async () => {
  const mcpBaseUrl = normalizeBaseUrl(process.env.KIDBOT_REMOTE_MCP_URL);
  const response = await fetch(`${mcpBaseUrl}/healthz`);
  const healthText = await response.text();
  assert.equal(response.status, 200, `remote /healthz status; body=${healthText}`);
  const health = JSON.parse(healthText);
  assertRedisParentHealth(health);
  await runParentFlow(mcpBaseUrl);
  console.log('Remote parent store smoke passed.');
};

if (mode === 'local') {
  await runLocal();
} else {
  await runRemote();
}
