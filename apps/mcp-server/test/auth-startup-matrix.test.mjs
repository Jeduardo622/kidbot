import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

const mcpEntry = join(process.cwd(), 'dist', 'server.js');
const agentEntry = join(process.cwd(), '../agent-service/dist/index.js');

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
  'parent_history_list',
];
const strongToken = () => `matrix-token-${randomInt(1000, 9999)}-abcdefghijklmnopqrstuvwxyz0123456789`;

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
      ...process.env,
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

const callMcp = async (baseUrl, payload) => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
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
    AGENT_SERVICE_TOKEN: 'short-token-secret',
    FALLBACK_WIDGET: '0',
    MCP_PORT: String(mcpPort),
    NODE_ENV: 'production',
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
          sessionId,
        },
      },
    });
    assert.equal(createResponse.status, 200);
    const createJson = parseMcpResponse(createResponse.body);
    const profile = createJson.result.structuredContent;
    assert.match(profile.profileId, /^kb_profile_/);
    assert.match(profile.parentAccessToken, /^kb_parent_/);

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
  } finally {
    stopProcess(mcp);
    await closeServer(fakeAgent);
  }
});
