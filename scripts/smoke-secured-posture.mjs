import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';

const rootDir = process.cwd();
const agentEntry = join(rootDir, 'apps', 'agent-service', 'dist', 'index.js');
const mcpEntry = join(rootDir, 'apps', 'mcp-server', 'dist', 'server.js');

if (!existsSync(agentEntry)) {
  throw new Error('Missing apps/agent-service/dist/index.js. Run the agent-service build first.');
}

if (!existsSync(mcpEntry)) {
  throw new Error('Missing apps/mcp-server/dist/server.js. Run the MCP server build first.');
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

const waitForHealth = async (baseUrl, name, diagnostics) => {
  let lastStatus = null;
  let lastBody = '';
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      lastStatus = response.status;
      lastBody = await response.text();
      if (response.ok) {
        return;
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

const callMcpVoice = async (baseUrl) => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 201,
      method: 'tools/call',
      params: {
        name: 'voice_chat',
        arguments: {
          text: 'Tell me a moon fact',
          persona: 'robot',
          ageBand: '7-9',
        },
      },
    }),
  });

  return {
    status: response.status,
    body: await response.text(),
  };
};

const callAgentVoice = async (baseUrl, headers = {}) =>
  fetch(`${baseUrl}/voice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      text: 'Tell me a moon fact',
      persona: 'robot',
      ageBand: '7-9',
    }),
  });

const token = `kidbot-smoke-${randomBytes(32).toString('base64url')}`;
const agentPort = await getFreePort();
const mcpPort = await getFreePort();
const wrongTokenMcpPort = await getFreePort();
const agentBaseUrl = `http://127.0.0.1:${agentPort}`;
const mcpBaseUrl = `http://127.0.0.1:${mcpPort}`;
const wrongTokenMcpBaseUrl = `http://127.0.0.1:${wrongTokenMcpPort}`;

const agent = spawnService(agentEntry, {
  AGENT_SERVICE_TOKEN: token,
  FALLBACK_WIDGET: '0',
  KIDBOT_LOCAL_DEV: '0',
  NODE_ENV: 'production',
  OPENAI_API_KEY: '',
  PORT: String(agentPort),
  RATE_LIMIT_STORE: 'memory',
});
const mcp = spawnService(mcpEntry, {
  AGENT_PORT: String(agentPort),
  AGENT_SERVICE_TOKEN: token,
  FALLBACK_WIDGET: '0',
  KIDBOT_LOCAL_DEV: '0',
  MCP_PORT: String(mcpPort),
  NODE_ENV: 'production',
});
const wrongTokenMcp = spawnService(mcpEntry, {
  AGENT_PORT: String(agentPort),
  AGENT_SERVICE_TOKEN: `${token}-wrong`,
  FALLBACK_WIDGET: '0',
  KIDBOT_LOCAL_DEV: '0',
  MCP_PORT: String(wrongTokenMcpPort),
  NODE_ENV: 'production',
});

try {
  await waitForHealth(agentBaseUrl, 'agent-service', agent.diagnostics);
  await waitForHealth(mcpBaseUrl, 'mcp-server', mcp.diagnostics);
  await waitForHealth(wrongTokenMcpBaseUrl, 'wrong-token mcp-server', wrongTokenMcp.diagnostics);

  const mcpResponse = await callMcpVoice(mcpBaseUrl);
  assert.equal(mcpResponse.status, 200);
  assert.match(mcpResponse.body, /"blocked":false/);
  assert.match(mcpResponse.body, /reply ready/i);

  const unauthenticated = await callAgentVoice(agentBaseUrl, {
    'x-kidbot-startup-posture': 'secured',
  });
  assert.equal(unauthenticated.status, 401);

  const wrongPosture = await callAgentVoice(agentBaseUrl, {
    Authorization: `Bearer ${token}`,
    'x-kidbot-startup-posture': 'local-fallback',
  });
  assert.equal(wrongPosture.status, 409);

  const wrongToken = await callAgentVoice(agentBaseUrl, {
    Authorization: `Bearer ${token}-wrong`,
    'x-kidbot-startup-posture': 'secured',
  });
  assert.equal(wrongToken.status, 401);

  const wrongTokenMcpResponse = await callMcpVoice(wrongTokenMcpBaseUrl);
  assert.equal(wrongTokenMcpResponse.status, 200);
  assert.match(wrongTokenMcpResponse.body, /status 401/i);

  console.log('Secured posture smoke passed.');
} finally {
  await stopService(wrongTokenMcp);
  await stopService(mcp);
  await stopService(agent);
}
