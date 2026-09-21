import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import {
  aggregateLoadResults,
  assertBoundedAdmission,
  assertHealthyLoad,
  classifyMcpResponse,
  formatLoadSummary,
  parseMcpPayload,
  runBounded,
} from '../scripts/smoke-local-load.mjs';

test('MCP payload parser accepts streamable HTTP event data without exposing other lines', () => {
  assert.deepEqual(
    parseMcpPayload('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'),
    { jsonrpc: '2.0', id: 1, result: {} },
  );
  assert.deepEqual(parseMcpPayload('{"jsonrpc":"2.0","id":2,"result":{}}'), {
    jsonrpc: '2.0', id: 2, result: {},
  });
  assert.throws(() => parseMcpPayload('event: message\ndata: not-json\n'), /invalid MCP response/i);
});

test('MCP response classification accounts for success and rejection boundaries', () => {
  assert.deepEqual(
    classifyMcpResponse({
      httpStatus: 200,
      latencyMs: 8,
      payload: {
        jsonrpc: '2.0',
        id: 1,
        result: { structuredContent: { blocked: false, persona: 'robot', text: 'Ready.' } },
      },
    }),
    { code: 'ok', latencyMs: 8, ok: true },
  );
  assert.deepEqual(
    classifyMcpResponse({
      httpStatus: 200,
      latencyMs: 9,
      payload: {
        jsonrpc: '2.0',
        id: 2,
        result: {
          isError: true,
          structuredContent: { code: 'concurrency_limited', retryAfter: 2 },
        },
      },
    }),
    { code: 'concurrency_limited', latencyMs: 9, ok: false, retryAfterMs: 2_000 },
  );
  assert.deepEqual(
    classifyMcpResponse({ httpStatus: 429, latencyMs: 10, payload: {} }),
    { code: 'http_rate_limited', latencyMs: 10, ok: false },
  );
  assert.deepEqual(
    classifyMcpResponse({
      httpStatus: 200,
      latencyMs: 11,
      payload: { error: { message: 'Agent request failed with status 429' } },
    }),
    { code: 'agent_rate_limited', latencyMs: 11, ok: false },
  );
  assert.deepEqual(
    classifyMcpResponse({
      httpStatus: 200,
      latencyMs: 12,
      payload: {
        result: { isError: true, structuredContent: { code: 'token-shaped-private-value' } },
      },
    }),
    { code: 'tool_error', latencyMs: 12, ok: false },
  );
  assert.deepEqual(
    classifyMcpResponse({
      httpStatus: 200,
      latencyMs: 13,
      payload: { result: { structuredContent: { blocked: true, message: 'Paused.' } } },
    }),
    { code: 'blocked_response', latencyMs: 13, ok: false },
  );
  assert.deepEqual(
    classifyMcpResponse({
      httpStatus: 200,
      latencyMs: 14,
      payload: {
        result: {
          structuredContent: {
            blocked: false,
            degraded: true,
            message: 'Limited service.',
            persona: 'robot',
            text: 'Fixture text must not count as success.',
          },
        },
      },
    }),
    { code: 'degraded_response', latencyMs: 14, ok: false },
  );
  assert.deepEqual(
    classifyMcpResponse({
      httpStatus: 200,
      latencyMs: 15,
      payload: { result: { structuredContent: { blocked: false, persona: 'robot' } } },
    }),
    { code: 'invalid_voice_result', latencyMs: 15, ok: false },
  );
});

test('load aggregation separates expected rejections and unexpected errors', () => {
  const summary = aggregateLoadResults(
    [
      { code: 'ok', latencyMs: 10, ok: true },
      { code: 'rate_limited', latencyMs: 20, ok: false },
      { code: 'http_500', latencyMs: 30, ok: false },
      { code: 'transport_error', latencyMs: 40, ok: false },
    ],
    {
      configuredConcurrency: 2,
      expectedRejectionCodes: new Set(['rate_limited']),
      observedMaxConcurrency: 2,
    },
  );

  assert.deepEqual(summary, {
    attempts: 4,
    configuredConcurrency: 2,
    expectedRejectionCounts: { rate_limited: 1 },
    expectedRejections: 1,
    observedMaxConcurrency: 2,
    rejectedP50LatencyMs: 30,
    rejectedP95LatencyMs: 40,
    successes: 1,
    successfulP50LatencyMs: 10,
    successfulP95LatencyMs: 10,
    unexpectedRejectionCounts: { http_500: 1, transport_error: 1 },
    unexpectedRejections: 2,
  });
});

test('bounded runner limits concurrent work and preserves input order', async () => {
  let active = 0;
  let observed = 0;
  const { maxConcurrency, results } = await runBounded(
    ['a', 'b', 'c', 'd', 'e'],
    2,
    async (value) => {
      active += 1;
      observed = Math.max(observed, active);
      await delay(value === 'a' ? 12 : 2);
      active -= 1;
      return value.toUpperCase();
    },
  );

  assert.deepEqual(results, ['A', 'B', 'C', 'D', 'E']);
  assert.equal(maxConcurrency, 2);
  assert.equal(observed, 2);
  assert.equal(active, 0);
});

test('admission assertion requires an actual server rejection with a retry hint', () => {
  const admitted = {
    attempts: 8,
    rejections: 4,
    retryHintedRejections: 4,
    unexpectedRejections: 0,
  };
  assert.doesNotThrow(() => assertBoundedAdmission(admitted));
  assert.throws(
    () => assertBoundedAdmission({ ...admitted, rejections: 0, retryHintedRejections: 0 }),
    /did not reject/i,
  );
  assert.throws(
    () => assertBoundedAdmission({ ...admitted, retryHintedRejections: 0 }),
    /retry hint/i,
  );
});

test('healthy-load assertion separately rejects client overflow and unexpected responses', () => {
  const healthy = {
    attempts: 100,
    configuredConcurrency: 4,
    observedMaxConcurrency: 4,
    successes: 100,
    expectedRejections: 0,
    unexpectedRejections: 0,
  };
  assert.doesNotThrow(() => assertHealthyLoad(healthy));
  assert.throws(
    () => assertHealthyLoad({ ...healthy, observedMaxConcurrency: 5 }),
    /exceeded configured concurrency/i,
  );
  assert.throws(
    () => assertHealthyLoad({ ...healthy, successes: 99, expectedRejections: 1 }),
    /did not succeed/i,
  );
});

test('summary output contains aggregates and excludes request or credential fields', () => {
  const rendered = formatLoadSummary({
    configuredConcurrency: 4,
    attempts: 100,
    distinctSessions: 100,
    expectedRejectionCounts: {},
    expectedRejections: 0,
    observedMaxConcurrency: 4,
    rejectedP50LatencyMs: 0,
    rejectedP95LatencyMs: 0,
    successes: 100,
    successfulP50LatencyMs: 12,
    successfulP95LatencyMs: 24,
    prompt: 'must never render',
    requestToken: 'must-never-render',
    unexpectedRejectionCounts: {},
    unexpectedRejections: 0,
  });

  assert.match(rendered, /single-process synthetic/i);
  assert.match(rendered, /"attempts": 100/);
  assert.match(rendered, /"distinctSessions": 100/);
  assert.doesNotMatch(rendered, /prompt|text|token|sessionId|parentAccess/i);
  assert.match(rendered, /not Redis or provider performance/i);
});

test('service startup stays hermetic, secured, memory-controlled, and parent-store-free', async () => {
  const source = await readFile(new URL('../scripts/smoke-local-load.mjs', import.meta.url), 'utf8');

  assert.match(source, /createHermeticServiceContext/);
  assert.match(source, /start-service-export\.mjs/);
  assert.match(source, /PARENT_PROFILE_STORE:\s*'disabled'/);
  assert.match(source, /MCP_REQUEST_CONTROL_STORE:\s*'memory'/);
  assert.match(source, /KIDBOT_STUB_PROVIDER:\s*'1'/);
  assert.match(source, /FALLBACK_WIDGET:\s*'0'/);
  assert.match(source, /spawnService\(mcpEntry/);
  assert.match(source, /startLocalLoadServices/);
  assert.doesNotMatch(source, /OPENAI_API_KEY|REDIS_URL/);
});
