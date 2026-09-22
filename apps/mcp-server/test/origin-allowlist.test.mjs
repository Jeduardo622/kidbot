import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const configEntry = join(packageDir, 'dist', 'config.js');

if (!existsSync(configEntry)) {
  throw new Error('Missing apps/mcp-server/dist/config.js. Run `pnpm --filter mcp-server build` first.');
}

const configEnvNames = [
  'AGENT_BASE_URL',
  'AGENT_PORT',
  'AGENT_SERVICE_TOKEN',
  'FALLBACK_WIDGET',
  'KIDBOT_LOCAL_DEV',
  'KIDBOT_MCP_ALLOWED_ORIGINS',
  'KIDBOT_WIDGET_DOMAIN',
  'KIDBOT_WIDGET_RESOURCE_DOMAINS',
  'MCP_PORT',
  'MCP_REQUEST_CONTROL_STORE',
  'NODE_ENV',
  'PARENT_AUTH_SECRET',
  'PARENT_PROFILE_STORE',
];
const originalEnv = new Map(configEnvNames.map((name) => [name, process.env[name]]));
for (const name of configEnvNames) delete process.env[name];
// config.js parses the ambient environment on import; give it a valid local
// posture so importing the module never depends on the developer's shell.
Object.assign(process.env, { FALLBACK_WIDGET: '1', KIDBOT_LOCAL_DEV: '1' });

let parseMcpServerConfig;
try {
  ({ parseMcpServerConfig } = await import('../dist/config.js'));
} finally {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
const { chatGptOrigins, createOriginGuard, isOriginAllowed } = await import('../dist/originGuard.js');

const productionEnv = {
  AGENT_SERVICE_TOKEN: 'service-token-abcdefghijklmnopqrstuvwxyz0123456789',
  FALLBACK_WIDGET: '0',
  KIDBOT_WIDGET_DOMAIN: 'https://kidbot-mcp-server-production.up.railway.app',
  KIDBOT_WIDGET_RESOURCE_DOMAINS: 'https://example.supabase.co',
  MCP_REQUEST_CONTROL_STORE: 'redis',
  NODE_ENV: 'production',
  PARENT_PROFILE_STORE: 'disabled',
};

const guardCall = (guard, { origin, method = 'POST' } = {}) => {
  const headers = {};
  let status;
  let body;
  let nextCalled = false;
  const res = {
    vary() { headers.vary = 'Origin'; return res; },
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    status(code) { status = code; return res; },
    json(payload) { body = payload; return res; },
  };
  guard({ method, headers: origin ? { origin } : {} }, res, () => { nextCalled = true; });
  return { headers, status, body, nextCalled };
};

test('production bounds browser origins even when the operator configures none', () => {
  const config = parseMcpServerConfig({ ...productionEnv });

  assert.deepEqual(
    config.allowedOrigins,
    [...chatGptOrigins, 'https://kidbot-mcp-server-production.up.railway.app'],
  );
});

test('an explicit allowlist replaces the defaults and rejects loose entries', () => {
  const config = parseMcpServerConfig({
    ...productionEnv,
    KIDBOT_MCP_ALLOWED_ORIGINS: 'https://chatgpt.com,https://smoke.example.com',
  });
  assert.deepEqual(config.allowedOrigins, ['https://chatgpt.com', 'https://smoke.example.com']);

  for (const invalid of [
    'http://chatgpt.com',
    'https://*.chatgpt.com',
    'https://chatgpt.com/mcp',
    'https://user:pass@chatgpt.com',
  ]) {
    assert.throws(
      () => parseMcpServerConfig({ ...productionEnv, KIDBOT_MCP_ALLOWED_ORIGINS: invalid }),
      /KIDBOT_MCP_ALLOWED_ORIGINS/,
      `expected ${invalid} to be rejected`,
    );
  }
});

test('development leaves origins unrestricted so the dev bridge keeps working', () => {
  const config = parseMcpServerConfig({ FALLBACK_WIDGET: '1', KIDBOT_LOCAL_DEV: '1' });
  assert.equal(config.allowedOrigins, undefined);

  const configured = parseMcpServerConfig({
    FALLBACK_WIDGET: '1',
    KIDBOT_LOCAL_DEV: '1',
    KIDBOT_MCP_ALLOWED_ORIGINS: 'https://chatgpt.com',
  });
  assert.deepEqual(configured.allowedOrigins, ['https://chatgpt.com']);
});

test('origin matching compares exact origins', () => {
  const allowlist = ['https://chatgpt.com'];
  assert.equal(isOriginAllowed('https://chatgpt.com', allowlist), true);
  assert.equal(isOriginAllowed('https://chatgpt.com/', allowlist), true);
  assert.equal(isOriginAllowed('https://evil.chatgpt.com', allowlist), false);
  assert.equal(isOriginAllowed('http://chatgpt.com', allowlist), false);
  assert.equal(isOriginAllowed('null', allowlist), false);
  assert.equal(isOriginAllowed('', allowlist), false);
});

test('the guard passes server-to-server callers and refuses unlisted browser origins', () => {
  const guard = createOriginGuard(['https://chatgpt.com']);

  const serverToServer = guardCall(guard, {});
  assert.equal(serverToServer.nextCalled, true);
  assert.equal(serverToServer.status, undefined);

  const allowed = guardCall(guard, { origin: 'https://chatgpt.com' });
  assert.equal(allowed.nextCalled, true);
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://chatgpt.com');
  assert.equal(allowed.headers.vary, 'Origin');

  const refused = guardCall(guard, { origin: 'https://evil.example' });
  assert.equal(refused.nextCalled, false);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.message, 'origin_not_allowed');
  assert.equal(refused.headers['access-control-allow-origin'], undefined);
});

test('an unset allowlist disables the guard entirely', () => {
  const guard = createOriginGuard(undefined);
  const result = guardCall(guard, { origin: 'https://anywhere.example' });

  assert.equal(result.nextCalled, true);
  assert.equal(result.status, undefined);
  assert.equal(result.headers.vary, undefined);
});
