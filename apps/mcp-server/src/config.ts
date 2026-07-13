import type { RequestControlLimits } from './requestControls.js';

export interface McpServerConfig {
  agentPort: number;
  agentBaseUrl: string;
  mcpPort: number;
  fallbackMode: boolean;
  localDevIntent: boolean;
  serviceAuthToken: string | undefined;
  startupPosture: 'secured' | 'local-fallback';
  parentProfileStore: 'disabled' | 'redis';
  parentAuthSecret: string | undefined;
  parentHistoryRetentionDays: number;
  parentHistoryMaxEvents: number;
  requestControlStore: 'memory' | 'redis';
  requestControlLimits: RequestControlLimits;
  agentRequestTimeoutMs: number;
}

type McpServerEnv = Partial<
  Record<
    | 'AGENT_PORT'
    | 'AGENT_BASE_URL'
    | 'AGENT_SERVICE_TOKEN'
    | 'FALLBACK_WIDGET'
    | 'KIDBOT_LOCAL_DEV'
    | 'MCP_PORT'
    | 'MCP_AGENT_REQUEST_TIMEOUT_MS'
    | 'MCP_CALLER_CONCURRENCY'
    | 'MCP_CALLER_COST_PER_MINUTE'
    | 'MCP_CALLER_REQUESTS_PER_MINUTE'
    | 'MCP_GLOBAL_CONCURRENCY'
    | 'MCP_GLOBAL_COST_PER_MINUTE'
    | 'MCP_GLOBAL_REQUESTS_PER_MINUTE'
    | 'MCP_NETWORK_CONCURRENCY'
    | 'MCP_NETWORK_COST_PER_MINUTE'
    | 'MCP_NETWORK_REQUESTS_PER_MINUTE'
    | 'MCP_REQUEST_CONTROL_STORE'
    | 'NODE_ENV'
    | 'PARENT_AUTH_SECRET'
    | 'PARENT_HISTORY_MAX_EVENTS'
    | 'PARENT_HISTORY_RETENTION_DAYS'
    | 'PARENT_PROFILE_STORE',
    string
  >
>;

const minProductionTokenLength = 32;

const trimOptional = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const parsePort = (name: string, value: string | undefined, fallback: number): number => {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
};

const parsePositiveInteger = (name: string, value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
};

const parseBaseUrl = (name: string, value: string | undefined): string | undefined => {
  const trimmed = trimOptional(value);
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('invalid protocol');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} must be a valid http(s) URL.`);
  }
};

const validateServiceToken = ({
  serviceAuthToken,
  fallbackMode,
  nodeEnv,
}: {
  serviceAuthToken: string | undefined;
  fallbackMode: boolean;
  nodeEnv: string | undefined;
}) => {
  if (fallbackMode) {
    return;
  }

  if (!serviceAuthToken) {
    throw new Error('AGENT_SERVICE_TOKEN is required unless FALLBACK_WIDGET=1.');
  }

  const allowsShortToken = nodeEnv === 'test';
  if (!allowsShortToken && serviceAuthToken.length < minProductionTokenLength) {
    throw new Error(
      `AGENT_SERVICE_TOKEN must be at least ${minProductionTokenLength} characters in secured production posture.`,
    );
  }
};

export const parseMcpServerConfig = (env: McpServerEnv = process.env): McpServerConfig => {
  const agentPort = parsePort('AGENT_PORT', env.AGENT_PORT, 4505);
  const agentBaseUrl = parseBaseUrl('AGENT_BASE_URL', env.AGENT_BASE_URL) ?? `http://localhost:${agentPort}`;
  const mcpPort = parsePort('MCP_PORT', env.MCP_PORT, 3000);
  const fallbackMode = env.FALLBACK_WIDGET === '1';
  const localDevIntent = env.KIDBOT_LOCAL_DEV === '1';
  const serviceAuthToken = trimOptional(env.AGENT_SERVICE_TOKEN);
  const startupPosture = fallbackMode ? 'local-fallback' : 'secured';
  const parentProfileStoreRaw = env.PARENT_PROFILE_STORE?.trim().toLowerCase() || 'disabled';
  if (parentProfileStoreRaw !== 'disabled' && parentProfileStoreRaw !== 'redis') {
    throw new Error('PARENT_PROFILE_STORE must be disabled or redis.');
  }
  const parentProfileStore = parentProfileStoreRaw;
  const parentAuthSecret = trimOptional(env.PARENT_AUTH_SECRET);

  if (fallbackMode && !localDevIntent) {
    throw new Error('FALLBACK_WIDGET=1 requires KIDBOT_LOCAL_DEV=1 for explicit local fallback posture.');
  }

  validateServiceToken({
    serviceAuthToken,
    fallbackMode,
    nodeEnv: env.NODE_ENV,
  });

  if (parentProfileStore === 'redis') {
    if (!parentAuthSecret) {
      throw new Error('PARENT_AUTH_SECRET is required when PARENT_PROFILE_STORE=redis.');
    }
    if (env.NODE_ENV !== 'test' && parentAuthSecret.length < minProductionTokenLength) {
      throw new Error(
        `PARENT_AUTH_SECRET must be at least ${minProductionTokenLength} characters when parent profile storage is enabled.`,
      );
    }
  }

  const requestControlStoreRaw = env.MCP_REQUEST_CONTROL_STORE?.trim().toLowerCase()
    || (env.NODE_ENV === 'production' || parentProfileStore === 'redis' ? 'redis' : 'memory');
  if (requestControlStoreRaw !== 'memory' && requestControlStoreRaw !== 'redis') {
    throw new Error('MCP_REQUEST_CONTROL_STORE must be memory or redis.');
  }
  if (env.NODE_ENV === 'production' && requestControlStoreRaw !== 'redis') {
    throw new Error('MCP_REQUEST_CONTROL_STORE must be redis in production.');
  }
  const agentRequestTimeoutMs = parsePositiveInteger(
    'MCP_AGENT_REQUEST_TIMEOUT_MS',
    env.MCP_AGENT_REQUEST_TIMEOUT_MS,
    45_000,
  );

  return {
    agentPort,
    agentBaseUrl,
    mcpPort,
    fallbackMode,
    localDevIntent,
    serviceAuthToken,
    startupPosture,
    parentProfileStore,
    parentAuthSecret,
    parentHistoryRetentionDays: parsePositiveInteger(
      'PARENT_HISTORY_RETENTION_DAYS',
      env.PARENT_HISTORY_RETENTION_DAYS,
      30,
    ),
    parentHistoryMaxEvents: parsePositiveInteger(
      'PARENT_HISTORY_MAX_EVENTS',
      env.PARENT_HISTORY_MAX_EVENTS,
      200,
    ),
    requestControlStore: requestControlStoreRaw,
    requestControlLimits: {
      callerRequestsPerMinute: parsePositiveInteger(
        'MCP_CALLER_REQUESTS_PER_MINUTE', env.MCP_CALLER_REQUESTS_PER_MINUTE, 60,
      ),
      networkRequestsPerMinute: parsePositiveInteger(
        'MCP_NETWORK_REQUESTS_PER_MINUTE', env.MCP_NETWORK_REQUESTS_PER_MINUTE, 120,
      ),
      globalRequestsPerMinute: parsePositiveInteger(
        'MCP_GLOBAL_REQUESTS_PER_MINUTE', env.MCP_GLOBAL_REQUESTS_PER_MINUTE, 600,
      ),
      callerCostPerMinute: parsePositiveInteger(
        'MCP_CALLER_COST_PER_MINUTE', env.MCP_CALLER_COST_PER_MINUTE, 60,
      ),
      networkCostPerMinute: parsePositiveInteger(
        'MCP_NETWORK_COST_PER_MINUTE', env.MCP_NETWORK_COST_PER_MINUTE, 120,
      ),
      globalCostPerMinute: parsePositiveInteger(
        'MCP_GLOBAL_COST_PER_MINUTE', env.MCP_GLOBAL_COST_PER_MINUTE, 600,
      ),
      callerConcurrency: parsePositiveInteger(
        'MCP_CALLER_CONCURRENCY', env.MCP_CALLER_CONCURRENCY, 2,
      ),
      networkConcurrency: parsePositiveInteger(
        'MCP_NETWORK_CONCURRENCY', env.MCP_NETWORK_CONCURRENCY, 4,
      ),
      globalConcurrency: parsePositiveInteger(
        'MCP_GLOBAL_CONCURRENCY', env.MCP_GLOBAL_CONCURRENCY, 8,
      ),
      leaseMs: agentRequestTimeoutMs + 5_000,
    },
    agentRequestTimeoutMs,
  };
};

export const mcpConfig = parseMcpServerConfig();
