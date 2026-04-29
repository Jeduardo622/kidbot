import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

const mcpEntry = join(process.cwd(), 'dist', 'server.js');
const agentEntry = join(process.cwd(), '../agent-service/dist/index.js');

if (!existsSync(mcpEntry)) {
  throw new Error('Missing apps/mcp-server/dist/server.js. Run `pnpm --filter mcp-server build` before startup matrix test.');
}

if (!existsSync(agentEntry)) {
  throw new Error('Missing apps/agent-service/dist/index.js. Run `pnpm --filter agent-service build` before startup matrix test.');
}

const toolIds = ['voice_chat', 'story_panels', 'coloring_outline', 'science_sim'];

const spawnProcess = (entry, env) =>
  spawn(process.execPath, [entry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
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

const waitForAgentVoice = async (baseUrl, token, postureHeader = 'secured') => {
  let lastStatus = null;
  let lastBody = '';
  for (let i = 0; i < 40; i += 1) {
    try {
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
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
          ageBand: '7-9'
        })
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

  throw new Error(`agent-service did not become ready on ${baseUrl}; lastStatus=${lastStatus}; lastBody=${lastBody}`);
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
      })
    ),
    delay(timeoutMs).then(() => ({ code: null, signal: 'timeout' }))
  ]);

const callMcp = async (baseUrl, payload) => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return {
    status: response.status,
    body: await response.text()
  };
};

test('non-fallback mode without AGENT_SERVICE_TOKEN fails closed at mcp startup', async () => {
  const mcpPort = randomInt(4200, 4699);
  const mcp = spawnProcess(mcpEntry, {
    FALLBACK_WIDGET: '0',
    MCP_PORT: String(mcpPort)
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
  const agentPort = randomInt(4700, 5199);
  const mcpPort = randomInt(5200, 5699);
  const agentBaseUrl = `http://localhost:${agentPort}`;
  const mcpBaseUrl = `http://localhost:${mcpPort}`;

  const agent = spawnProcess(agentEntry, {
    AGENT_SERVICE_TOKEN: token,
    FALLBACK_WIDGET: '0',
    OPENAI_API_KEY: '',
    PORT: String(agentPort)
  });

  const mcp = spawnProcess(mcpEntry, {
    AGENT_PORT: String(agentPort),
    AGENT_SERVICE_TOKEN: token,
    FALLBACK_WIDGET: '0',
    MCP_PORT: String(mcpPort)
  });

  try {
    await waitForAgentVoice(agentBaseUrl, token);
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
          ageBand: '7-9'
        }
      }
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
  const mcpPort = randomInt(5700, 6199);
  const mcpBaseUrl = `http://localhost:${mcpPort}`;
  const mcp = spawnProcess(mcpEntry, {
    FALLBACK_WIDGET: '1',
    KIDBOT_LOCAL_DEV: '1',
    MCP_PORT: String(mcpPort)
  });

  try {
    await waitForMcpHealth(mcpBaseUrl);

    const response = await callMcp(mcpBaseUrl, {
      jsonrpc: '2.0',
      id: 102,
      method: 'tools/list',
      params: {}
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
  const mcpPort = randomInt(6200, 6699);
  const mcp = spawnProcess(mcpEntry, {
    FALLBACK_WIDGET: '1',
    MCP_PORT: String(mcpPort)
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
  const agentPort = randomInt(6700, 7199);
  const mcpPort = randomInt(7200, 7699);
  const agentBaseUrl = `http://localhost:${agentPort}`;
  const mcpBaseUrl = `http://localhost:${mcpPort}`;

  const agent = spawnProcess(agentEntry, {
    FALLBACK_WIDGET: '1',
    KIDBOT_LOCAL_DEV: '1',
    OPENAI_API_KEY: '',
    PORT: String(agentPort)
  });

  const mcp = spawnProcess(mcpEntry, {
    AGENT_PORT: String(agentPort),
    AGENT_SERVICE_TOKEN: token,
    FALLBACK_WIDGET: '0',
    MCP_PORT: String(mcpPort)
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
          ageBand: '7-9'
        }
      }
    });

    assert.equal(response.status, 200);
    assert.match(response.body, /status 409/i);
  } finally {
    stopProcess(mcp);
    stopProcess(agent);
  }
});
