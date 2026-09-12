import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { createHermeticServiceContext } from './hermetic-service-env.mjs';

const expectedRejectionCodes = new Set([
  'agent_rate_limited',
  'concurrency_limited',
  'http_rate_limited',
  'rate_limited',
]);
const structuredToolErrorCodes = new Set([
  'concurrency_limited',
  'rate_limited',
  'request_timeout',
]);

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const percentile = (values, ratio) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
};

const increment = (counts, code) => {
  counts[code] = (counts[code] ?? 0) + 1;
};

export const parseMcpPayload = (responseText) => {
  try {
    return JSON.parse(responseText);
  } catch {
    const dataLine = responseText
      .split(/\r?\n/)
      .find((line) => line.startsWith('data:'));
    if (dataLine) {
      try {
        return JSON.parse(dataLine.slice('data:'.length).trim());
      } catch {
        // Fall through to the bounded error below.
      }
    }
    throw new Error('Invalid MCP response payload.');
  }
};

export const classifyMcpResponse = ({ httpStatus, latencyMs, payload }) => {
  const roundedLatency = Math.max(0, Math.round(latencyMs));
  if (httpStatus === 429) {
    const retryAfterMs = isRecord(payload) && isRecord(payload.error)
      && isRecord(payload.error.data) && Number.isFinite(payload.error.data.retryAfterMs)
      ? Math.max(1, Math.round(payload.error.data.retryAfterMs))
      : undefined;
    return {
      code: 'http_rate_limited',
      latencyMs: roundedLatency,
      ok: false,
      ...(retryAfterMs ? { retryAfterMs } : {}),
    };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { code: `http_${httpStatus}`, latencyMs: roundedLatency, ok: false };
  }

  const result = isRecord(payload) && isRecord(payload.result) ? payload.result : undefined;
  const structuredContent = result && isRecord(result.structuredContent)
    ? result.structuredContent
    : undefined;
  if (result?.isError === true) {
    const reportedCode = typeof structuredContent?.code === 'string'
      ? structuredContent.code
      : undefined;
    const code = reportedCode && structuredToolErrorCodes.has(reportedCode)
      ? reportedCode
      : 'tool_error';
    const retryAfterMs = Number.isFinite(structuredContent?.retryAfter)
      ? Math.max(1, Math.round(structuredContent.retryAfter * 1_000))
      : undefined;
    return {
      code,
      latencyMs: roundedLatency,
      ok: false,
      ...(retryAfterMs ? { retryAfterMs } : {}),
    };
  }
  if (result && structuredContent?.blocked === true) {
    return { code: 'blocked_response', latencyMs: roundedLatency, ok: false };
  }
  if (result && structuredContent?.degraded === true) {
    return { code: 'degraded_response', latencyMs: roundedLatency, ok: false };
  }
  if (
    result
    && structuredContent?.blocked === false
    && typeof structuredContent.persona === 'string'
    && structuredContent.persona.length > 0
    && typeof structuredContent.text === 'string'
    && structuredContent.text.length > 0
  ) {
    return { code: 'ok', latencyMs: roundedLatency, ok: true };
  }
  if (result) {
    return { code: 'invalid_voice_result', latencyMs: roundedLatency, ok: false };
  }

  const errorMessage = isRecord(payload) && isRecord(payload.error)
    && typeof payload.error.message === 'string'
    ? payload.error.message.toLowerCase()
    : '';
  if (errorMessage.includes('status 429')) {
    return { code: 'agent_rate_limited', latencyMs: roundedLatency, ok: false };
  }
  if (errorMessage.includes('rate_limited')) {
    return { code: 'rate_limited', latencyMs: roundedLatency, ok: false };
  }
  return { code: errorMessage ? 'mcp_error' : 'invalid_response', latencyMs: roundedLatency, ok: false };
};

export const aggregateLoadResults = (
  results,
  {
    configuredConcurrency,
    expectedRejectionCodes: expectedCodes = expectedRejectionCodes,
    observedMaxConcurrency,
  },
) => {
  const expectedRejectionCounts = {};
  const unexpectedRejectionCounts = {};
  const rejectedLatencies = [];
  const successfulLatencies = [];
  let successes = 0;
  for (const result of results) {
    if (result.ok) {
      successes += 1;
      successfulLatencies.push(result.latencyMs);
    } else if (expectedCodes.has(result.code)) {
      increment(expectedRejectionCounts, result.code);
      rejectedLatencies.push(result.latencyMs);
    } else {
      increment(unexpectedRejectionCounts, result.code);
      rejectedLatencies.push(result.latencyMs);
    }
  }
  const sumCounts = (counts) => Object.values(counts).reduce((total, count) => total + count, 0);
  return {
    attempts: results.length,
    configuredConcurrency,
    expectedRejectionCounts,
    expectedRejections: sumCounts(expectedRejectionCounts),
    observedMaxConcurrency,
    rejectedP50LatencyMs: percentile(rejectedLatencies, 0.5),
    rejectedP95LatencyMs: percentile(rejectedLatencies, 0.95),
    successes,
    successfulP50LatencyMs: percentile(successfulLatencies, 0.5),
    successfulP95LatencyMs: percentile(successfulLatencies, 0.95),
    unexpectedRejectionCounts,
    unexpectedRejections: sumCounts(unexpectedRejectionCounts),
  };
};

export const assertBoundedAdmission = (summary) => {
  assert.ok(summary.rejections > 0, 'Admission probe did not reject any request.');
  assert.ok(
    summary.retryHintedRejections > 0,
    'Admission probe did not return a retry hint.',
  );
  assert.equal(
    summary.unexpectedRejections,
    0,
    `Admission probe received ${summary.unexpectedRejections} unexpected rejection(s).`,
  );
};

export const assertHealthyLoad = (summary) => {
  assert.ok(
    summary.observedMaxConcurrency <= summary.configuredConcurrency,
    `Observed concurrency ${summary.observedMaxConcurrency} exceeded configured concurrency ${summary.configuredConcurrency}.`,
  );
  assert.equal(
    summary.successes,
    summary.attempts,
    `Only ${summary.successes} of ${summary.attempts} load attempts succeeded; the healthy load did not succeed completely.`,
  );
};

export const formatLoadSummary = (summary) => JSON.stringify({
  note: 'Single-process synthetic stub run with in-memory request controls and disabled parent storage; not Redis or provider performance.',
  configuredConcurrency: summary.configuredConcurrency,
  observedMaxConcurrency: summary.observedMaxConcurrency,
  attempts: summary.attempts,
  distinctSessions: summary.distinctSessions,
  successes: summary.successes,
  expectedRejections: summary.expectedRejections,
  unexpectedRejections: summary.unexpectedRejections,
  expectedRejectionCounts: summary.expectedRejectionCounts,
  unexpectedRejectionCounts: summary.unexpectedRejectionCounts,
  successfulP50LatencyMs: summary.successfulP50LatencyMs,
  successfulP95LatencyMs: summary.successfulP95LatencyMs,
  rejectedP50LatencyMs: summary.rejectedP50LatencyMs,
  rejectedP95LatencyMs: summary.rejectedP95LatencyMs,
  ...(Number.isInteger(summary.waveSize) ? { waveSize: summary.waveSize } : {}),
  ...(Number.isFinite(summary.wavePauseMs) ? { wavePauseMs: summary.wavePauseMs } : {}),
  ...(summary.admissionProbe ? { admissionProbe: {
    attempts: summary.admissionProbe.attempts,
    rejections: summary.admissionProbe.rejections,
    retryHintedRejections: summary.admissionProbe.retryHintedRejections,
    unexpectedRejections: summary.admissionProbe.unexpectedRejections,
    rejectionCounts: summary.admissionProbe.rejectionCounts,
  } } : {}),
}, null, 2);

export const runBounded = async (items, concurrency, worker) => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Concurrency must be a positive integer.');
  }
  const results = new Array(items.length);
  let active = 0;
  let maxConcurrency = 0;
  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      active += 1;
      maxConcurrency = Math.max(maxConcurrency, active);
      try {
        results[index] = await worker(items[index], index);
      } finally {
        active -= 1;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );
  return { maxConcurrency, results };
};

const getFreePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.unref();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : undefined;
    server.close((error) => {
      if (error) reject(error);
      else if (!port) reject(new Error('Could not allocate a local port.'));
      else resolve(port);
    });
  });
});

const distinctPorts = async () => {
  const first = await getFreePort();
  let second = await getFreePort();
  while (second === first) second = await getFreePort();
  return [first, second];
};

const spawnService = (entry, env, context, { launcher } = {}) => {
  const args = launcher ? [launcher, entry] : [entry];
  const child = spawn(process.execPath, args, {
    cwd: context.cwd,
    env: { ...context.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.resume();
  child.stderr.resume();
  return child;
};

const stopChild = async (child) => {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(1_000)]);
  }
};

const waitForHealth = async (baseUrl, name, child) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`${name} exited before becoming healthy.`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return response.json();
    } catch {
      // The service may still be starting.
    }
    await delay(100);
  }
  throw new Error(`${name} did not become healthy.`);
};

export const startLocalLoadServices = async ({
  repoRoot = process.cwd(),
  requestLimits = {},
} = {}) => {
  const rootDir = path.resolve(repoRoot);
  const agentEntry = path.join(rootDir, 'apps', 'agent-service', 'dist', 'index.js');
  const mcpEntry = path.join(rootDir, 'apps', 'mcp-server', 'dist', 'server.js');
  const explicitStartLauncher = path.join(rootDir, 'scripts', 'start-service-export.mjs');
  await Promise.all([access(agentEntry), access(mcpEntry), access(explicitStartLauncher)]).catch(() => {
    throw new Error('Built agent, MCP, and test launcher entries are required. Build services first.');
  });

  const context = await createHermeticServiceContext();
  const [agentPort, mcpPort] = await distinctPorts();
  const serviceToken = `kidbot-load-${randomBytes(32).toString('base64url')}`;
  const agentBaseUrl = `http://127.0.0.1:${agentPort}`;
  const mcpBaseUrl = `http://127.0.0.1:${mcpPort}`;
  let agent;
  let mcp;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await stopChild(mcp);
    await stopChild(agent);
    await context.cleanup();
  };

  try {
    agent = spawnService(agentEntry, {
      AGENT_SERVICE_TOKEN: serviceToken,
      FALLBACK_WIDGET: '0',
      KIDBOT_LOCAL_DEV: '0',
      KIDBOT_STUB_PROVIDER: '1',
      NODE_ENV: 'test',
      PORT: String(agentPort),
      RATE_LIMIT_STORE: 'memory',
    }, context, { launcher: explicitStartLauncher });
    await waitForHealth(agentBaseUrl, 'agent-service', agent);

    mcp = spawnService(mcpEntry, {
      AGENT_PORT: String(agentPort),
      AGENT_SERVICE_TOKEN: serviceToken,
      FALLBACK_WIDGET: '0',
      KIDBOT_LOCAL_DEV: '0',
      MCP_CALLER_CONCURRENCY: String(requestLimits.callerConcurrency ?? 2),
      MCP_CALLER_COST_PER_MINUTE: '1000',
      MCP_CALLER_REQUESTS_PER_MINUTE: '1000',
      MCP_GLOBAL_CONCURRENCY: String(requestLimits.globalConcurrency ?? 8),
      MCP_GLOBAL_COST_PER_MINUTE: '1000',
      MCP_GLOBAL_REQUESTS_PER_MINUTE: '1000',
      MCP_NETWORK_CONCURRENCY: String(requestLimits.networkConcurrency ?? 4),
      MCP_NETWORK_COST_PER_MINUTE: '1000',
      MCP_NETWORK_REQUESTS_PER_MINUTE: '1000',
      MCP_PORT: String(mcpPort),
      MCP_REQUEST_CONTROL_STORE: 'memory',
      NODE_ENV: 'test',
      PARENT_PROFILE_STORE: 'disabled',
    }, context);
    const health = await waitForHealth(mcpBaseUrl, 'mcp-server', mcp);
    assert.equal(health?.requestControlStore?.mode, 'memory');
    assert.equal(health?.requestControlStore?.ready, true);
    assert.equal(health?.parentProfileStore?.mode, 'disabled');
    assert.equal(health?.parentProfileStore?.ready, true);
    assert.equal(health?.agentService?.reachable, true);
    assert.equal(health?.agentService?.provider, 'stub');
    return {
      agentBaseUrl,
      mcpBaseUrl,
      mode: 'single-process-synthetic-stub',
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
};

const callVoice = async (mcpBaseUrl, sessionId, requestId) => {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${mcpBaseUrl}/mcp`, {
      body: JSON.stringify({
        id: requestId,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            ageBand: '7-9',
            persona: 'robot',
            profileId: 'local-default',
            sessionId,
            text: 'Share one friendly science fact.',
          },
          name: 'voice_chat',
        },
      }),
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    });
    const responseText = await response.text();
    let payload;
    try {
      payload = parseMcpPayload(responseText);
    } catch {
      return {
        code: 'invalid_json',
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        ok: false,
      };
    }
    return classifyMcpResponse({
      httpStatus: response.status,
      latencyMs: performance.now() - startedAt,
      payload,
    });
  } catch {
    return {
      code: 'transport_error',
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      ok: false,
    };
  }
};

export const runLocalLoad = async ({
  admissionBurstSize = 16,
  concurrency = 2,
  repoRoot = process.cwd(),
  sessionCount = 100,
  waitBetweenWaves = delay,
  wavePauseMs = 61_000,
  waveSize = 50,
} = {}) => {
  const admissionServices = await startLocalLoadServices({
    repoRoot,
    requestLimits: {
      callerConcurrency: 1,
      globalConcurrency: 1,
      networkConcurrency: 1,
    },
  });
  let admissionProbe;
  try {
    const probeSessions = Array.from(
      { length: admissionBurstSize },
      () => `kb_session_${randomUUID().replaceAll('-', '')}`,
    );
    const probe = await runBounded(
      probeSessions,
      admissionBurstSize,
      (sessionId, index) => callVoice(admissionServices.mcpBaseUrl, sessionId, 500 + index),
    );
    const rejectionCounts = {};
    let rejections = 0;
    let retryHintedRejections = 0;
    let unexpectedRejections = 0;
    for (const result of probe.results) {
      if (result.ok) continue;
      if (result.code === 'concurrency_limited' || result.code === 'http_rate_limited') {
        rejections += 1;
        increment(rejectionCounts, result.code);
        if (Number.isFinite(result.retryAfterMs) && result.retryAfterMs > 0) {
          retryHintedRejections += 1;
        }
      } else {
        unexpectedRejections += 1;
      }
    }
    admissionProbe = {
      attempts: probe.results.length,
      rejectionCounts,
      rejections,
      retryHintedRejections,
      unexpectedRejections,
    };
    assertBoundedAdmission(admissionProbe);
  } finally {
    await admissionServices.stop();
  }

  const services = await startLocalLoadServices({ repoRoot });
  try {
    const sessionIds = Array.from(
      { length: sessionCount },
      () => `kb_session_${randomUUID().replaceAll('-', '')}`,
    );
    assert.equal(new Set(sessionIds).size, sessionCount, 'Load session IDs must be distinct.');
    const results = [];
    let observedMaxConcurrency = 0;
    for (let offset = 0; offset < sessionIds.length; offset += waveSize) {
      const wave = sessionIds.slice(offset, offset + waveSize);
      const bounded = await runBounded(wave, concurrency, (sessionId, index) =>
        callVoice(services.mcpBaseUrl, sessionId, 1_000 + offset + index));
      results.push(...bounded.results);
      observedMaxConcurrency = Math.max(observedMaxConcurrency, bounded.maxConcurrency);
      if (offset + waveSize < sessionIds.length && wavePauseMs > 0) {
        await waitBetweenWaves(wavePauseMs);
      }
    }
    const summary = {
      ...aggregateLoadResults(results, {
        configuredConcurrency: concurrency,
        expectedRejectionCodes,
        observedMaxConcurrency,
      }),
      admissionProbe,
      distinctSessions: sessionIds.length,
      wavePauseMs,
      waveSize,
    };
    assertHealthyLoad(summary);
    return summary;
  } finally {
    await services.stop();
  }
};

const waitForTerminationSignal = () => new Promise((resolve) => {
  process.once('SIGINT', resolve);
  process.once('SIGTERM', resolve);
});

const runCli = async () => {
  if (process.argv[2] === '--serve') {
    const services = await startLocalLoadServices();
    try {
      console.log(services.mcpBaseUrl);
      await waitForTerminationSignal();
    } finally {
      await services.stop();
    }
    return;
  }
  if (process.argv.length > 2) {
    throw new Error('Usage: node scripts/smoke-local-load.mjs [--serve]');
  }
  console.log(formatLoadSummary(await runLocalLoad()));
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runCli().catch((error) => {
    console.error(`Local synthetic load failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
