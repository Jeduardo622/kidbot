#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const defaultTheme = 'A robot paints a rainbow garden';

const trimValue = (value) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const classifyImageUrl = (url) => {
  if (typeof url !== 'string' || !url) {
    return 'missing';
  }
  if (url.startsWith('data:image/png;base64,')) {
    return 'data-url';
  }
  if (url.startsWith('/generated-images/')) {
    return 'local-url';
  }
  if (url.includes('/storage/v1/object/public/')) {
    return 'supabase-public-url';
  }
  return 'other-url';
};

const normalizeMcpBaseUrl = (value) => {
  const raw = trimValue(value);
  if (!raw) {
    throw new Error('KIDBOT_REMOTE_MCP_URL is required for production MCP story panels smoke.');
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
    panels: 2,
    theme: defaultTheme,
    timeoutMs: 180000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mcp-url') {
      options.mcpBaseUrl = argv[++i];
    } else if (arg === '--theme') {
      options.theme = argv[++i] ?? options.theme;
    } else if (arg === '--panels') {
      options.panels = Number(argv[++i] ?? options.panels);
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[++i] ?? options.timeoutMs);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.panels) || options.panels < 2 || options.panels > 8) {
    throw new Error('--panels must be an integer from 2 through 8.');
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

const readJson = async (response, label) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON response: ${text.slice(0, 200)}`);
  }
};

const parseMcpResponse = (text) => {
  const dataLines = text.split(/\r?\n/).filter((line) => line.startsWith('data:'));
  if (!dataLines.length) {
    throw new Error(`Missing MCP SSE data line: ${text.slice(0, 300)}`);
  }
  return JSON.parse(dataLines.map((line) => line.slice(5).trimStart()).join('\n'));
};

const assertHealth = (health) => {
  if (health?.ok !== true) {
    throw new Error(`MCP healthz is not ok; ok=${health?.ok}`);
  }
  if (health?.parentProfileStore?.mode && health.parentProfileStore.ready !== true) {
    throw new Error(
      `MCP parent profile store is not ready; mode=${health.parentProfileStore.mode}; ready=${health.parentProfileStore.ready}`,
    );
  }
};

const assertStoryPanels = ({ mcpMessage, panels }) => {
  if (mcpMessage?.error) {
    throw new Error(`story_panels returned MCP error: ${mcpMessage.error.message ?? 'missing message'}`);
  }

  const result = mcpMessage?.result ?? {};
  const structured = result.structuredContent ?? {};
  if (result.isError === true) {
    throw new Error(
      `story_panels returned MCP tool error; error=${structured.error ?? 'missing'}; fallbackReason=${
        structured.fallbackReason ?? 'missing'
      }; correlationId=${structured.correlationId ?? 'missing'}`,
    );
  }
  if (structured.blocked !== false) {
    throw new Error(`story_panels did not return blocked=false; blocked=${structured.blocked}`);
  }

  const panelList = Array.isArray(structured.panels) ? structured.panels : [];
  if (panelList.length !== panels) {
    throw new Error(`story_panels returned ${panelList.length} panels; expected ${panels}.`);
  }

  const imageUrls = panelList.map((panel) => panel?.imageUrl).filter(Boolean);
  const imageUrlShapes = imageUrls.map(classifyImageUrl);
  if (imageUrls.length !== panels || imageUrlShapes.some((shape) => shape !== 'supabase-public-url')) {
    throw new Error(
      `story_panels returned unexpected image URL shapes; expected ${panels} supabase-public-url, got ${
        imageUrlShapes.join(',') || 'none'
      }.`,
    );
  }

  return { imageUrls, imageUrlShapes, structured };
};

const assertImageFetch = async ({ fetchImpl, imageUrl, timeoutMs }) => {
  const response = await fetchWithTimeout(fetchImpl, imageUrl, { method: 'GET' }, timeoutMs);
  const contentType = response.headers.get('content-type') ?? '';
  const bytes = (await response.arrayBuffer()).byteLength;
  if (!response.ok || contentType !== 'image/png' || bytes <= 0) {
    throw new Error(
      `generated image fetch failed; status=${response.status}; contentType=${contentType || 'missing'}; bytes=${bytes}`,
    );
  }
  return {
    status: response.status,
    contentType,
    bytes,
  };
};

export const runProductionMcpStoryPanelsSmoke = async ({
  fetchImpl = fetch,
  mcpBaseUrl = process.env.KIDBOT_REMOTE_MCP_URL,
  panels = 2,
  theme = defaultTheme,
  timeoutMs = 180000,
} = {}) => {
  const normalizedMcpBaseUrl = normalizeMcpBaseUrl(mcpBaseUrl);
  const healthResponse = await fetchWithTimeout(fetchImpl, `${normalizedMcpBaseUrl}/healthz`, {}, 30000);
  const health = await readJson(healthResponse, 'MCP healthz');
  assertHealth(health);

  const mcpResponse = await fetchWithTimeout(
    fetchImpl,
    `${normalizedMcpBaseUrl}/mcp`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 301,
        method: 'tools/call',
        params: {
          name: 'story_panels',
          arguments: { ageBand: '7-9', panels, theme },
        },
      }),
    },
    timeoutMs,
  );
  const mcpText = await mcpResponse.text();
  if (!mcpResponse.ok) {
    throw new Error(`MCP story_panels HTTP request failed; status=${mcpResponse.status}; body=${mcpText.slice(0, 200)}`);
  }

  const mcpMessage = parseMcpResponse(mcpText);
  const { imageUrls, imageUrlShapes, structured } = assertStoryPanels({
    mcpMessage,
    panels,
  });
  const firstImageFetch = await assertImageFetch({
    fetchImpl,
    imageUrl: imageUrls[0],
    timeoutMs: 45000,
  });

  return {
    ok: true,
    mcpBaseUrl: normalizedMcpBaseUrl,
    health: {
      ok: health.ok,
      parentProfileMode: health.parentProfileStore?.mode ?? null,
      parentProfileReady: health.parentProfileStore?.ready ?? null,
    },
    storyPanels: {
      blocked: structured.blocked,
      imageUrlCount: imageUrls.length,
      imageUrlShapes,
      panelCount: structured.panels.length,
      firstImageFetch,
    },
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const result = await runProductionMcpStoryPanelsSmoke(options);
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
