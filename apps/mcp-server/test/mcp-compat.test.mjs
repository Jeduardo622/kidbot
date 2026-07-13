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
const productionPort = randomInt(3900, 4599);
const productionBaseUrl = `http://localhost:${productionPort}`;
let serverProcess;
let productionServerProcess;

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

const waitForServer = async (url) => {
  for (let i = 0; i < 30; i += 1) {
    try {
      const response = await fetch(`${url}/diag`);
      if (response.ok) return;
    } catch {
      // Server likely still starting.
    }
    await delay(200);
  }
  throw new Error(`mcp-server did not start on ${url}`);
};

const callMcp = async (url, payload) => {
  const response = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify(payload)
  });
  const body = await response.text();
  const dataLine = body.split(/\r?\n/).find((line) => line.startsWith('data:'));
  assert.equal(response.status, 200, body);
  assert.ok(dataLine, body);
  return JSON.parse(dataLine.slice('data:'.length).trim());
};

const assertWidgetResourceContract = (resource) => {
  const resourceOrigin = 'https://rxnwualzddplucjhclij.supabase.co';
  assert.equal(resource.uri, 'ui://widget/kidbot-v2.html');
  assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
  assert.equal(resource._meta.ui.domain, 'https://kidbot-production.up.railway.app');
  assert.equal(resource._meta['openai/widgetDomain'], resource._meta.ui.domain);
  assert.deepEqual(resource._meta.ui.csp.connectDomains, []);
  assert.deepEqual(resource._meta['openai/widgetCSP'].connect_domains, []);
  assert.deepEqual(
    resource._meta.ui.csp.resourceDomains,
    resource._meta['openai/widgetCSP'].resource_domains,
  );
  assert.deepEqual(resource._meta.ui.csp.resourceDomains, [resourceOrigin]);
  assert.equal(resource._meta.ui.csp.resourceDomains.filter((origin) => origin === resourceOrigin).length, 1);
};

before(async () => {
  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MCP_PORT: String(port),
      FALLBACK_WIDGET: '1',
      KIDBOT_LOCAL_DEV: '1',
      MCP_REQUEST_CONTROL_STORE: 'memory',
      NODE_ENV: 'test'
    },
    stdio: 'ignore'
  });

  productionServerProcess = spawn(process.execPath, [serverEntry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AGENT_SERVICE_TOKEN: 'a'.repeat(32),
      FALLBACK_WIDGET: '0',
      KIDBOT_LOCAL_DEV: '0',
      KIDBOT_WIDGET_DOMAIN: 'https://kidbot-production.up.railway.app',
      KIDBOT_WIDGET_RESOURCE_DOMAINS: 'https://rxnwualzddplucjhclij.supabase.co',
      MCP_PORT: String(productionPort),
      MCP_REQUEST_CONTROL_STORE: 'redis',
      NODE_ENV: 'production',
      PARENT_PROFILE_STORE: 'disabled',
      REDIS_URL: 'redis://127.0.0.1:1'
    },
    stdio: 'ignore'
  });

  await Promise.all([waitForHealth(), waitForServer(productionBaseUrl)]);
});

after(() => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
  if (productionServerProcess && !productionServerProcess.killed) {
    productionServerProcess.kill();
  }
});

test('/mcp resources/list returns the current widget resource metadata', async () => {
  const response = await callMcp(productionBaseUrl, {
    jsonrpc: '2.0',
    id: 10,
    method: 'resources/list',
    params: {}
  });
  const resource = response.result.resources.find(({ uri }) => uri.startsWith('ui://widget/'));

  assert.ok(resource);
  assertWidgetResourceContract(resource);
});

test('/mcp resources/read returns the current widget resource metadata', async () => {
  const response = await callMcp(productionBaseUrl, {
    jsonrpc: '2.0',
    id: 11,
    method: 'resources/read',
    params: { uri: 'ui://widget/kidbot-v2.html' }
  });
  const [resource] = response.result.contents;

  assertWidgetResourceContract(resource);
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
