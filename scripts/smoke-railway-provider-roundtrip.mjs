#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const defaultBaseUrl = 'https://kidbot-production.up.railway.app';
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

const normalizeBaseUrl = (value) => {
  const raw = trimValue(value) ?? defaultBaseUrl;
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error('base URL must be a valid URL.');
  }
};

const parseArgs = (argv) => {
  const options = {
    baseUrl: process.env.KIDBOT_RAILWAY_BASE_URL,
    panels: 2,
    theme: defaultTheme,
    timeoutMs: 180000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-url') {
      options.baseUrl = argv[++i];
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
    baseUrl: normalizeBaseUrl(options.baseUrl),
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

const assertHealth = (health) => {
  if (health?.ok !== true) {
    throw new Error(`healthz is not ok; ok=${health?.ok}`);
  }
  if (health?.startupPosture !== 'secured') {
    throw new Error(`healthz startup posture is not secured; startupPosture=${health?.startupPosture}`);
  }
  if (health?.rateLimitStore?.ready !== true) {
    throw new Error(`healthz rate limiter is not ready; details=${health?.rateLimitStore?.details ?? 'missing'}`);
  }
};

const assertStoryPanels = ({ responseStatus, body, panels }) => {
  if (responseStatus !== 200) {
    throw new Error(
      `story-panels failed; status=${responseStatus}; error=${body?.error ?? 'missing'}; fallbackReason=${
        body?.fallbackReason ?? 'missing'
      }; correlationId=${body?.correlationId ?? 'missing'}`,
    );
  }
  if (body?.blocked !== false) {
    throw new Error(`story-panels did not return blocked=false; blocked=${body?.blocked}`);
  }
  const panelList = Array.isArray(body?.panels) ? body.panels : [];
  if (panelList.length !== panels) {
    throw new Error(`story-panels returned ${panelList.length} panels; expected ${panels}.`);
  }
  const imageUrls = panelList.map((panel) => panel?.imageUrl).filter(Boolean);
  const imageUrlShapes = imageUrls.map(classifyImageUrl);
  if (imageUrls.length !== panels || imageUrlShapes.some((shape) => shape !== 'supabase-public-url')) {
    throw new Error(
      `story-panels returned unexpected image URL shapes; expected ${panels} supabase-public-url, got ${
        imageUrlShapes.join(',') || 'none'
      }.`,
    );
  }
  return { imageUrls, imageUrlShapes };
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

export const runHostedProviderRoundtripSmoke = async ({
  baseUrl = defaultBaseUrl,
  fetchImpl = fetch,
  panels = 2,
  serviceToken = process.env.AGENT_SERVICE_TOKEN,
  theme = defaultTheme,
  timeoutMs = 180000,
} = {}) => {
  const token = trimValue(serviceToken);
  if (!token) {
    throw new Error('AGENT_SERVICE_TOKEN is required for hosted provider roundtrip smoke.');
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const healthResponse = await fetchWithTimeout(fetchImpl, `${normalizedBaseUrl}/healthz`, {}, 30000);
  const health = await readJson(healthResponse, 'healthz');
  assertHealth(health);

  const storyResponse = await fetchWithTimeout(
    fetchImpl,
    `${normalizedBaseUrl}/story-panels`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-kidbot-startup-posture': 'secured',
      },
      body: JSON.stringify({ ageBand: '7-9', panels, theme }),
    },
    timeoutMs,
  );
  const storyBody = await readJson(storyResponse, 'story-panels');
  const { imageUrls, imageUrlShapes } = assertStoryPanels({
    body: storyBody,
    panels,
    responseStatus: storyResponse.status,
  });
  const firstImageFetch = await assertImageFetch({
    fetchImpl,
    imageUrl: imageUrls[0],
    timeoutMs: 45000,
  });

  return {
    ok: true,
    baseUrl: normalizedBaseUrl,
    health: {
      ok: health.ok,
      rateLimitMode: health.rateLimitStore?.mode ?? null,
      rateLimitReady: health.rateLimitStore?.ready ?? null,
      startupPosture: health.startupPosture ?? null,
    },
    storyPanels: {
      blocked: storyBody.blocked,
      correlationId: storyBody.correlationId ?? null,
      imageUrlCount: imageUrls.length,
      imageUrlShapes,
      panelCount: storyBody.panels.length,
      firstImageFetch,
    },
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const result = await runHostedProviderRoundtripSmoke(options);
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
