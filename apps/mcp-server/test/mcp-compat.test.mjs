import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  parentHistoryListSuccessSchema,
  parentHistoryListToolOutputSchema,
  parentHistoryListToolOutputUnion,
  registerKidbotTool,
} from '../dist/toolContracts.js';

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
  'parent_profile_delete',
  'parent_profile_update',
  'parent_history_list',
];
const toolContractExpectations = {
  voice_chat: { title: 'Voice Chat', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  story_panels: { title: 'Story Panels', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  coloring_outline: { title: 'Coloring Outline', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  science_sim: { title: 'Science Simulation', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  parent_profile_create: { title: 'Create Parent Profile', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  parent_profile_delete: { title: 'Delete Parent Profile', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  parent_profile_update: { title: 'Update Parent Profile', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  parent_history_list: { title: 'List Parent History', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};
const port = randomInt(3200, 3899);
const baseUrl = `http://localhost:${port}`;
const productionPort = randomInt(3900, 4599);
const productionBaseUrl = `http://localhost:${productionPort}`;
let serverProcess;
let productionServerProcess;
const schemaValidator = new AjvJsonSchemaValidator();

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

const getToolDescriptor = async (url, name) => {
  const response = await callMcp(url, {
    jsonrpc: '2.0',
    id: `list-${name}`,
    method: 'tools/list',
    params: {},
  });
  const descriptor = response.result.tools.find((tool) => tool.name === name);
  assert.ok(descriptor, `missing ${name} descriptor`);
  return descriptor;
};

const assertMatchesAdvertisedOutput = (descriptor, structuredContent) => {
  const result = schemaValidator.getValidator(descriptor.outputSchema)(structuredContent);
  assert.equal(result.valid, true, result.errorMessage);
};

const registerLifecycleTestTool = (server, name, title) => registerKidbotTool(
  server,
  name,
  {
    title,
    description: `${title} description`,
    inputSchema: z.object({}),
    outputSchema: parentHistoryListToolOutputSchema,
    resultSchema: parentHistoryListToolOutputUnion,
    successSchema: parentHistoryListSuccessSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => ({ content: [], structuredContent: { events: [] } }),
);

const connectInMemoryClient = async (server, name) => {
  const client = new Client({ name, version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
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

test('/mcp tools/list advertises exact Kidbot app contracts', async () => {
  const response = await callMcp(baseUrl, {
    jsonrpc: '2.0',
    id: 20,
    method: 'tools/list',
    params: {},
  });

  assert.deepEqual(
    response.result.tools.map(({ name }) => name).sort(),
    [...toolIds].sort(),
  );

  for (const [toolId, expected] of Object.entries(toolContractExpectations)) {
    const tool = response.result.tools.find(({ name }) => name === toolId);
    assert.ok(tool, `missing ${toolId}`);
    assert.equal(tool.title, expected.title);
    assert.equal(tool.outputSchema?.type, 'object');
    assert.equal(tool.outputSchema?.anyOf?.length, 4);
    assert.equal(schemaValidator.getValidator(tool.outputSchema)({ blocked: false }).valid, false);
    assert.deepEqual(tool.securitySchemes, [{ type: 'noauth' }]);
    assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
    assert.equal(tool._meta.ui.resourceUri, 'ui://widget/kidbot-v2.html');
    assert.deepEqual(tool._meta.ui.visibility, ['model', 'app']);
    assert.equal(tool._meta['ui/resourceUri'], 'ui://widget/kidbot-v2.html');
    assert.equal(tool._meta['openai/outputTemplate'], 'ui://widget/kidbot-v2.html');
    assert.equal(tool._meta['openai/widgetAccessible'], true);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: expected.readOnlyHint,
      destructiveHint: expected.destructiveHint,
      openWorldHint: expected.openWorldHint,
    });
  }
});

test('registerKidbotTool isolates descriptor registries across server instances', async (t) => {
  const firstServer = new McpServer({ name: 'first-server', version: '1.0.0' });
  const secondServer = new McpServer({ name: 'second-server', version: '1.0.0' });
  registerLifecycleTestTool(firstServer, 'first_tool', 'First Tool');
  registerLifecycleTestTool(secondServer, 'second_tool', 'Second Tool');
  const firstClient = await connectInMemoryClient(firstServer, 'first-client');
  const secondClient = await connectInMemoryClient(secondServer, 'second-client');
  t.after(async () => {
    await Promise.all([firstClient.close(), secondClient.close(), firstServer.close(), secondServer.close()]);
  });

  assert.deepEqual((await firstClient.listTools()).tools.map(({ name }) => name), ['first_tool']);
  assert.deepEqual((await secondClient.listTools()).tools.map(({ name }) => name), ['second_tool']);
});

test('registerKidbotTool rejects contract-bearing updates without changing list or call', async (t) => {
  const server = new McpServer({ name: 'lifecycle-server', version: '1.0.0' });
  const registered = registerLifecycleTestTool(server, 'lifecycle_tool', 'Lifecycle Tool');
  assert.throws(
    () => registerLifecycleTestTool(server, 'lifecycle_tool', 'Duplicate Tool'),
    /already registered/i,
  );
  const client = await connectInMemoryClient(server, 'lifecycle-client');
  t.after(async () => {
    await Promise.all([client.close(), server.close()]);
  });

  const baselineList = await client.listTools();
  const baselineCall = await client.callTool({ name: 'lifecycle_tool', arguments: {} });
  const forbiddenUpdates = [
    { name: 'renamed_tool' },
    { outputSchema: { value: z.string() } },
    { _meta: { unsafe: true } },
    { annotations: { readOnlyHint: false } },
    { paramsSchema: { value: z.string() } },
  ];
  for (const updates of forbiddenUpdates) {
    assert.throws(() => registered.update(updates), /contract-bearing update/i);
    assert.deepEqual(await client.listTools(), baselineList);
    assert.deepEqual(
      await client.callTool({ name: 'lifecycle_tool', arguments: {} }),
      baselineCall,
    );
  }
});

test('registerKidbotTool rejects repeated renames without creating callable aliases', async (t) => {
  const server = new McpServer({ name: 'rename-server', version: '1.0.0' });
  const registered = registerLifecycleTestTool(server, 'stable_tool', 'Stable Tool');
  const client = await connectInMemoryClient(server, 'rename-client');
  t.after(async () => {
    await Promise.all([client.close(), server.close()]);
  });

  assert.throws(() => registered.update({ name: 'first_alias' }), /contract-bearing update/i);
  assert.throws(() => registered.update({ name: 'second_alias' }), /contract-bearing update/i);
  assert.deepEqual((await client.listTools()).tools.map(({ name }) => name), ['stable_tool']);
  assert.equal((await client.callTool({ name: 'stable_tool', arguments: {} })).isError, undefined);
  assert.equal((await client.callTool({ name: 'first_alias', arguments: {} })).isError, true);
  assert.equal((await client.callTool({ name: 'second_alias', arguments: {} })).isError, true);
});

test('registerKidbotTool synchronizes allowed updates and remove lifecycle', async (t) => {
  const server = new McpServer({ name: 'allowed-update-server', version: '1.0.0' });
  const registered = registerLifecycleTestTool(server, 'allowed_tool', 'Allowed Tool');
  const client = await connectInMemoryClient(server, 'allowed-update-client');
  t.after(async () => {
    await Promise.all([client.close(), server.close()]);
  });

  registered.update({
    title: 'Updated Tool',
    description: 'Updated description',
    callback: async () => ({
      content: [{ type: 'text', text: 'Updated callback.' }],
      structuredContent: { events: [] },
    }),
  });
  const [updated] = (await client.listTools()).tools;
  assert.equal(updated.title, 'Updated Tool');
  assert.equal(updated.description, 'Updated description');
  assert.equal(
    (await client.callTool({ name: 'allowed_tool', arguments: {} })).content[0].text,
    'Updated callback.',
  );

  registered.disable();
  assert.deepEqual((await client.listTools()).tools, []);
  registered.enable();
  assert.deepEqual((await client.listTools()).tools.map(({ name }) => name), ['allowed_tool']);

  registered.remove();
  assert.deepEqual((await client.listTools()).tools, []);
});

test('registerKidbotTool uses only the public tools/list handler API', () => {
  const implementation = readFileSync(join(process.cwd(), 'dist', 'toolContracts.js'), 'utf8');
  assert.doesNotMatch(implementation, /_requestHandlers/);
});

test('/mcp tool call returns structuredContent for widget contract', async () => {
  const descriptor = await getToolDescriptor(baseUrl, 'story_panels');
  const response = await callMcp(baseUrl, {
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
  });

  assert.equal(response.result.structuredContent.blocked, false);
  assert.ok(Array.isArray(response.result.structuredContent.panels));
  assertMatchesAdvertisedOutput(descriptor, response.result.structuredContent);
});

test('/mcp moderation block matches the advertised output contract', async () => {
  const descriptor = await getToolDescriptor(baseUrl, 'voice_chat');
  const response = await callMcp(baseUrl, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'voice_chat',
      arguments: { text: 'Tell me about a weapon', persona: 'robot', ageBand: '7-9' },
    },
  });

  assert.equal(response.result.structuredContent.blocked, true);
  assertMatchesAdvertisedOutput(descriptor, response.result.structuredContent);
});
