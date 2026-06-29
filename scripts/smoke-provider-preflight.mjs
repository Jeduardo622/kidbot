#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const requireFromAgentService = createRequire(
  path.join(rootDir, 'apps', 'agent-service', 'package.json'),
);

const sensitiveKeys = [
  'OPENAI_API_KEY',
  'AGENT_SERVICE_TOKEN',
  'KIDBOT_SUPABASE_SERVICE_ROLE_KEY',
];

const keyFingerprint = (value) =>
  createHash('sha256').update(value).digest('hex').slice(0, 12);

const trimValue = (value) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const parseEnvText = (text) => {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const equals = line.indexOf('=');
    if (equals < 0) {
      continue;
    }
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
};

const readEnvFile = (filePath) =>
  existsSync(filePath) ? parseEnvText(readFileSync(filePath, 'utf8')) : {};

const assertNoSecretConflict = (rootEnv, appEnv) => {
  for (const key of sensitiveKeys) {
    const rootValue = trimValue(rootEnv[key]);
    const appValue = trimValue(appEnv[key]);
    if (rootValue && appValue && rootValue !== appValue) {
      throw new Error(
        `${key} mismatch between .env and apps/agent-service/.env; root fingerprint=${keyFingerprint(
          rootValue,
        )}, app fingerprint=${keyFingerprint(appValue)}`,
      );
    }
  }
};

const normalizeSupabaseUrl = (value) => {
  const trimmed = trimValue(value);
  if (!trimmed) {
    return undefined;
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    throw new Error('KIDBOT_SUPABASE_URL must be a valid URL.');
  }
};

const supabasePublicBase = (env) => {
  const supabaseUrl = normalizeSupabaseUrl(env.KIDBOT_SUPABASE_URL);
  const bucket = trimValue(env.KIDBOT_SUPABASE_IMAGE_BUCKET);
  if (!supabaseUrl || !bucket) {
    return undefined;
  }
  return `${supabaseUrl}/storage/v1/object/public/${bucket}`;
};

export const mergeProviderSmokeEnv = ({
  processEnv = process.env,
  rootEnv = {},
  appEnv = {},
} = {}) => {
  assertNoSecretConflict(rootEnv, appEnv);

  const merged = {
    ...processEnv,
    ...rootEnv,
    ...appEnv,
  };

  for (const key of sensitiveKeys) {
    merged[key] = trimValue(appEnv[key]) ?? trimValue(rootEnv[key]) ?? trimValue(processEnv[key]);
  }

  if (!trimValue(merged.KIDBOT_IMAGE_STORAGE_MODE)) {
    merged.KIDBOT_IMAGE_STORAGE_MODE =
      trimValue(merged.KIDBOT_SUPABASE_URL) && trimValue(merged.KIDBOT_SUPABASE_SERVICE_ROLE_KEY)
        ? 'supabase'
        : 'local';
  }

  if (merged.KIDBOT_IMAGE_STORAGE_MODE === 'supabase' && !trimValue(merged.KIDBOT_IMAGE_PUBLIC_BASE_URL)) {
    const publicBase = supabasePublicBase(merged);
    if (publicBase) {
      merged.KIDBOT_IMAGE_PUBLIC_BASE_URL = publicBase;
    }
  }

  return {
    ...merged,
    AGENT_SERVICE_TOKEN:
      trimValue(merged.AGENT_SERVICE_TOKEN) ??
      `kidbot-provider-smoke-${randomBytes(32).toString('base64url')}`,
    FALLBACK_WIDGET: '0',
    KIDBOT_LOCAL_DEV: '0',
    NODE_ENV: 'development',
    PARENT_PROFILE_STORE: 'disabled',
    PROVIDER_FAILURE_POLICY: trimValue(merged.PROVIDER_FAILURE_POLICY) ?? '503',
    PROVIDER_RETRIES: trimValue(merged.PROVIDER_RETRIES) ?? '0',
    PROVIDER_TIMEOUT_MS: trimValue(merged.PROVIDER_TIMEOUT_MS) ?? '120000',
    RATE_LIMIT_STORE: 'memory',
  };
};

export const validateProviderSmokeEnv = (env) => {
  const required = ['OPENAI_API_KEY', 'AGENT_SERVICE_TOKEN'];
  for (const key of required) {
    if (!trimValue(env[key])) {
      throw new Error(`${key} is required for provider preflight smoke.`);
    }
  }

  const mode = trimValue(env.KIDBOT_IMAGE_STORAGE_MODE) ?? 'local';
  if (!['data-url', 'local', 'supabase'].includes(mode)) {
    throw new Error('KIDBOT_IMAGE_STORAGE_MODE must be data-url, local, or supabase.');
  }

  if (mode === 'supabase') {
    for (const key of [
      'KIDBOT_SUPABASE_URL',
      'KIDBOT_SUPABASE_SERVICE_ROLE_KEY',
      'KIDBOT_SUPABASE_IMAGE_BUCKET',
    ]) {
      if (!trimValue(env[key])) {
        throw new Error(`${key} is required when KIDBOT_IMAGE_STORAGE_MODE=supabase.`);
      }
    }
    const expectedBase = supabasePublicBase(env);
    const configuredBase = trimValue(env.KIDBOT_IMAGE_PUBLIC_BASE_URL);
    if (configuredBase && expectedBase && !configuredBase.startsWith(expectedBase)) {
      throw new Error(
        'KIDBOT_IMAGE_PUBLIC_BASE_URL must point at Supabase Storage public objects when KIDBOT_IMAGE_STORAGE_MODE=supabase.',
      );
    }
  }

  return { mode };
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

const expectedUrlShapeForMode = (mode) => {
  if (mode === 'supabase') {
    return 'supabase-public-url';
  }
  if (mode === 'data-url') {
    return 'data-url';
  }
  return 'local-url';
};

const sampleImageUrlForMode = (mode, env) => {
  if (mode === 'supabase') {
    return `${supabasePublicBase(env)}/story-panels/exp-9999999999999-ci-check.png`;
  }
  if (mode === 'data-url') {
    return 'data:image/png;base64,ci-check';
  }
  return '/generated-images/ci-check.png';
};

export const runProviderPreflightCiCheck = () => {
  const ciToken = 'ci-service-token-abcdefghijklmnopqrstuvwxyz0123456789';
  const ciOpenAiKey = 'ci-openai-key-abcdefghijklmnopqrstuvwxyz0123456789';
  const ciServiceRoleKey = 'ci-supabase-service-role-abcdefghijklmnopqrstuvwxyz0123456789';
  const scenarios = [
    {
      mode: 'local',
      env: {
        OPENAI_API_KEY: ciOpenAiKey,
        AGENT_SERVICE_TOKEN: ciToken,
        KIDBOT_IMAGE_STORAGE_MODE: 'local',
        KIDBOT_IMAGE_PUBLIC_BASE_URL: '/generated-images',
      },
    },
    {
      mode: 'data-url',
      env: {
        OPENAI_API_KEY: ciOpenAiKey,
        AGENT_SERVICE_TOKEN: ciToken,
        KIDBOT_IMAGE_STORAGE_MODE: 'data-url',
      },
    },
    {
      mode: 'supabase',
      env: {
        OPENAI_API_KEY: ciOpenAiKey,
        AGENT_SERVICE_TOKEN: ciToken,
        KIDBOT_IMAGE_STORAGE_MODE: 'supabase',
        KIDBOT_SUPABASE_URL: 'https://project-ref.supabase.co',
        KIDBOT_SUPABASE_SERVICE_ROLE_KEY: ciServiceRoleKey,
        KIDBOT_SUPABASE_IMAGE_BUCKET: 'kidbot-images',
        KIDBOT_SUPABASE_IMAGE_PREFIX: 'story-panels',
      },
    },
  ];

  const checks = scenarios.map((scenario) => {
    const env = mergeProviderSmokeEnv({
      processEnv: {},
      rootEnv: scenario.env,
      appEnv: {},
    });
    const { mode } = validateProviderSmokeEnv(env);
    const imageUrl = sampleImageUrlForMode(mode, env);
    const imageUrlShape = classifyImageUrl(imageUrl);
    const expectedImageUrlShape = expectedUrlShapeForMode(mode);
    if (imageUrlShape !== expectedImageUrlShape) {
      throw new Error(
        `CI provider preflight expected ${expectedImageUrlShape} for ${mode}, got ${imageUrlShape}.`,
      );
    }
    return {
      mode,
      expectedImageUrlShape,
      imageUrlShape,
      providerTimeoutMs: env.PROVIDER_TIMEOUT_MS,
      publicBaseConfigured: Boolean(trimValue(env.KIDBOT_IMAGE_PUBLIC_BASE_URL)),
    };
  });

  return {
    ok: true,
    live: false,
    checks,
  };
};

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error('Failed to allocate a free port.'));
          return;
        }
        resolve(port);
      });
    });
  });

const findServiceCommand = (relativeSource, relativeDist) => {
  const distEntry = path.join(rootDir, relativeDist);
  if (existsSync(distEntry)) {
    return { command: process.execPath, args: [distEntry], label: relativeDist };
  }

  const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const sourceEntry = path.join(rootDir, relativeSource);
  if (existsSync(tsxCli) && existsSync(sourceEntry)) {
    return { command: process.execPath, args: [tsxCli, sourceEntry], label: relativeSource };
  }

  throw new Error(`Missing service entry for ${relativeSource}. Run pnpm install and build, then retry.`);
};

const spawnService = ({ command, args, label }, env) => {
  const child = spawn(command, args, {
    cwd: rootDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  return {
    child,
    label,
    diagnostics: () => `service=${label}; stdout=${stdout.slice(-600)}; stderr=${stderr.slice(-600)}`,
  };
};

const stopService = async (service) => {
  if (!service?.child || service.child.killed) {
    return;
  }
  service.child.kill();
  await Promise.race([new Promise((resolve) => service.child.once('exit', resolve)), delay(1500)]);
};

const waitForHealth = async (baseUrl, name, diagnostics) => {
  let lastStatus = null;
  let lastBody = '';
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      lastStatus = response.status;
      lastBody = await response.text();
      if (response.ok) {
        return;
      }
    } catch {
      // Service may still be starting.
    }
    await delay(250);
  }
  throw new Error(
    `${name} did not become healthy on ${baseUrl}; lastStatus=${lastStatus}; lastBody=${lastBody}; ${diagnostics()}`,
  );
};

const parseSseMessage = (text) => {
  const dataLines = text.split(/\r?\n/).filter((line) => line.startsWith('data:'));
  if (!dataLines.length) {
    throw new Error(`Missing MCP SSE data line: ${text.slice(0, 300)}`);
  }
  return JSON.parse(dataLines.map((line) => line.slice(5).trimStart()).join('\n'));
};

const runModerationPreflight = async (env) => {
  const openAiModule = requireFromAgentService('openai');
  const OpenAI = openAiModule.default ?? openAiModule;
  const model = trimValue(env.KIDBOT_OPENAI_MODERATION_MODEL) ?? 'omni-moderation-latest';
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const response = await client.moderations.create({
    model,
    input: 'A friendly robot paints a rainbow garden.',
  });
  return {
    model,
    flagged: Boolean(response.results?.[0]?.flagged),
    id: response.id ? 'present' : 'missing',
  };
};

const resolveFetchUrl = (imageUrl, agentBaseUrl) => {
  if (imageUrl.startsWith('/')) {
    return `${agentBaseUrl}${imageUrl}`;
  }
  return imageUrl;
};

const runStoryPanelsSmoke = async ({ env, mode, theme, panels }) => {
  const agentPort = await getFreePort();
  const mcpPort = await getFreePort();
  const agentBaseUrl = `http://127.0.0.1:${agentPort}`;
  const mcpBaseUrl = `http://127.0.0.1:${mcpPort}`;
  const serviceEnv = {
    ...env,
    AGENT_BASE_URL: agentBaseUrl,
    AGENT_PORT: String(agentPort),
    MCP_PORT: String(mcpPort),
    PORT: String(agentPort),
  };
  const agent = spawnService(
    findServiceCommand('apps/agent-service/src/index.ts', 'apps/agent-service/dist/index.js'),
    serviceEnv,
  );
  const mcp = spawnService(
    findServiceCommand('apps/mcp-server/src/server.ts', 'apps/mcp-server/dist/server.js'),
    serviceEnv,
  );

  try {
    await waitForHealth(agentBaseUrl, 'agent-service', agent.diagnostics);
    await waitForHealth(mcpBaseUrl, 'mcp-server', mcp.diagnostics);

    const response = await fetch(`${mcpBaseUrl}/mcp`, {
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
          arguments: { theme, panels, ageBand: '7-9' },
        },
      }),
    });
    const message = parseSseMessage(await response.text());
    const structured = message?.result?.structuredContent ?? {};
    const panelList = Array.isArray(structured.panels) ? structured.panels : [];
    const imageUrls = panelList.map((panel) => panel?.imageUrl).filter(Boolean);
    const imageUrlShapes = imageUrls.map(classifyImageUrl);
    const expectedShape = expectedUrlShapeForMode(mode);
    if (!response.ok || structured.blocked !== false || panelList.length !== panels) {
      throw new Error(
        `story_panels returned unexpected MCP result: status=${response.status}; blocked=${structured.blocked}; panels=${panelList.length}`,
      );
    }
    if (imageUrls.length !== panels || imageUrlShapes.some((shape) => shape !== expectedShape)) {
      throw new Error(
        `story_panels returned unexpected imageUrl shapes: expected=${expectedShape}; actual=${imageUrlShapes.join(',')}`,
      );
    }

    let imageFetch = null;
    if (imageUrls[0] && !imageUrls[0].startsWith('data:')) {
      const imageResponse = await fetch(resolveFetchUrl(imageUrls[0], agentBaseUrl));
      const bytes = await imageResponse.arrayBuffer();
      imageFetch = {
        status: imageResponse.status,
        contentType: imageResponse.headers.get('content-type'),
        bytes: bytes.byteLength,
      };
      if (!imageResponse.ok || imageFetch.contentType !== 'image/png') {
        throw new Error(
          `generated image fetch failed: status=${imageFetch.status}; contentType=${imageFetch.contentType}`,
        );
      }
    }

    return {
      status: response.status,
      blocked: structured.blocked,
      theme: structured.theme ?? null,
      panelCount: panelList.length,
      imageUrlCount: imageUrls.length,
      imageUrlShapes,
      imageFetch,
    };
  } finally {
    await stopService(mcp);
    await stopService(agent);
  }
};

const parseArgs = (argv) => {
  const options = {
    ciConfigCheck: false,
    moderationOnly: false,
    panels: 2,
    theme: 'A robot paints a rainbow garden',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ci-config-check') {
      options.ciConfigCheck = true;
    } else if (arg === '--moderation-only') {
      options.moderationOnly = true;
    } else if (arg === '--theme') {
      options.theme = argv[++i] ?? options.theme;
    } else if (arg === '--panels') {
      options.panels = Number(argv[++i] ?? options.panels);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(options.panels) || options.panels < 2 || options.panels > 8) {
    throw new Error('--panels must be an integer from 2 through 8.');
  }
  return options;
};

export const runProviderPreflightSmoke = async (options = {}) => {
  const rootEnv = readEnvFile(path.join(rootDir, '.env'));
  const appEnv = readEnvFile(path.join(rootDir, 'apps', 'agent-service', '.env'));
  const env = mergeProviderSmokeEnv({ processEnv: process.env, rootEnv, appEnv });
  const { mode } = validateProviderSmokeEnv(env);
  const moderation = await runModerationPreflight(env);
  const result = {
    ok: true,
    mode,
    moderation,
    storyPanels: null,
  };
  if (!options.moderationOnly) {
    result.storyPanels = await runStoryPanelsSmoke({
      env,
      mode,
      theme: options.theme,
      panels: options.panels,
    });
  }
  return result;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const result = options.ciConfigCheck
    ? runProviderPreflightCiCheck()
    : await runProviderPreflightSmoke(options);
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
