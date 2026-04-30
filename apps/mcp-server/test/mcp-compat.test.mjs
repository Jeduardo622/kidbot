import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';

const serverEntry = join(process.cwd(), 'dist', 'server.js');

if (!existsSync(serverEntry)) {
  throw new Error('Missing apps/mcp-server/dist/server.js. Run `pnpm --filter mcp-server build` before compatibility test.');
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
const port = randomInt(3200, 3899);
const baseUrl = `http://localhost:${port}`;
let serverProcess;

const waitForHealth = async () => {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server likely still starting.
    }
    await delay(200);
  }
  throw new Error(`mcp-server did not become healthy on ${baseUrl}`);
};

before(async () => {
  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MCP_PORT: String(port),
      FALLBACK_WIDGET: '1',
      KIDBOT_LOCAL_DEV: '1'
    },
    stdio: 'ignore'
  });

  await waitForHealth();
});

after(() => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});

test('/mcp rejects non-compliant Accept header', async () => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    })
  });

  const body = await response.text();
  assert.equal(response.status, 406);
  assert.match(body, /Not Acceptable/i);
});

test('/mcp streamable response includes expected tool ids', async () => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    })
  });

  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /^event:\s+message/m);
  assert.match(body, /"tools":\[/);
  for (const toolId of toolIds) {
    assert.match(body, new RegExp(`"${toolId}"`));
  }
});

test('/mcp tool call returns structuredContent for widget contract', async () => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'story_panels',
        arguments: {
          theme: 'A dragon learns kindness',
          panels: 2,
          ageBand: '7-9'
        }
      }
    })
  });

  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"structuredContent":\{/);
  assert.match(body, /"blocked":false/);
  assert.match(body, /"panels":\[/);
});
