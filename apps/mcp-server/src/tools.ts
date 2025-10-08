import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  coloringOutlineSchema,
  scienceSimSchema,
  storyPanelsSchema,
  voiceInputSchema
} from './schema.js';
import { kidTone, moderate } from './safety.js';

const agentPort = Number(process.env.AGENT_PORT ?? 4505);
const agentBaseUrl = `http://localhost:${agentPort}`;
const outputMeta = {
  'openai/outputTemplate': 'ui://widget/kidbot.html',
  'openai/widgetDescription': 'KidBot — safe creative play: voice, comics, coloring, science.',
  'openai/widgetCSP': {
    connect_domains: [] as string[],
    resource_domains: [] as string[]
  }
};

const callAgent = async <T>(path: string, payload: unknown): Promise<T> => {
  if (process.env.FALLBACK_WIDGET === '1') {
    throw new Error('Agent disabled in fallback mode');
  }
  const response = await fetch(`${agentBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.OPENAI_API_KEY ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } : {})
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Agent request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
};

const blockedResponse = (message: string) => ({
  content: [
    {
      type: 'text',
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

const handleWithModeration = async <Schema extends z.ZodTypeAny, ResponseType extends { blocked: boolean; message?: string }>(
  schema: Schema,
  payload: unknown,
  validator: (input: z.infer<Schema>) => string[],
  action: (input: z.infer<Schema>) => Promise<ResponseType>,
  transcript: (input: z.infer<Schema>, response: ResponseType) => string
) => {
  const parsed = schema.parse(payload);
  const toModerate = validator(parsed).join(' ');
  const preCheck = moderate(toModerate);
  if (preCheck.blocked) {
    return blockedResponse(preCheck.message ?? 'Let\'s try a different friendly idea.');
  }

  const agentResponse = await action(parsed);
  if (agentResponse.blocked) {
    return blockedResponse(agentResponse.message ?? 'Let\'s pick another playful request.');
  }

  const transcriptText = transcript(parsed, agentResponse);
  const postCheck = moderate(transcriptText);
  if (postCheck.blocked) {
    return blockedResponse(postCheck.message ?? 'Let\'s stick with cheerful topics.');
  }

  return {
    content: [
      {
        type: 'text',
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
    persona: input.persona,
    text: `${flair}${text.replace(/^([🤖✨🧭]\s)?/u, '')}`,
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
  const toolsApi: { registerTool?: (config: unknown) => void; tool?: (config: unknown) => void } =
    server as unknown as { registerTool?: (config: unknown) => void; tool?: (config: unknown) => void };
  const register = toolsApi.tool ?? toolsApi.registerTool;
  if (typeof register !== 'function') {
    throw new Error('MCP server does not expose a tool registration method');
  }

  register({
    name: 'voice_chat',
    description: 'Kid-friendly persona voice replies',
    metadata: { 'openai/widgetAccessible': true },
    inputSchema: voiceInputSchema,
    execute: async ({ input }: { input: unknown }) =>
      handleWithModeration(
        voiceInputSchema,
        input,
        (data) => [data.text ?? ''],
        async (data) =>
          process.env.FALLBACK_WIDGET === '1'
            ? Promise.resolve(fixtureVoice(data))
            : callAgent<{ blocked: boolean; message?: string; persona?: string; text?: string; ssml?: string }>(
                '/voice',
                data
              ),
        (data, response) =>
          response.blocked
            ? response.message ?? 'KidBot paused this request.'
            : `${data.persona} reply ready! ${response.text ?? ''}`
      )
  });

  register({
    name: 'story_panels',
    description: 'Plan bright story panels for comics',
    metadata: { 'openai/widgetAccessible': true },
    inputSchema: storyPanelsSchema,
    execute: async ({ input }: { input: unknown }) =>
      handleWithModeration(
        storyPanelsSchema,
        input,
        (data) => [data.theme ?? ''],
        async (data) =>
          process.env.FALLBACK_WIDGET === '1'
            ? Promise.resolve(fixturePanels(data))
            : callAgent<{ blocked: boolean; message?: string; theme?: string; panels?: unknown[] }>(
                '/story-panels',
                data
              ),
        (data, response) =>
          response.blocked
            ? response.message ?? 'Story paused for safety.'
            : `Planned ${data.panels} panels about ${data.theme}.`
      )
  });

  register({
    name: 'coloring_outline',
    description: 'Generate a coloring page outline',
    metadata: { 'openai/widgetAccessible': true },
    inputSchema: coloringOutlineSchema,
    execute: async ({ input }: { input: unknown }) =>
      handleWithModeration(
        coloringOutlineSchema,
        input,
        (data) => [data.scene ?? ''],
        async (data) =>
          process.env.FALLBACK_WIDGET === '1'
            ? Promise.resolve(fixtureColoring())
            : callAgent<{ blocked: boolean; message?: string; svg?: string }>('/coloring-outline', data),
        (data, response) =>
          response.blocked ? response.message ?? 'Coloring outline blocked.' : `Outline ready for ${data.scene}.`
      )
  });

  register({
    name: 'science_sim',
    description: 'Kid-safe science experiment cards',
    metadata: { 'openai/widgetAccessible': true },
    inputSchema: scienceSimSchema,
    execute: async ({ input }: { input: unknown }) =>
      handleWithModeration(
        scienceSimSchema,
        input,
        (data) => [data.topic ?? '', kidTone((data.ageBand ?? '7-9') as '4-6' | '7-9' | '10-12')],
        async (data) =>
          process.env.FALLBACK_WIDGET === '1'
            ? Promise.resolve(fixtureScience(data))
            : callAgent<{
                blocked: boolean;
                message?: string;
                title?: string;
                objective?: string;
                steps?: string[];
              }>('/science-sim', data),
        (data, response) =>
          response.blocked
            ? response.message ?? 'Science sim paused.'
            : `Science lab ready for ${data.topic}.`
      )
  });
};
