#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const trimValue = (value) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const normalizeMcpBaseUrl = (value) => {
  const raw = trimValue(value);
  if (!raw) {
    throw new Error('KIDBOT_REMOTE_MCP_URL is required for the production release smoke.');
  }
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname.replace(/\/mcp\/?$/, '').replace(/\/$/, '')}`;
  } catch {
    throw new Error('MCP base URL must be a valid URL.');
  }
};

/** Published commit length; must match `release.ts` in both services. */
export const releaseCommitLength = 12;

export const normalizeCommit = (value) => {
  const trimmed = trimValue(value)?.toLowerCase();
  if (!trimmed || !/^[0-9a-f]{7,40}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed.slice(0, releaseCommitLength);
};

/** Compare at whichever length is shorter, so a full SHA matches a short one. */
export const releaseMatches = (deployed, expected) => {
  const actual = normalizeCommit(deployed);
  const wanted = normalizeCommit(expected);
  if (!actual || !wanted) {
    return false;
  }
  return actual.startsWith(wanted) || wanted.startsWith(actual);
};

export const releaseServices = Object.freeze(['mcp', 'agent']);

/**
 * Which services must report the expected commit. A push that cannot redeploy
 * a service, because of that service's Railway watch patterns, must not be
 * held to a commit it will never publish.
 */
export const parseRequiredServices = (value) => {
  const raw = trimValue(value);
  if (raw === undefined) {
    return [...releaseServices];
  }
  if (raw === 'none') {
    return [];
  }
  const requested = raw.split(',').map((item) => item.trim()).filter(Boolean);
  const unknown = requested.filter((item) => !releaseServices.includes(item));
  if (unknown.length > 0) {
    throw new Error(`--require-commit-for accepts ${releaseServices.join(', ')}, or none.`);
  }
  return [...new Set(requested)];
};

/**
 * Everything a promoted build has to prove from the one public endpoint: both
 * services are ready, children are being served model output rather than
 * stubs, the React bundle is the deployed artifact, browser origins are
 * bounded, and each service that was due to redeploy runs the expected commit.
 */
export const collectReleaseFailures = ({
  health,
  expectedCommit,
  requiredServices = releaseServices,
}) => {
  const failures = [];
  const agent = health?.agentService ?? {};

  if (health?.ok !== true) failures.push(`MCP healthz ok=${health?.ok}`);
  if (health?.productionReady !== true) failures.push(`MCP productionReady=${health?.productionReady}`);
  if (health?.mode !== 'dist') failures.push(`widget mode=${health?.mode ?? 'missing'}; expected dist`);
  if (health?.originPolicy !== 'allowlist') {
    failures.push(`originPolicy=${health?.originPolicy ?? 'missing'}; expected allowlist`);
  }
  if (health?.parentProfileStore?.ready !== true) {
    failures.push(`parentProfileStore.ready=${health?.parentProfileStore?.ready}`);
  }
  if (health?.requestControlStore?.ready !== true) {
    failures.push(`requestControlStore.ready=${health?.requestControlStore?.ready}`);
  }
  if (agent.reachable !== true) failures.push(`agentService.reachable=${agent.reachable}`);
  if (agent.productionReady !== true) failures.push(`agentService.productionReady=${agent.productionReady}`);
  if (agent.provider !== 'openai') {
    failures.push(`agentService.provider=${agent.provider ?? 'missing'}; expected openai`);
  }

  if (expectedCommit) {
    if (requiredServices.includes('mcp') && !releaseMatches(health?.release?.commit, expectedCommit)) {
      failures.push(`MCP release=${health?.release?.commit ?? 'missing'}; expected ${expectedCommit}`);
    }
    if (requiredServices.includes('agent') && !releaseMatches(agent.release?.commit, expectedCommit)) {
      failures.push(`agent release=${agent.release?.commit ?? 'missing'}; expected ${expectedCommit}`);
    }
  }

  return failures;
};

const fetchWithTimeout = async (fetchImpl, url, options = {}, timeoutMs = 30000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const readJson = async (response, label) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON response: ${text.slice(0, 200)}`);
  }
};

const parseArgs = (argv) => {
  const options = {
    mcpBaseUrl: process.env.KIDBOT_REMOTE_MCP_URL,
    expectedCommit: process.env.KIDBOT_EXPECTED_RELEASE_COMMIT,
    requiredServices: process.env.KIDBOT_REQUIRED_RELEASE_SERVICES,
    attempts: 40,
    delayMs: 15000,
    timeoutMs: 30000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mcp-url') {
      options.mcpBaseUrl = argv[++i];
    } else if (arg === '--expect-commit') {
      options.expectedCommit = argv[++i];
    } else if (arg === '--require-commit-for') {
      options.requiredServices = argv[++i];
    } else if (arg === '--attempts') {
      options.attempts = Number(argv[++i]);
    } else if (arg === '--delay-ms') {
      options.delayMs = Number(argv[++i]);
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[++i]);
    } else if (arg === '--') {
      continue;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > 200) {
    throw new Error('--attempts must be an integer from 1 through 200.');
  }
  if (!Number.isInteger(options.delayMs) || options.delayMs < 0) {
    throw new Error('--delay-ms must be a non-negative integer.');
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error('--timeout-ms must be an integer of at least 1000.');
  }

  const expectedCommit = trimValue(options.expectedCommit);
  if (expectedCommit && !normalizeCommit(expectedCommit)) {
    throw new Error('--expect-commit must be a 7-40 character hexadecimal git commit.');
  }

  return {
    ...options,
    requiredServices: parseRequiredServices(options.requiredServices),
    expectedCommit: expectedCommit ? normalizeCommit(expectedCommit) : undefined,
    mcpBaseUrl: normalizeMcpBaseUrl(options.mcpBaseUrl),
  };
};

/**
 * Poll the public MCP health endpoint until the expected build is live and
 * both services report a production-ready posture. Railway replaces a
 * deployment asynchronously, so the gate waits rather than sampling once.
 */
export const runProductionReleaseSmoke = async ({
  fetchImpl = fetch,
  mcpBaseUrl = process.env.KIDBOT_REMOTE_MCP_URL,
  expectedCommit,
  requiredServices = releaseServices,
  attempts = 40,
  delayMs = 15000,
  timeoutMs = 30000,
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  log = () => {},
} = {}) => {
  const normalizedMcpBaseUrl = normalizeMcpBaseUrl(mcpBaseUrl);
  const wanted = expectedCommit ? normalizeCommit(expectedCommit) : undefined;
  if (expectedCommit && !wanted) {
    throw new Error('expectedCommit must be a 7-40 character hexadecimal git commit.');
  }

  let lastFailures = ['no attempt completed'];
  let lastHealth;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        `${normalizedMcpBaseUrl}/healthz`,
        {},
        timeoutMs,
      );
      lastHealth = await readJson(response, 'MCP healthz');
      lastFailures = collectReleaseFailures({
        health: lastHealth,
        expectedCommit: wanted,
        requiredServices,
      });
    } catch (error) {
      lastHealth = undefined;
      lastFailures = [`healthz request failed: ${error.message}`];
    }

    if (lastFailures.length === 0) {
      return {
        mcpBaseUrl: normalizedMcpBaseUrl,
        attempts: attempt,
        expectedCommit: wanted ?? null,
        requiredServices: [...requiredServices],
        release: lastHealth?.release ?? null,
        agentRelease: lastHealth?.agentService?.release ?? null,
        originPolicy: lastHealth?.originPolicy ?? null,
        provider: lastHealth?.agentService?.provider ?? null,
      };
    }

    log(`attempt ${attempt}/${attempts}: ${lastFailures.join('; ')}`);
    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  throw new Error(`Production release smoke failed after ${attempts} attempts: ${lastFailures.join('; ')}`);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const result = await runProductionReleaseSmoke({
    ...options,
    log: (message) => console.log(message),
  });
  console.log(
    `production release smoke passed: mcp=${result.release?.commit ?? 'unknown'} agent=${
      result.agentRelease?.commit ?? 'unknown'
    } provider=${result.provider} originPolicy=${result.originPolicy} requiredCommitFrom=${
      result.requiredServices.join(',') || 'none'
    } attempts=${result.attempts}`,
  );
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
