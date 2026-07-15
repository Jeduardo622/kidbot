import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  coloringOutlineSchema,
  parentHistoryListSchema,
  parentProfileCreateSchema,
  parentProfileDeleteSchema,
  parentProfileUpdateSchema,
  scienceSimSchema,
  storyPanelsSchema,
  voiceInputSchema
} from './schema.js';
import { mcpConfig } from './config.js';
import { createParentProfileStoreFromConfig, type AgeBand, type ParentHistoryEvent } from './parentStore.js';
import {
  computeToolCost,
  createCallerKey,
  createNetworkKey,
  createRequestControlStoreFromConfig,
  type RequestControlRejectionReason,
} from './requestControls.js';
import { kidTone, moderate } from './safety.js';
import {
  coloringOutlineToolOutputSchema,
  coloringOutlineToolOutputUnion,
  coloringOutlineSuccessSchema,
  parentHistoryListToolOutputSchema,
  parentHistoryListToolOutputUnion,
  parentHistoryListSuccessSchema,
  parentProfileCreateToolOutputSchema,
  parentProfileCreateToolOutputUnion,
  parentProfileCreateSuccessSchema,
  parentProfileUpdateToolOutputSchema,
  parentProfileUpdateToolOutputUnion,
  parentProfileUpdateSuccessSchema,
  registerKidbotTool,
  scienceSimToolOutputSchema,
  scienceSimToolOutputUnion,
  scienceSimSuccessSchema,
  storyPanelsToolOutputSchema,
  storyPanelsToolOutputUnion,
  storyPanelsSuccessSchema,
  voiceToolOutputSchema,
  voiceToolOutputUnion,
  voiceSuccessSchema,
} from './toolContracts.js';
import { widgetResourceUri } from './widgetMetadata.js';

const { agentBaseUrl, fallbackMode, serviceAuthToken, startupPosture } = mcpConfig;
export const parentProfileStore = createParentProfileStoreFromConfig(mcpConfig);
export const requestControlStore = createRequestControlStoreFromConfig(mcpConfig);
const degradedServiceMessage = 'Kidbot is having trouble reaching its idea engine right now. Please try again in a moment.';
const outputMeta = {
  'openai/outputTemplate': widgetResourceUri,
  'openai/widgetDescription': 'Kidbot — safe creative play: voice, comics, coloring, science.',
  'openai/widgetCSP': {
    connect_domains: [] as string[],
    resource_domains: mcpConfig.widgetResourceDomains
  }
};

const parentProfileDeleteSuccessSchema = z.object({
  deleted: z.literal(true),
  profileId: z.string(),
}).strict();
const parentProfileDeleteFailureSchema = z.object({
  error: z.literal(true),
  code: z.enum(['rate_limited', 'concurrency_limited', 'request_timeout']),
  retryAfter: z.number().int().positive().optional(),
}).strict();
const parentProfileDeleteToolOutputUnion = z.union([
  parentProfileDeleteSuccessSchema,
  parentProfileDeleteFailureSchema,
]);
const parentProfileDeleteToolOutputSchema = z.object({
  deleted: z.literal(true).optional(),
  profileId: z.string().optional(),
  error: z.literal(true).optional(),
  code: z.enum(['rate_limited', 'concurrency_limited', 'request_timeout']).optional(),
  retryAfter: z.number().int().positive().optional(),
}).strict();

interface AgentDegradedResponse {
  blocked: false;
  degraded: true;
  message: string;
  fallbackReason?: string;
  correlationId?: string;
}

interface SessionPayload {
  ageBand?: AgeBand;
  parentAccessToken?: string;
  profileId?: string;
  sessionId?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stripParentAccessToken = <T extends Record<string, unknown>>(input: T) => {
  const { parentAccessToken: _parentAccessToken, ...agentPayload } = input;
  return agentPayload;
};

const callAgent = async <T>(
  path: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<T | AgentDegradedResponse> => {
  if (fallbackMode) {
    throw new Error('Agent disabled in fallback mode');
  }
  const response = await fetch(`${agentBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-kidbot-startup-posture': startupPosture,
      Authorization: `Bearer ${serviceAuthToken ?? ''}`
    },
    body: JSON.stringify(payload),
    signal,
  });

  const responseBody = (await response.json().catch(() => undefined)) as unknown;

  if (!response.ok) {
    if (response.status === 503) {
      const fallbackReason = isRecord(responseBody) && typeof responseBody.fallbackReason === 'string'
        ? responseBody.fallbackReason
        : undefined;
      const correlationId = isRecord(responseBody) && typeof responseBody.correlationId === 'string'
        ? responseBody.correlationId
        : undefined;
      return {
        blocked: false,
        degraded: true,
        message: degradedServiceMessage,
        fallbackReason,
        correlationId
      };
    }
    throw new Error(`Agent request failed with status ${response.status}`);
  }

  return responseBody as T;
};

const blockedResponse = (message: string) => ({
  content: [
    {
      type: 'text' as const,
      text: message
    }
  ],
  structuredContent: {
    blocked: true,
    message
  },
  _meta: {
    ...outputMeta
  }
});

const isDegradedResponse = (response: { degraded?: boolean }): response is AgentDegradedResponse =>
  response.degraded === true;

const degradedResponse = (response: AgentDegradedResponse) => ({
  content: [
    {
      type: 'text' as const,
      text: response.message
    }
  ],
  structuredContent: response as unknown as Record<string, unknown>,
  _meta: {
    ...outputMeta,
    'openai/widgetAccessible': true
  }
});

interface ToolRequestExtra {
  signal: AbortSignal;
  _meta?: Record<string, unknown>;
  requestInfo?: {
    headers: Record<string, string | string[] | undefined>;
  };
}

const controlErrorResponse = (
  code: 'rate_limited' | 'concurrency_limited' | 'request_timeout',
  retryAfter?: number,
): CallToolResult => ({
  isError: true,
  content: [{
    type: 'text',
    text: code === 'request_timeout'
      ? 'Kidbot took too long to respond. Please try again.'
      : 'Kidbot is busy right now. Please wait a moment and try again.',
  }],
  structuredContent: {
    error: true,
    code,
    ...(retryAfter ? { retryAfter } : {}),
  },
  _meta: {
    ...outputMeta,
    'openai/widgetAccessible': true,
  },
});

const isConcurrencyReason = (reason: RequestControlRejectionReason) =>
  reason === 'caller_concurrency'
  || reason === 'network_concurrency'
  || reason === 'global_concurrency';

const runControlled = async (
  toolName: string,
  input: unknown,
  extra: ToolRequestExtra,
  networkIdentity: string,
  operation: (signal: AbortSignal) => Promise<CallToolResult>,
): Promise<CallToolResult> => {
  const deadlineSignal = AbortSignal.timeout(mcpConfig.agentRequestTimeoutMs);
  const signal = AbortSignal.any([extra.signal, deadlineSignal]);
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const execute = async (): Promise<CallToolResult> => {
    const subject = typeof extra._meta?.['openai/subject'] === 'string'
      ? extra._meta['openai/subject']
      : undefined;
    const secret = mcpConfig.serviceAuthToken
      ?? mcpConfig.parentAuthSecret
      ?? 'kidbot-local-control';
    const callerKey = createCallerKey({
      secret,
      subject,
      headers: extra.requestInfo?.headers ?? {},
      remoteAddress: networkIdentity,
    });
    const networkKey = createNetworkKey({ secret, networkIdentity });
    const lease = await requestControlStore.acquire({
      callerKey,
      networkKey,
      cost: computeToolCost(toolName, input),
      limits: mcpConfig.requestControlLimits,
    });
    if (!lease.allowed) {
      return controlErrorResponse(
        isConcurrencyReason(lease.reason) ? 'concurrency_limited' : 'rate_limited',
        Math.max(1, Math.ceil(lease.retryAfterMs / 1000)),
      );
    }
    try {
      return await operation(signal);
    } finally {
      try {
        await lease.release();
      } catch {
        // Lease expiry is the fail-safe; do not replace a completed tool result.
        // eslint-disable-next-line no-console
        console.warn(JSON.stringify({ event: 'mcp_request_control_release_failed' }));
      }
    }
  };
  try {
    return await Promise.race([execute(), aborted]);
  } catch (error) {
    if (signal.aborted) {
      return controlErrorResponse('request_timeout');
    }
    throw error;
  }
};

const createHistoryEvent = ({
  input,
  outputLength,
  response,
  tool,
}: {
  input: SessionPayload;
  outputLength: number;
  response: { blocked?: boolean; degraded?: boolean; providerFallback?: boolean; fallbackReason?: string; correlationId?: string };
  tool: string;
}): ParentHistoryEvent | undefined => {
  if (!input.sessionId || !input.profileId || input.profileId === 'local-default') {
    return undefined;
  }
  const ageBand = input.ageBand ?? '7-9';
  const degraded = response.degraded === true;
  const blocked = response.blocked === true;
  return {
    id: `kb_event_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    tool,
    sessionId: input.sessionId,
    profileId: input.profileId,
    ageBand,
    status: degraded ? 'degraded' : blocked ? 'blocked' : 'ok',
    blocked,
    degraded,
    providerFallback: response.providerFallback,
    fallbackReason: response.fallbackReason,
    correlationId: response.correlationId,
    inputLength: JSON.stringify(stripParentAccessToken(input as unknown as Record<string, unknown>)).length,
    outputLength,
  };
};

const recordHistoryIfAuthorized = async (
  input: SessionPayload,
  tool: string,
  response: Record<string, unknown>,
) => {
  const event = createHistoryEvent({
    input,
    outputLength: JSON.stringify(response).length,
    response: response as {
      blocked?: boolean;
      degraded?: boolean;
      providerFallback?: boolean;
      fallbackReason?: string;
      correlationId?: string;
    },
    tool,
  });
  if (!event) {
    return;
  }
  await parentProfileStore.recordEvent(event, input.parentAccessToken);
};

const handleWithModeration = async <Schema extends z.ZodTypeAny, ResponseType extends { blocked: boolean; message?: string; degraded?: boolean }>(
  schema: Schema,
  payload: unknown,
  tool: string,
  validator: (input: z.infer<Schema>) => string[],
  action: (input: z.infer<Schema>) => Promise<ResponseType>,
  transcript: (input: z.infer<Schema>, response: ResponseType) => string
): Promise<CallToolResult> => {
  const parsed = schema.parse(payload);
  const toModerate = validator(parsed).join(' ');
  const preCheck = moderate(toModerate);
  if (preCheck.blocked) {
    return blockedResponse(preCheck.message ?? 'Let\'s try a different friendly idea.');
  }

  const agentResponse = await action(parsed);
  if (isDegradedResponse(agentResponse)) {
    await recordHistoryIfAuthorized(parsed as SessionPayload, tool, agentResponse as unknown as Record<string, unknown>);
    return degradedResponse(agentResponse);
  }

  if (agentResponse.blocked) {
    await recordHistoryIfAuthorized(parsed as SessionPayload, tool, agentResponse as unknown as Record<string, unknown>);
    return blockedResponse(agentResponse.message ?? 'Let\'s pick another playful request.');
  }

  const transcriptText = transcript(parsed, agentResponse);
  const postCheck = moderate(transcriptText);
  if (postCheck.blocked) {
    return blockedResponse(postCheck.message ?? 'Let\'s stick with cheerful topics.');
  }

  await recordHistoryIfAuthorized(parsed as SessionPayload, tool, agentResponse as unknown as Record<string, unknown>);

  return {
    content: [
      {
        type: 'text' as const,
        text: transcriptText
      }
    ],
    structuredContent: agentResponse,
    _meta: {
      ...outputMeta,
      'openai/widgetAccessible': true
    }
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, '../../../fixtures');

const readFixtureJson = <T>(relativePath: string, fallback: T): T => {
  try {
    const fullPath = path.join(fixturesDir, relativePath);
    if (!existsSync(fullPath)) {
      return fallback;
    }
    const contents = readFileSync(fullPath, 'utf-8');
    return JSON.parse(contents) as T;
  } catch (error) {
    return fallback;
  }
};

const readFixtureText = (relativePath: string, fallback: string): string => {
  try {
    const fullPath = path.join(fixturesDir, relativePath);
    if (!existsSync(fullPath)) {
      return fallback;
    }
    return readFileSync(fullPath, 'utf-8');
  } catch (error) {
    return fallback;
  }
};

const fixtureVoice = (input: z.infer<typeof voiceInputSchema>) => {
  const base = readFixtureJson('voice/moon.json', {
    persona: 'robot',
    text: '🤖 Beep! The Moon is Earth’s rocky neighbor. Its craters were made by space rocks. It looks bright because it reflects sunlight!',
    blocked: false,
    ssml: undefined as string | undefined
  });
  const flair = input.persona === 'fairy' ? '✨ ' : input.persona === 'explorer' ? '🧭 ' : '🤖 ';
  const mentionMoon = input.text.toLowerCase().includes('moon');
  const text = mentionMoon
    ? base.text
    : 'Hi friend! I can answer with a happy, simple voice. Ask me about space, animals, or stories!';
  return {
    blocked: false,
    message: undefined as string | undefined,
    persona: input.persona,
    text: `${flair}${text.replace(/^([🤖✨🧭]\s)?/, '')}`,
    ssml: base.ssml,
    source: 'fixture' as const
  };
};

const fixturePanels = (input: z.infer<typeof storyPanelsSchema>) => {
  const panels = readFixtureJson('comics/dragon4.json', [
    { title: 'Quiet Cave', caption: 'Dara the dragon peeks out, small and shy.' },
    { title: 'A Small Hello', caption: 'A tiny fox waves its tail.' },
    { title: 'Sharing Snacks', caption: 'Blueberries make everyone smile.' },
    { title: 'New Friends', caption: 'Warm hugs. Big brave grin.' }
  ]);
  return {
    blocked: false,
    message: undefined as string | undefined,
    theme: input.theme,
    panels: panels.slice(0, input.panels).map((panel) => ({
      title: panel.title,
      caption: panel.caption,
      imagePrompt: `${panel.title} illustration in soft lines`,
      imageUrl: null
    })),
    source: 'fixture' as const
  };
};

const fixtureColoring = () => ({
  blocked: false,
  message: undefined as string | undefined,
  svg: readFixtureText('coloring/space-cat.svg',
    '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><g stroke="#000" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><circle cx="512" cy="512" r="400"/><path d="M380 450 q132 -180 264 0" /><circle cx="440" cy="500" r="30"/><circle cx="584" cy="500" r="30"/><path d="M512 540 q40 30 80 0" /><path d="M420 420 l-40 -80 l80 40 z" /><path d="M604 420 l40 -80 l-80 40 z" /><path d="M360 640 q152 120 304 0" /><circle cx="780" cy="360" r="36"/><circle cx="820" cy="320" r="18"/></g></svg>'),
  source: 'fixture' as const
});

const fixtureScience = (input: z.infer<typeof scienceSimSchema>) => {
  const base = readFixtureJson('science/buoyancy.json', {
    title: 'Float or Sink?',
    objective: 'Explore why some things float.',
    materials: ['Bowl of water', 'Orange', 'Spoon', 'Paper clip'],
    steps: ['Fill the bowl', 'Guess float/sink', 'Place each item', 'Observe'],
    prediction: {
      question: 'What happens to the orange?',
      choices: ['Floats with peel', 'Sinks with peel', 'Spins like a top'],
      answerIndex: 0
    },
    explanation: 'The peel traps tiny air pockets, helping it float.',
    supervision: 'Ask an adult to help with water spills.',
    blocked: false
  });
  return {
    blocked: false,
    message: undefined as string | undefined,
    title: base.title,
    objective: base.objective,
    materials: base.materials,
    steps: base.steps,
    prediction: base.prediction,
    explanation: base.explanation,
    supervision: base.supervision,
    source: 'fixture' as const,
    topic: input.topic
  };
};

export const registerTools = (
  server: McpServer,
  { networkIdentity = 'unknown' }: { networkIdentity?: string } = {},
): void => {
  const parentCreateTool = {
    name: 'parent_profile_create',
    title: 'Create Parent Profile',
    description: 'Create a parent-gated Kidbot profile for saved metadata history',
    inputSchema: parentProfileCreateSchema,
    outputSchema: parentProfileCreateToolOutputSchema,
    resultSchema: parentProfileCreateToolOutputUnion,
    successSchema: parentProfileCreateSuccessSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    appOnly: true,
  };
  registerKidbotTool(server, parentCreateTool.name, parentCreateTool, async (input: unknown, extra) =>
    runControlled(parentCreateTool.name, input, extra as ToolRequestExtra, networkIdentity, async () => {
      const parsed = parentProfileCreateSchema.parse(input);
      const profile = await parentProfileStore.createProfile(parsed);
      const { parentAccessToken, ...publicProfile } = profile;
      return {
      content: [
        {
          type: 'text' as const,
          text: profile.historyEnabled ? 'Parent profile ready.' : 'Parent profile storage is disabled.'
        }
      ],
      structuredContent: publicProfile,
      _meta: {
        ...outputMeta,
        parentAccessToken,
        'openai/widgetAccessible': true
      }
      };
    }));

  const parentUpdateTool = {
    name: 'parent_profile_update',
    title: 'Update Parent Profile',
    description: 'Update parent-gated Kidbot profile settings',
    inputSchema: parentProfileUpdateSchema,
    outputSchema: parentProfileUpdateToolOutputSchema,
    resultSchema: parentProfileUpdateToolOutputUnion,
    successSchema: parentProfileUpdateSuccessSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
    appOnly: true,
  };
  registerKidbotTool(server, parentUpdateTool.name, parentUpdateTool, async (input: unknown, extra) =>
    runControlled(parentUpdateTool.name, input, extra as ToolRequestExtra, networkIdentity, async () => {
      const parsed = parentProfileUpdateSchema.parse(input);
      const profile = await parentProfileStore.updateProfile(parsed);
      return {
      content: [
        {
          type: 'text' as const,
          text: 'Parent profile updated.'
        }
      ],
      structuredContent: profile as unknown as Record<string, unknown>,
      _meta: {
        ...outputMeta,
        'openai/widgetAccessible': true
      }
      };
    }));

  const parentDeleteTool = {
    name: 'parent_profile_delete',
    title: 'Delete Parent Profile',
    description: 'Permanently delete a parent-gated Kidbot profile and its saved metadata history',
    inputSchema: parentProfileDeleteSchema,
    outputSchema: parentProfileDeleteToolOutputSchema,
    resultSchema: parentProfileDeleteToolOutputUnion,
    successSchema: parentProfileDeleteSuccessSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    appOnly: true,
  };
  registerKidbotTool(server, parentDeleteTool.name, parentDeleteTool, async (input: unknown, extra) =>
    runControlled(parentDeleteTool.name, input, extra as ToolRequestExtra, networkIdentity, async () => {
      const parsed = parentProfileDeleteSchema.parse(input);
      const result = await parentProfileStore.deleteProfile(parsed);
      return {
        content: [{ type: 'text' as const, text: 'Parent profile deleted.' }],
        structuredContent: result,
        _meta: {
          ...outputMeta,
          'openai/widgetAccessible': true
        }
      };
    }));

  const parentHistoryTool = {
    name: 'parent_history_list',
    title: 'List Parent History',
    description: 'List saved Kidbot session metadata for parent review; viewing history counts as activity and renews the 30-day retention window',
    inputSchema: parentHistoryListSchema,
    outputSchema: parentHistoryListToolOutputSchema,
    resultSchema: parentHistoryListToolOutputUnion,
    successSchema: parentHistoryListSuccessSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    appOnly: true,
  };
  registerKidbotTool(server, parentHistoryTool.name, parentHistoryTool, async (input: unknown, extra) =>
    runControlled(parentHistoryTool.name, input, extra as ToolRequestExtra, networkIdentity, async () => {
      const parsed = parentHistoryListSchema.parse(input);
      const events = await parentProfileStore.listHistory(parsed);
      return {
      content: [
        {
          type: 'text' as const,
          text: `Found ${events.length} saved history events.`
        }
      ],
      structuredContent: { events },
      _meta: {
        ...outputMeta,
        'openai/widgetAccessible': true
      }
      };
    }));

  const voiceTool = {
    name: 'voice_chat',
    title: 'Voice Chat',
    description: 'Kid-friendly persona voice replies',
    inputSchema: voiceInputSchema,
    outputSchema: voiceToolOutputSchema,
    resultSchema: voiceToolOutputUnion,
    successSchema: voiceSuccessSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
  };
  registerKidbotTool(server, voiceTool.name, voiceTool, async (input: unknown, extra) =>
    runControlled(voiceTool.name, input, extra as ToolRequestExtra, networkIdentity, async (signal) =>
      handleWithModeration(
        voiceInputSchema,
        input,
        voiceTool.name,
        (data) => [data.text ?? ''],
        async (data) =>
          fallbackMode
            ? Promise.resolve(fixtureVoice(data))
            : callAgent<{ blocked: boolean; message?: string; persona?: string; text?: string; ssml?: string }>(
                '/voice',
                stripParentAccessToken(data),
                signal,
              ),
        (data, response) =>
          response.blocked
            ? response.message ?? 'Kidbot paused this request.'
            : `${data.persona} reply ready! ${'text' in response ? response.text ?? '' : ''}`
      )));

  const storyTool = {
    name: 'story_panels',
    title: 'Story Panels',
    description: 'Plan bright story panels for comics',
    inputSchema: storyPanelsSchema,
    outputSchema: storyPanelsToolOutputSchema,
    resultSchema: storyPanelsToolOutputUnion,
    successSchema: storyPanelsSuccessSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
  };
  registerKidbotTool(server, storyTool.name, storyTool, async (input: unknown, extra) =>
    runControlled(storyTool.name, input, extra as ToolRequestExtra, networkIdentity, async (signal) =>
      handleWithModeration(
        storyPanelsSchema,
        input,
        storyTool.name,
        (data) => [data.theme ?? ''],
        async (data) =>
          fallbackMode
            ? Promise.resolve(fixturePanels(data))
            : callAgent<{ blocked: boolean; message?: string; theme?: string; panels?: unknown[] }>(
                '/story-panels',
                stripParentAccessToken(data),
                signal,
              ),
        (data, response) =>
          response.blocked
            ? response.message ?? 'Story paused for safety.'
            : `Planned ${data.panels} panels about ${data.theme}.`
      )));

  const coloringTool = {
    name: 'coloring_outline',
    title: 'Coloring Outline',
    description: 'Generate a coloring page outline',
    inputSchema: coloringOutlineSchema,
    outputSchema: coloringOutlineToolOutputSchema,
    resultSchema: coloringOutlineToolOutputUnion,
    successSchema: coloringOutlineSuccessSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
  };
  registerKidbotTool(server, coloringTool.name, coloringTool, async (input: unknown, extra) =>
    runControlled(coloringTool.name, input, extra as ToolRequestExtra, networkIdentity, async (signal) =>
      handleWithModeration(
        coloringOutlineSchema,
        input,
        coloringTool.name,
        (data) => [data.scene ?? ''],
        async (data) =>
          fallbackMode
            ? Promise.resolve(fixtureColoring())
            : callAgent<{ blocked: boolean; message?: string; svg?: string }>(
                '/coloring-outline', stripParentAccessToken(data), signal,
              ),
        (data, response) =>
          response.blocked ? response.message ?? 'Coloring outline blocked.' : `Outline ready for ${data.scene}.`
      )));

  const scienceTool = {
    name: 'science_sim',
    title: 'Science Simulation',
    description: 'Kid-safe science experiment cards',
    inputSchema: scienceSimSchema,
    outputSchema: scienceSimToolOutputSchema,
    resultSchema: scienceSimToolOutputUnion,
    successSchema: scienceSimSuccessSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
  };
  registerKidbotTool(server, scienceTool.name, scienceTool, async (input: unknown, extra) =>
    runControlled(scienceTool.name, input, extra as ToolRequestExtra, networkIdentity, async (signal) =>
      handleWithModeration(
        scienceSimSchema,
        input,
        scienceTool.name,
        (data) => [data.topic ?? '', kidTone((data.ageBand ?? '7-9') as '4-6' | '7-9' | '10-12')],
        async (data) =>
          fallbackMode
            ? Promise.resolve(fixtureScience(data))
            : callAgent<{
                blocked: boolean;
                message?: string;
                title?: string;
                objective?: string;
                steps?: string[];
              }>('/science-sim', stripParentAccessToken(data), signal),
        (data, response) =>
          response.blocked
            ? response.message ?? 'Science sim paused.'
            : `Science lab ready for ${data.topic}.`
      )));
};
