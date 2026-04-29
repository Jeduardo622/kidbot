export interface McpServerConfig {
  agentPort: number;
  agentBaseUrl: string;
  mcpPort: number;
  fallbackMode: boolean;
  localDevIntent: boolean;
  serviceAuthToken: string | undefined;
  startupPosture: 'secured' | 'local-fallback';
}

type McpServerEnv = Partial<
  Record<
    | 'AGENT_PORT'
    | 'AGENT_SERVICE_TOKEN'
    | 'FALLBACK_WIDGET'
    | 'KIDBOT_LOCAL_DEV'
    | 'MCP_PORT'
    | 'NODE_ENV',
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
  const mcpPort = parsePort('MCP_PORT', env.MCP_PORT, 3000);
  const fallbackMode = env.FALLBACK_WIDGET === '1';
  const localDevIntent = env.KIDBOT_LOCAL_DEV === '1';
  const serviceAuthToken = trimOptional(env.AGENT_SERVICE_TOKEN);
  const startupPosture = fallbackMode ? 'local-fallback' : 'secured';

  if (fallbackMode && !localDevIntent) {
    throw new Error('FALLBACK_WIDGET=1 requires KIDBOT_LOCAL_DEV=1 for explicit local fallback posture.');
  }

  validateServiceToken({
    serviceAuthToken,
    fallbackMode,
    nodeEnv: env.NODE_ENV,
  });

  return {
    agentPort,
    agentBaseUrl: `http://localhost:${agentPort}`,
    mcpPort,
    fallbackMode,
    localDevIntent,
    serviceAuthToken,
    startupPosture,
  };
};

export const mcpConfig = parseMcpServerConfig();
