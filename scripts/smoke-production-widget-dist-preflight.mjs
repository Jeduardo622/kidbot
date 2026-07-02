#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const trimValue = (value) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const normalizeMcpBaseUrl = (value) => {
  const raw = trimValue(value);
  if (!raw) {
    throw new Error('KIDBOT_REMOTE_MCP_URL is required for production widget dist preflight.');
  }
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname.replace(/\/mcp\/?$/, '').replace(/\/$/, '')}`;
  } catch {
    throw new Error('MCP base URL must be a valid URL.');
  }
};

const parseArgs = (argv) => {
  const options = {
    mcpBaseUrl: process.env.KIDBOT_REMOTE_MCP_URL,
    timeoutMs: 30000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mcp-url') {
      options.mcpBaseUrl = argv[++i] ?? options.mcpBaseUrl;
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[++i] ?? options.timeoutMs);
    } else if (arg === '--') {
      continue;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error('--timeout-ms must be an integer of at least 1000.');
  }

  return {
    ...options,
    mcpBaseUrl: normalizeMcpBaseUrl(options.mcpBaseUrl),
  };
};

const fetchWithTimeout = async (fetchImpl, url, options = {}, timeoutMs = 30000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const readText = async (response, label) => {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} request failed; status=${response.status}; body=${text.slice(0, 200)}`);
  }
  return text;
};

const readJson = async (response, label) => {
  const text = await readText(response, label);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON response: ${text.slice(0, 200)}`);
  }
};

export const assertWidgetDistPreflight = ({ health, widgetHtml }) => {
  if (health?.ok !== true) {
    throw new Error(`MCP healthz is not ok; ok=${health?.ok}`);
  }
  if (health?.mode !== 'dist') {
    throw new Error(`MCP widget mode is not dist; mode=${health?.mode ?? 'missing'}`);
  }
  if (!/assets\/index-[A-Za-z0-9_-]+\.js/.test(widgetHtml)) {
    throw new Error('Production widget HTML does not reference a built assets/index-*.js bundle.');
  }
};

export const runProductionWidgetDistPreflight = async ({
  fetchImpl = fetch,
  mcpBaseUrl = process.env.KIDBOT_REMOTE_MCP_URL,
  timeoutMs = 30000,
} = {}) => {
  const normalizedMcpBaseUrl = normalizeMcpBaseUrl(mcpBaseUrl);
  const healthResponse = await fetchWithTimeout(fetchImpl, `${normalizedMcpBaseUrl}/healthz`, {}, timeoutMs);
  const health = await readJson(healthResponse, 'MCP healthz');
  const widgetResponse = await fetchWithTimeout(fetchImpl, `${normalizedMcpBaseUrl}/widget/`, {}, timeoutMs);
  const widgetHtml = await readText(widgetResponse, 'MCP widget');

  assertWidgetDistPreflight({ health, widgetHtml });

  return {
    ok: true,
    mcpBaseUrl: normalizedMcpBaseUrl,
    health: {
      ok: health.ok,
      mode: health.mode,
      parentProfileMode: health.parentProfileStore?.mode ?? null,
      parentProfileReady: health.parentProfileStore?.ready ?? null,
    },
    widget: {
      builtAssetReference: widgetHtml.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null,
      htmlBytes: Buffer.byteLength(widgetHtml),
    },
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const result = await runProductionWidgetDistPreflight(options);
  console.log(JSON.stringify(result, null, 2));
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  });
}
