import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  collectReleaseFailures,
  normalizeCommit,
  normalizeMcpBaseUrl,
  releaseMatches,
  runProductionReleaseSmoke,
} from '../scripts/smoke-production-release.mjs';

const healthyBody = (overrides = {}) => ({
  ok: true,
  productionReady: true,
  mode: 'dist',
  originPolicy: 'allowlist',
  release: { commit: 'abcdef123456', environment: 'production' },
  agentService: {
    reachable: true,
    productionReady: true,
    provider: 'openai',
    release: { commit: 'abcdef123456', environment: 'production' },
  },
  parentProfileStore: { mode: 'redis', ready: true },
  requestControlStore: { mode: 'redis', ready: true },
  ...overrides,
});

const jsonResponse = (body) => ({
  ok: true,
  text: async () => JSON.stringify(body),
});

test('MCP base URL normalization strips the /mcp path', () => {
  assert.equal(
    normalizeMcpBaseUrl('https://example.up.railway.app/mcp'),
    'https://example.up.railway.app',
  );
  assert.equal(
    normalizeMcpBaseUrl('https://example.up.railway.app/'),
    'https://example.up.railway.app',
  );
  assert.throws(() => normalizeMcpBaseUrl(''), /KIDBOT_REMOTE_MCP_URL is required/);
  assert.throws(() => normalizeMcpBaseUrl('not-a-url'), /must be a valid URL/);
});

test('commit normalization accepts only hexadecimal git commits', () => {
  assert.equal(normalizeCommit('ABCDEF1234567890'), 'abcdef123456');
  assert.equal(normalizeCommit('abcdef1'), 'abcdef1');
  assert.equal(normalizeCommit('abcdef'), undefined);
  assert.equal(normalizeCommit('zzzzzzz'), undefined);
  assert.equal(normalizeCommit(undefined), undefined);
});

test('release comparison matches a short commit against a full SHA', () => {
  assert.equal(releaseMatches('abcdef123456', 'abcdef123456789012345678901234567890abcd'), true);
  assert.equal(releaseMatches('abcdef123456', 'abcdef1'), true);
  assert.equal(releaseMatches('abcdef123456', 'bbcdef123456'), false);
  assert.equal(releaseMatches(null, 'abcdef1'), false);
  assert.equal(releaseMatches('abcdef123456', undefined), false);
});

test('a healthy production release reports no failures', () => {
  assert.deepEqual(
    collectReleaseFailures({ health: healthyBody(), expectedCommit: 'abcdef123456' }),
    [],
  );
});

test('release check rejects stub provider, fallback widget, and an open origin policy', () => {
  const stub = collectReleaseFailures({
    health: healthyBody({
      agentService: { reachable: true, productionReady: true, provider: 'stub' },
    }),
  });
  assert.ok(stub.some((failure) => failure.includes('expected openai')));

  const fallback = collectReleaseFailures({ health: healthyBody({ mode: 'fallback' }) });
  assert.ok(fallback.some((failure) => failure.includes('expected dist')));

  const openOrigins = collectReleaseFailures({ health: healthyBody({ originPolicy: 'unrestricted' }) });
  assert.ok(openOrigins.some((failure) => failure.includes('expected allowlist')));
});

test('release check fails when either service runs a different commit', () => {
  const mcpStale = collectReleaseFailures({
    health: healthyBody({ release: { commit: '111111111111', environment: 'production' } }),
    expectedCommit: 'abcdef123456',
  });
  assert.deepEqual(mcpStale, ['MCP release=111111111111; expected abcdef123456']);

  const agentStale = collectReleaseFailures({
    health: healthyBody({
      agentService: {
        reachable: true,
        productionReady: true,
        provider: 'openai',
        release: { commit: '222222222222', environment: 'production' },
      },
    }),
    expectedCommit: 'abcdef123456',
  });
  assert.deepEqual(agentStale, ['agent release=222222222222; expected abcdef123456']);
});

test('smoke waits for the expected release and then passes', async () => {
  const bodies = [
    healthyBody({ release: { commit: '111111111111', environment: 'production' } }),
    healthyBody(),
  ];
  let calls = 0;
  const slept = [];

  const result = await runProductionReleaseSmoke({
    fetchImpl: async () => jsonResponse(bodies[calls++] ?? bodies[1]),
    mcpBaseUrl: 'https://example.up.railway.app',
    expectedCommit: 'abcdef123456789012345678901234567890abcd',
    attempts: 5,
    delayMs: 1,
    sleep: async (ms) => { slept.push(ms); },
  });

  assert.equal(calls, 2);
  assert.deepEqual(slept, [1]);
  assert.equal(result.attempts, 2);
  assert.equal(result.provider, 'openai');
  assert.equal(result.originPolicy, 'allowlist');
});

test('smoke fails with the unmet conditions after exhausting attempts', async () => {
  await assert.rejects(
    runProductionReleaseSmoke({
      fetchImpl: async () => jsonResponse(healthyBody({ ok: false, productionReady: false })),
      mcpBaseUrl: 'https://example.up.railway.app',
      attempts: 2,
      delayMs: 0,
      sleep: async () => {},
    }),
    /failed after 2 attempts.*productionReady=false/s,
  );
});

test('smoke surfaces transport failures instead of hanging', async () => {
  await assert.rejects(
    runProductionReleaseSmoke({
      fetchImpl: async () => { throw new Error('connection reset'); },
      mcpBaseUrl: 'https://example.up.railway.app',
      attempts: 1,
      delayMs: 0,
      sleep: async () => {},
    }),
    /healthz request failed: connection reset/,
  );
});

test('deploy verify workflow gates on the pushed commit', async () => {
  const workflow = await readFile('.github/workflows/deploy-verify.yml', 'utf8');
  const releaseIndex = workflow.indexOf('pnpm run smoke:production-release');
  const preflightIndex = workflow.indexOf('pnpm run smoke:production-widget-dist-preflight');

  assert.match(workflow, /on:\s*\n\s*push:\s*\n\s*branches:\s*\n\s*- main/);
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /secrets\.KIDBOT_REMOTE_MCP_URL/);
  assert.match(workflow, /--expect-commit "\$EXPECTED_COMMIT"/);
  assert.ok(releaseIndex > 0, 'missing release smoke step');
  assert.ok(preflightIndex > releaseIndex, 'artifact preflight must follow the release wait');
  assert.doesNotMatch(workflow, /OPENAI_API_KEY/);
});

test('nightly smoke runs on a schedule and reports failures as an issue', async () => {
  const workflow = await readFile('.github/workflows/nightly-production-smoke.yml', 'utf8');
  const preflightIndex = workflow.indexOf('pnpm run smoke:production-widget-dist-preflight');
  const storyIndex = workflow.indexOf('pnpm run smoke:production-mcp-story-panels');

  assert.match(workflow, /schedule:\s*\n(?:\s*#[^\n]*\n)*\s*- cron: '17 9 \* \* \*'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /issues:\s*write/);
  assert.match(workflow, /if: failure\(\)/);
  assert.match(workflow, /gh issue (?:create|comment)/);
  assert.ok(preflightIndex > 0, 'missing widget dist preflight');
  assert.ok(storyIndex > preflightIndex, 'story smoke must run after the artifact preflight');
});
