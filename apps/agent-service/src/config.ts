export type ProviderMode = 'openai' | 'stub';

export interface AgentServiceConfig {
  providerApiKey: string | undefined;
  /** 'openai' when a provider key is configured; 'stub' serves fixed local content. */
  providerMode: ProviderMode;
  serviceAuthToken: string | undefined;
  logSubjectSecret: string | undefined;
  fallbackMode: boolean;
  localDevIntent: boolean;
  requireServiceAuth: boolean;
  startupPosture: 'secured' | 'local-fallback';
  port: number;
  requestTimeoutMs: number;
  storyRequestTimeoutMs: number;
  /**
   * Trust one reverse-proxy hop (X-Forwarded-For) when deriving client IPs
   * for rate limiting. On by default in production (Railway edge proxy);
   * off elsewhere so a directly exposed service cannot be fooled by a
   * client-supplied header.
   */
  trustProxy: boolean;
}

type AgentServiceEnv = Partial<
  Record<
    | 'AGENT_SERVICE_TOKEN'
    | 'AGENT_REQUEST_TIMEOUT_MS'
    | 'AGENT_STORY_REQUEST_TIMEOUT_MS'
    | 'FALLBACK_WIDGET'
    | 'KIDBOT_LOCAL_DEV'
    | 'KIDBOT_STUB_PROVIDER'
    | 'KIDBOT_TRUST_PROXY'
    | 'NODE_ENV'
    | 'OPENAI_API_KEY'
    | 'PORT'
    | 'AGENT_PORT',
    string
  >
>;

const minProductionTokenLength = 32;

export const parseTrustProxy = (value: string | undefined, nodeEnv: string | undefined): boolean => {
  const trimmed = value?.trim();
  if (trimmed === '1' || trimmed === 'true') return true;
  if (trimmed === '0' || trimmed === 'false') return false;
  if (trimmed) throw new Error('KIDBOT_TRUST_PROXY must be 0 or 1.');
  return nodeEnv === 'production';
};

const trimOptional = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const parsePort = (value: string | undefined, fallback: number): number => {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
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

/**
 * Stub content (fixed fixtures that ignore the request) must never be served
 * by accident. Without a provider key the service only starts when:
 * - FALLBACK_WIDGET=1 (explicit local fallback posture), or
 * - NODE_ENV=test, or
 * - KIDBOT_STUB_PROVIDER=1 is set explicitly (used by posture smokes).
 */
const validateProviderMode = ({
  providerApiKey,
  fallbackMode,
  nodeEnv,
  stubProviderAllowed,
}: {
  providerApiKey: string | undefined;
  fallbackMode: boolean;
  nodeEnv: string | undefined;
  stubProviderAllowed: boolean;
}): ProviderMode => {
  if (providerApiKey) {
    return 'openai';
  }
  if (fallbackMode || nodeEnv === 'test' || stubProviderAllowed) {
    return 'stub';
  }
  throw new Error(
    'OPENAI_API_KEY is required. Set FALLBACK_WIDGET=1 for local fallback posture, or KIDBOT_STUB_PROVIDER=1 to knowingly serve stub content.',
  );
};

export const parseAgentServiceConfig = (
  env: AgentServiceEnv = process.env,
): AgentServiceConfig => {
  const fallbackMode = env.FALLBACK_WIDGET === '1';
  const localDevIntent = env.KIDBOT_LOCAL_DEV === '1';
  const requireServiceAuth = !fallbackMode;
  const startupPosture = fallbackMode ? 'local-fallback' : 'secured';
  const serviceAuthToken = trimOptional(env.AGENT_SERVICE_TOKEN);

  if (fallbackMode && env.NODE_ENV === 'production') {
    throw new Error('FALLBACK_WIDGET=1 is not allowed in production.');
  }

  if (env.NODE_ENV === 'production' && env.KIDBOT_STUB_PROVIDER === '1') {
    throw new Error('KIDBOT_STUB_PROVIDER=1 is not allowed in production.');
  }

  if (fallbackMode && !localDevIntent) {
    throw new Error(
      'FALLBACK_WIDGET=1 requires KIDBOT_LOCAL_DEV=1 for explicit local fallback posture.',
    );
  }

  validateServiceToken({
    serviceAuthToken,
    fallbackMode,
    nodeEnv: env.NODE_ENV,
  });

  const providerApiKey = trimOptional(env.OPENAI_API_KEY);
  const providerMode = validateProviderMode({
    providerApiKey,
    fallbackMode,
    nodeEnv: env.NODE_ENV,
    stubProviderAllowed: env.KIDBOT_STUB_PROVIDER === '1',
  });
  const requestTimeoutMs = parsePositiveInteger(
    'AGENT_REQUEST_TIMEOUT_MS',
    env.AGENT_REQUEST_TIMEOUT_MS,
    30_000,
  );
  const storyRequestTimeoutMs = parsePositiveInteger(
    'AGENT_STORY_REQUEST_TIMEOUT_MS',
    env.AGENT_STORY_REQUEST_TIMEOUT_MS,
    180_000,
  );
  if (storyRequestTimeoutMs < requestTimeoutMs) {
    throw new Error('AGENT_STORY_REQUEST_TIMEOUT_MS must be at least AGENT_REQUEST_TIMEOUT_MS.');
  }
  if (storyRequestTimeoutMs > 600_000) {
    throw new Error('AGENT_STORY_REQUEST_TIMEOUT_MS must not exceed 600000.');
  }
  if (env.NODE_ENV === 'production' && requestTimeoutMs < 30_000) {
    throw new Error('AGENT_REQUEST_TIMEOUT_MS must be at least 30000 in production.');
  }
  if (env.NODE_ENV === 'production' && storyRequestTimeoutMs < 180_000) {
    throw new Error('AGENT_STORY_REQUEST_TIMEOUT_MS must be at least 180000 in production.');
  }

  return {
    providerApiKey,
    providerMode,
    serviceAuthToken,
    logSubjectSecret: requireServiceAuth ? serviceAuthToken : undefined,
    fallbackMode,
    localDevIntent,
    requireServiceAuth,
    startupPosture,
    port: parsePort(env.PORT ?? env.AGENT_PORT, 4505),
    requestTimeoutMs,
    storyRequestTimeoutMs,
    trustProxy: parseTrustProxy(env.KIDBOT_TRUST_PROXY, env.NODE_ENV),
  };
};
