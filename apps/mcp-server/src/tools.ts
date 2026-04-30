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
  parentProfileUpdateSchema,
  scienceSimSchema,
  storyPanelsSchema,
  voiceInputSchema
} from './schema.js';
import { mcpConfig } from './config.js';
import { createParentProfileStoreFromConfig, type AgeBand, type ParentHistoryEvent } from './parentStore.js';
import { kidTone, moderate } from './safety.js';

const { agentBaseUrl, fallbackMode, serviceAuthToken, startupPosture } = mcpConfig;
export const parentProfileStore = createParentProfileStoreFromConfig(mcpConfig);
const degradedServiceMessage = 'Kidbot is having trouble reaching its idea engine right now. Please try again in a moment.';
const outputMeta = {
  'openai/outputTemplate': 'ui://widget/kidbot.html',
  'openai/widgetDescription': 'Kidbot — safe creative play: voice, comics, coloring, science.',
  'openai/widgetCSP': {
    connect_domains: [] as string[],
    resource_domains: [] as string[]
  }
};

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

const callAgent = async <T>(path: string, payload: unknown): Promise<T | AgentDegradedResponse> => {
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
    body: JSON.stringify(payload)
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

export const registerTools = (server: McpServer): void => {
  const parentCreateTool = {
    name: 'parent_profile_create',
    description: 'Create a parent-gated Kidbot profile for saved metadata history',
    _meta: { 'openai/widgetAccessible': true },
    inputSchema: parentProfileCreateSchema
  };
  server.registerTool(parentCreateTool.name, parentCreateTool, async (input: unknown) => {
    const parsed = parentProfileCreateSchema.parse(input);
    const profile = await parentProfileStore.createProfile(parsed);
    return {
      content: [
        {
          type: 'text' as const,
          text: profile.historyEnabled ? 'Parent profile ready.' : 'Parent profile storage is disabled.'
        }
      ],
      structuredContent: profile as unknown as Record<string, unknown>,
      _meta: {
        ...outputMeta,
        'openai/widgetAccessible': true
      }
    };
  });

  const parentUpdateTool = {
    name: 'parent_profile_update',
    description: 'Update parent-gated Kidbot profile settings',
    _meta: { 'openai/widgetAccessible': true },
    inputSchema: parentProfileUpdateSchema
  };
  server.registerTool(parentUpdateTool.name, parentUpdateTool, async (input: unknown) => {
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
  });

  const parentHistoryTool = {
    name: 'parent_history_list',
    description: 'List saved Kidbot session metadata for parent review',
    _meta: { 'openai/widgetAccessible': true },
    inputSchema: parentHistoryListSchema
  };
  server.registerTool(parentHistoryTool.name, parentHistoryTool, async (input: unknown) => {
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
  });

  const voiceTool = {
    name: 'voice_chat',
    description: 'Kid-friendly persona voice replies',
    _meta: { 'openai/widgetAccessible': true },
    inputSchema: voiceInputSchema
  };
  server.registerTool(voiceTool.name, voiceTool, async (input: unknown) =>
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
                stripParentAccessToken(data)
              ),
        (data, response) =>
          response.blocked
            ? response.message ?? 'Kidbot paused this request.'
            : `${data.persona} reply ready! ${'text' in response ? response.text ?? '' : ''}`
      ));

  const storyTool = {
    name: 'story_panels',
    description: 'Plan bright story panels for comics',
    _meta: { 'openai/widgetAccessible': true },
    inputSchema: storyPanelsSchema
  };
  server.registerTool(storyTool.name, storyTool, async (input: unknown) =>
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
                stripParentAccessToken(data)
              ),
        (data, response) =>
          response.blocked
            ? response.message ?? 'Story paused for safety.'
            : `Planned ${data.panels} panels about ${data.theme}.`
      ));

  const coloringTool = {
    name: 'coloring_outline',
    description: 'Generate a coloring page outline',
    _meta: { 'openai/widgetAccessible': true },
    inputSchema: coloringOutlineSchema
  };
  server.registerTool(coloringTool.name, coloringTool, async (input: unknown) =>
      handleWithModeration(
        coloringOutlineSchema,
        input,
        coloringTool.name,
        (data) => [data.scene ?? ''],
        async (data) =>
          fallbackMode
            ? Promise.resolve(fixtureColoring())
            : callAgent<{ blocked: boolean; message?: string; svg?: string }>('/coloring-outline', stripParentAccessToken(data)),
        (data, response) =>
          response.blocked ? response.message ?? 'Coloring outline blocked.' : `Outline ready for ${data.scene}.`
      ));

  const scienceTool = {
    name: 'science_sim',
    description: 'Kid-safe science experiment cards',
    _meta: { 'openai/widgetAccessible': true },
    inputSchema: scienceSimSchema
  };
  server.registerTool(scienceTool.name, scienceTool, async (input: unknown) =>
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
              }>('/science-sim', stripParentAccessToken(data)),
        (data, response) =>
          response.blocked
            ? response.message ?? 'Science sim paused.'
            : `Science lab ready for ${data.topic}.`
      ));
};
