import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { createServer } from 'node:http';
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

const toolIds = ['voice_chat', 'story_panels', 'coloring_outline', 'science_sim'];

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

test('non-fallback mode with AGENT_SERVICE_TOKEN allows mcp to call agent-service', async () => {
  const token = `matrix-token-${randomInt(1000, 9999)}`;
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
  const token = `matrix-token-${randomInt(1000, 9999)}`;
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
  const token = `matrix-token-${randomInt(1000, 9999)}`;
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
