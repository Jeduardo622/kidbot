import 'dotenv/config';
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZodError } from 'zod';
import { craftVoiceReply } from './agents/voiceAgent.js';
import { generateColoringOutline } from './agents/imageAgent.js';
import { planStory } from './agents/storyAgent.js';
import { planExperiment } from './agents/experimentAgent.js';
import { correlationId } from './guardrails.js';
import {
  coloringRequestSchema,
  scienceRequestSchema,
  storyRequestSchema,
  voiceRequestSchema,
  type ColoringRequest,
  type ScienceRequest,
  type StoryRequest,
  type VoiceRequest
} from './types.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const configuredKey = process.env.OPENAI_API_KEY;

const authorization: RequestHandler = (req, res, next) => {
  if (!configuredKey) {
    next();
    return;
  }

  const header = req.headers.authorization;
  if (!header || header !== `Bearer ${configuredKey}`) {
    res.status(401).json({ error: 'Unauthorized', correlationId: correlationId() });
    return;
  }

  next();
};

app.use(authorization);

const withValidation = <T>(
  schema: {
    parse: (payload: unknown) => T;
  },
  handler: (payload: T) => Promise<unknown> | unknown
): RequestHandler => {
  return async (req, res) => {
    const id = correlationId();
    try {
      const parsed = schema.parse(req.body);
      const data = await handler(parsed);
      res.json({ correlationId: id, ...data });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ error: 'Bad Request', details: error.errors, correlationId: id });
        return;
      }

      res.status(500).json({ error: 'Internal Error', correlationId: id });
    }
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, '../../fixtures');

const readFixtureJson = <T>(relativePath: string, fallback: T): T => {
  try {
    const fullPath = path.join(fixturesDir, relativePath);
    if (!existsSync(fullPath)) {
      return fallback;
    }
    return JSON.parse(readFileSync(fullPath, 'utf-8')) as T;
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

const stubVoice = (payload: VoiceRequest) => {
  const base = readFixtureJson('voice/moon.json', {
    persona: 'robot',
    text: '🤖 Beep! The Moon is Earth’s rocky neighbor. Its craters were made by space rocks. It looks bright because it reflects sunlight!',
    ssml: '<speak>Beep! The Moon is Earth’s rocky neighbor. Its craters were made by space rocks. It looks bright because it reflects sunlight!</speak>'
  });
  const mentionMoon = payload.text.toLowerCase().includes('moon');
  const flair = payload.persona === 'fairy' ? '✨ ' : payload.persona === 'explorer' ? '🧭 ' : '🤖 ';
  const text = mentionMoon
    ? base.text
    : 'Hi friend! I can answer with a happy, simple voice. Ask me about space, animals, or stories!';
  return {
    blocked: false,
    persona: payload.persona,
    text: `${flair}${text.replace(/^([🤖✨🧭]\s)?/u, '')}`,
    ssml: base.ssml,
    source: 'stub' as const
  };
};

const stubStory = (payload: StoryRequest) => {
  const panels = readFixtureJson('comics/dragon4.json', [
    { title: 'Quiet Cave', caption: 'Dara the dragon peeks out, small and shy.' },
    { title: 'A Small Hello', caption: 'A tiny fox waves its tail.' },
    { title: 'Sharing Snacks', caption: 'Blueberries make everyone smile.' },
    { title: 'New Friends', caption: 'Warm hugs. Big brave grin.' }
  ]);
  return {
    blocked: false,
    theme: payload.theme,
    panels: panels.slice(0, payload.panels).map((panel) => ({
      title: panel.title,
      caption: panel.caption,
      imagePrompt: `${panel.title} illustration in soft lines`,
      imageUrl: null
    })),
    source: 'stub' as const
  };
};

const stubColoring = () => ({
  blocked: false,
  svg: readFixtureText('coloring/space-cat.svg',
    '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><g stroke="#000" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><circle cx="512" cy="512" r="400"/><path d="M380 450 q132 -180 264 0" /><circle cx="440" cy="500" r="30"/><circle cx="584" cy="500" r="30"/><path d="M512 540 q40 30 80 0" /><path d="M420 420 l-40 -80 l80 40 z" /><path d="M604 420 l40 -80 l-80 40 z" /><path d="M360 640 q152 120 304 0" /><circle cx="780" cy="360" r="36"/><circle cx="820" cy="320" r="18"/></g></svg>'),
  source: 'stub' as const
});

const stubScience = (payload: ScienceRequest) => {
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
    supervision: 'Ask an adult to help with water spills.'
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
    topic: payload.topic,
    source: 'stub' as const
  };
};

const useStub = !configuredKey || process.env.FALLBACK_WIDGET === '1';

app.post(
  '/voice',
  withValidation<VoiceRequest>(voiceRequestSchema, async (payload) => {
    if (useStub) {
      return stubVoice(payload);
    }
    try {
      const response = craftVoiceReply(payload);
      return response.blocked ? response : { ...response, source: 'local' as const };
    } catch (error) {
      return stubVoice(payload);
    }
  })
);
app.post(
  '/story-panels',
  withValidation<StoryRequest>(storyRequestSchema, async (payload) => {
    if (useStub) {
      return stubStory(payload);
    }
    try {
      const response = planStory(payload);
      return response.blocked ? response : { ...response, source: 'local' as const };
    } catch (error) {
      return stubStory(payload);
    }
  })
);
app.post(
  '/coloring-outline',
  withValidation<ColoringRequest>(coloringRequestSchema, async (payload) => {
    if (useStub) {
      return stubColoring();
    }
    try {
      const response = generateColoringOutline(payload);
      return response.blocked ? response : { ...response, source: 'local' as const };
    } catch (error) {
      return stubColoring();
    }
  })
);
app.post(
  '/science-sim',
  withValidation<ScienceRequest>(scienceRequestSchema, async (payload) => {
    if (useStub) {
      return stubScience(payload);
    }
    try {
      const response = planExperiment(payload);
      return response.blocked ? response : { ...response, source: 'local' as const };
    } catch (error) {
      return stubScience(payload);
    }
  })
);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  void _next;
  res.status(500).json({ error: 'Internal Error', message: err.message, correlationId: correlationId() });
});

const port = Number(process.env.PORT ?? process.env.AGENT_PORT ?? 4505);

export const start = () =>
  app.listen(port, () => {
    console.log(`Agent service listening on http://localhost:${port}`);
  });

if (process.env.NODE_ENV !== 'test') {
  const server = start();
  process.on('SIGTERM', () => {
    server.close();
  });

  process.on('SIGINT', () => {
    server.close();
  });
}

export { app };
