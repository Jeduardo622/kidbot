export interface AgentServiceConfig {
  providerApiKey: string | undefined;
  serviceAuthToken: string | undefined;
  logSubjectSecret: string | undefined;
  fallbackMode: boolean;
  localDevIntent: boolean;
  requireServiceAuth: boolean;
  startupPosture: 'secured' | 'local-fallback';
  port: number;
}

type AgentServiceEnv = Partial<
  Record<
    | 'AGENT_SERVICE_TOKEN'
    | 'FALLBACK_WIDGET'
    | 'KIDBOT_LOCAL_DEV'
    | 'NODE_ENV'
    | 'OPENAI_API_KEY'
    | 'PORT'
    | 'AGENT_PORT',
    string
  >
>;

const minProductionTokenLength = 32;

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

  return {
    providerApiKey: trimOptional(env.OPENAI_API_KEY),
    serviceAuthToken,
    logSubjectSecret: requireServiceAuth ? serviceAuthToken : undefined,
    fallbackMode,
    localDevIntent,
    requireServiceAuth,
    startupPosture,
    port: parsePort(env.PORT ?? env.AGENT_PORT, 4505),
  };
};
