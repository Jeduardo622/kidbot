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
import { parseAgentServiceConfig } from './config.js';
import { correlationId, moderate } from './guardrails.js';
import {
  ProviderError,
  ProviderUnavailableError,
  bindProviderSignal,
  classifyProviderError,
  createOpenAIProvider,
  parseProviderFailurePolicy,
  safeProviderErrorSummary,
} from './provider.js';
import { createRateLimiter, createRateLimitStoreFromEnv } from './rateLimit.js';
import { createLogSubject } from './privacyLog.js';
import { safeFallbackSvg, validateColoringSvg } from './svgSafety.js';
import {
  cleanupExpiredImageAssets,
  createImageAssetStore,
  parseImageAssetStorageConfig,
} from './imageAssetStore.js';
import {
  coloringRequestSchema,
  defaultAgeBand,
  scienceRequestSchema,
  storyRequestSchema,
  voiceRequestSchema,
  type ColoringRequest,
  type ScienceRequest,
  type StoryRequest,
  type VoiceRequest,
} from './types.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const config = parseAgentServiceConfig();
const {
  providerApiKey,
  serviceAuthToken,
  logSubjectSecret,
  fallbackMode,
  requireServiceAuth,
  startupPosture,
  port,
} = config;
const providerFailurePolicy = parseProviderFailurePolicy(process.env);
const imageAssetStorageConfig = parseImageAssetStorageConfig(process.env);
const imageAssetStore = createImageAssetStore(imageAssetStorageConfig);

if (imageAssetStorageConfig.mode !== 'data-url') {
  void cleanupExpiredImageAssets(imageAssetStorageConfig);
}

const authorization: RequestHandler = (req, res, next) => {
  const postureHeaderRaw = req.headers['x-kidbot-startup-posture'];
  const postureHeader = Array.isArray(postureHeaderRaw) ? postureHeaderRaw[0] : postureHeaderRaw;
  if (postureHeader && postureHeader !== startupPosture) {
    res.status(409).json({
      error: 'Startup posture mismatch',
      details: `Request posture "${postureHeader}" does not match service posture "${startupPosture}".`,
      correlationId: correlationId(),
    });
    return;
  }

  if (!requireServiceAuth) {
    next();
    return;
  }

  const header = req.headers.authorization;
  if (!header || header !== `Bearer ${serviceAuthToken ?? ''}`) {
    res.status(401).json({ error: 'Unauthorized', correlationId: correlationId() });
    return;
  }

  if (postureHeader !== 'secured') {
    res.status(409).json({
      error: 'Startup posture mismatch',
      details: 'Secured posture requests must include x-kidbot-startup-posture=secured.',
      correlationId: correlationId(),
    });
    return;
  }

  next();
};

const perMinute = 60_000;
const rateLimitStore = createRateLimitStoreFromEnv();

app.get('/healthz', (_req, res, next) => {
  void (async () => {
    const id = correlationId();
    res.locals.correlationId = id;
    const limiter = await rateLimitStore.readiness();
    const body = {
      ok: limiter.ready,
      service: 'agent-service',
      startupPosture,
      rateLimitStore: limiter,
      correlationId: id,
    };
    res.locals.outputLength = JSON.stringify(body).length;
    res.status(limiter.ready ? 200 : 503).json(body);
  })().catch(next);
});

app.get('/generated-images/:filename([a-f0-9-]+\\.png)', (req, res) => {
  if (imageAssetStorageConfig.mode !== 'local') {
    res.status(404).json({ error: 'Not Found', correlationId: correlationId() });
    return;
  }

  const filename = req.params.filename;
  if (!filename) {
    res.status(404).json({ error: 'Not Found', correlationId: correlationId() });
    return;
  }

  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.resolve(imageAssetStorageConfig.directory, filename), (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({ error: 'Not Found', correlationId: correlationId() });
    }
  });
});

app.use(authorization);

const withValidation = <T>(
  schema: {
    parse: (payload: unknown) => T;
  },
  handler: (payload: T, signal: AbortSignal) => Promise<unknown> | unknown,
): RequestHandler => {
  return (req, res, next) => {
    void (async () => {
      const id = correlationId();
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      req.once('aborted', abortRequest);
      res.once('close', () => {
        if (!res.writableEnded) abortRequest();
      });
      res.locals.correlationId = id;
      try {
        const parsed = schema.parse(req.body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const metadata = parsed as {
            ageBand?: unknown;
            profileId?: unknown;
            sessionId?: unknown;
          };
          res.locals.sessionId =
            typeof metadata.sessionId === 'string' ? metadata.sessionId : undefined;
          res.locals.profileId =
            typeof metadata.profileId === 'string' ? metadata.profileId : undefined;
          res.locals.ageBand =
            typeof metadata.ageBand === 'string' ? metadata.ageBand : defaultAgeBand;
        }
        const data = await handler(parsed, requestController.signal);
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('Handler must return an object payload.');
        }
        const body: Record<string, unknown> = {
          correlationId: id,
          ...(data as Record<string, unknown>),
        };
        res.locals.source = body.source;
        res.locals.blocked = body.blocked;
        res.locals.providerFallback = body.providerFallback;
        res.locals.fallbackReason = body.fallbackReason;
        res.locals.outputLength = JSON.stringify(body).length;
        res.json(body);
      } catch (error) {
        if (error instanceof ZodError) {
          const body = { error: 'Bad Request', details: error.errors, correlationId: id };
          res.locals.outputLength = JSON.stringify(body).length;
          res.status(400).json(body);
          return;
        }

        if (error instanceof ProviderError) {
          const fallbackReason = classifyProviderError(error);
          const body = {
            error: 'Service temporarily degraded',
            fallbackReason,
            correlationId: id,
          };
          res.locals.providerFallback = false;
          res.locals.fallbackReason = fallbackReason;
          res.locals.outputLength = JSON.stringify(body).length;
          res.status(503).json(body);
          return;
        }

        // eslint-disable-next-line no-console
        console.warn(JSON.stringify({ route: req.path, error: safeProviderErrorSummary(error) }));
        const body = { error: 'Internal Error', correlationId: id };
        res.locals.outputLength = JSON.stringify(body).length;
        res.status(500).json(body);
      }
    })().catch(next);
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
  const inputModeration = moderate(payload.text);
  if (inputModeration.blocked) {
    return { blocked: true, message: inputModeration.message, source: 'stub' as const };
  }

  const base = readFixtureJson('voice/moon.json', {
    persona: 'robot',
    text: '🤖 Beep! The Moon is Earth’s rocky neighbor. Its craters were made by space rocks. It looks bright because it reflects sunlight!',
    ssml: '<speak>Beep! The Moon is Earth’s rocky neighbor. Its craters were made by space rocks. It looks bright because it reflects sunlight!</speak>',
  });
  const mentionMoon = payload.text.toLowerCase().includes('moon');
  const flair =
    payload.persona === 'fairy' ? '✨ ' : payload.persona === 'explorer' ? '🧭 ' : '🤖 ';
  const text = mentionMoon
    ? base.text
    : 'Hi friend! I can answer with a happy, simple voice. Ask me about space, animals, or stories!';
  return {
    blocked: false,
    persona: payload.persona,
    text: `${flair}${text.replace(/^([🤖✨🧭]\s)?/, '')}`,
    ssml: base.ssml,
    source: 'stub' as const,
  };
};

const stubStory = (payload: StoryRequest) => {
  const inputModeration = moderate(payload.theme);
  if (inputModeration.blocked) {
    return { blocked: true, message: inputModeration.message, source: 'stub' as const };
  }

  const panels = readFixtureJson('comics/dragon4.json', [
    { title: 'Quiet Cave', caption: 'Dara the dragon peeks out, small and shy.' },
    { title: 'A Small Hello', caption: 'A tiny fox waves its tail.' },
    { title: 'Sharing Snacks', caption: 'Blueberries make everyone smile.' },
    { title: 'New Friends', caption: 'Warm hugs. Big brave grin.' },
  ]);
  return {
    blocked: false,
    theme: payload.theme,
    panels: panels.slice(0, payload.panels).map((panel) => ({
      title: panel.title,
      caption: panel.caption,
      imagePrompt: `${panel.title} illustration in soft lines`,
      imageUrl: null,
    })),
    source: 'stub' as const,
  };
};

const stubColoring = (payload: ColoringRequest) => {
  const inputModeration = moderate(payload.scene);
  if (inputModeration.blocked) {
    return { blocked: true, message: inputModeration.message, source: 'stub' as const };
  }

  const fixtureSvg = readFixtureText(
    'coloring/space-cat.svg',
    '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><g stroke="#000" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><circle cx="512" cy="512" r="400"/><path d="M380 450 q132 -180 264 0" /><circle cx="440" cy="500" r="30"/><circle cx="584" cy="500" r="30"/><path d="M512 540 q40 30 80 0" /><path d="M420 420 l-40 -80 l80 40 z" /><path d="M604 420 l40 -80 l-80 40 z" /><path d="M360 640 q152 120 304 0" /><circle cx="780" cy="360" r="36"/><circle cx="820" cy="320" r="18"/></g></svg>',
  );
  const validated = validateColoringSvg(fixtureSvg);
  return {
    blocked: false,
    svg: validated.svg ?? safeFallbackSvg(),
    source: 'stub' as const,
  };
};

const stubScience = (payload: ScienceRequest) => {
  const inputModeration = moderate(payload.topic);
  if (inputModeration.blocked) {
    return { blocked: true, message: inputModeration.message, source: 'stub' as const };
  }

  const base = readFixtureJson('science/buoyancy.json', {
    title: 'Float or Sink?',
    objective: 'Explore why some things float.',
    materials: ['Bowl of water', 'Orange', 'Spoon', 'Paper clip'],
    steps: ['Fill the bowl', 'Guess float/sink', 'Place each item', 'Observe'],
    prediction: {
      question: 'What happens to the orange?',
      choices: ['Floats with peel', 'Sinks with peel', 'Spins like a top'],
      answerIndex: 0,
    },
    explanation: 'The peel traps tiny air pockets, helping it float.',
    supervision: 'Ask an adult to help with water spills.',
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
    source: 'stub' as const,
  };
};

const useStub = !providerApiKey || fallbackMode;
const provider = useStub ? undefined : createOpenAIProvider(providerApiKey);

const providerFailureFallback = <T extends Record<string, unknown>>(
  route: string,
  error: unknown,
  fallback: () => T,
): T => {
  const fallbackReason = classifyProviderError(error);
  if (!providerFailurePolicy.allowFallback) {
    throw error instanceof ProviderError
      ? error
      : new ProviderUnavailableError();
  }

  // eslint-disable-next-line no-console
  console.warn(
    JSON.stringify({
      route,
      providerFallback: true,
      fallbackReason,
      providerError: safeProviderErrorSummary(error),
    }),
  );

  return {
    ...fallback(),
    providerFallback: true,
    fallbackReason,
  };
};

app.use((req, res, next) => {
  const startedAt = Date.now();
  const inputLength = JSON.stringify(req.body ?? {}).length;
  res.on('finish', () => {
    const summary = {
      correlationId: res.locals.correlationId as string | undefined,
      route: req.path,
      status: res.statusCode,
      latencyMs: Date.now() - startedAt,
      sessionRef: createLogSubject(
        logSubjectSecret,
        'session',
        res.locals.sessionId as string | undefined,
      ),
      profileRef: createLogSubject(
        logSubjectSecret,
        'profile',
        res.locals.profileId as string | undefined,
      ),
      ageBand: res.locals.ageBand as string | undefined,
      source: res.locals.source as string | undefined,
      blocked: res.locals.blocked as boolean | undefined,
      inputLength,
      outputLength: res.locals.outputLength as number | undefined,
      providerFallback: res.locals.providerFallback as boolean | undefined,
      fallbackReason: res.locals.fallbackReason as string | undefined,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary));
  });
  next();
});

const voiceRateLimit = createRateLimiter({
  limit: 60,
  windowMs: perMinute,
  store: rateLimitStore,
  keyPrefix: 'voice',
});
const storyRateLimit = createRateLimiter({
  limit: 20,
  windowMs: perMinute,
  store: rateLimitStore,
  keyPrefix: 'story',
});
const coloringRateLimit = createRateLimiter({
  limit: 15,
  windowMs: perMinute,
  store: rateLimitStore,
  keyPrefix: 'coloring',
});
const scienceRateLimit = createRateLimiter({
  limit: 20,
  windowMs: perMinute,
  store: rateLimitStore,
  keyPrefix: 'science',
});

app.post(
  '/voice',
  voiceRateLimit,
  withValidation<VoiceRequest>(voiceRequestSchema, async (payload, signal) => {
    if (useStub) {
      return stubVoice(payload);
    }
    try {
      const requestProvider = provider ? bindProviderSignal(provider, signal) : undefined;
      const response = requestProvider
        ? await craftVoiceReply(payload, requestProvider)
        : craftVoiceReply(payload);
      return response.blocked ? response : { ...response, source: 'agent' as const };
    } catch (error) {
      return providerFailureFallback('/voice', error, () => stubVoice(payload));
    }
  }),
);
app.post(
  '/story-panels',
  storyRateLimit,
  withValidation<StoryRequest>(storyRequestSchema, async (payload, signal) => {
    if (useStub) {
      return stubStory(payload);
    }
    try {
      const requestProvider = provider ? bindProviderSignal(provider, signal) : undefined;
      const response = requestProvider
        ? await planStory(payload, requestProvider, {
            resolveGeneratedImageUrl: (_panel, pngBase64) =>
              imageAssetStore.storePngBase64(pngBase64),
          })
        : planStory(payload);
      return response.blocked ? response : { ...response, source: 'agent' as const };
    } catch (error) {
      return providerFailureFallback('/story-panels', error, () => stubStory(payload));
    }
  }),
);
app.post(
  '/coloring-outline',
  coloringRateLimit,
  withValidation<ColoringRequest>(coloringRequestSchema, async (payload, signal) => {
    if (useStub) {
      return stubColoring(payload);
    }
    try {
      const requestProvider = provider ? bindProviderSignal(provider, signal) : undefined;
      const response = requestProvider
        ? await generateColoringOutline(payload, requestProvider)
        : generateColoringOutline(payload);
      return response.blocked ? response : { ...response, source: 'agent' as const };
    } catch (error) {
      return providerFailureFallback('/coloring-outline', error, () => stubColoring(payload));
    }
  }),
);
app.post(
  '/science-sim',
  scienceRateLimit,
  withValidation<ScienceRequest>(scienceRequestSchema, async (payload, signal) => {
    if (useStub) {
      return stubScience(payload);
    }
    try {
      const requestProvider = provider ? bindProviderSignal(provider, signal) : undefined;
      const response = requestProvider
        ? await planExperiment(payload, requestProvider)
        : planExperiment(payload);
      return response.blocked ? response : { ...response, source: 'agent' as const };
    } catch (error) {
      return providerFailureFallback('/science-sim', error, () => stubScience(payload));
    }
  }),
);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  void _next;
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify({ route: 'unhandled', error: safeProviderErrorSummary(err) }));
  res.status(500).json({ error: 'Internal Error', correlationId: correlationId() });
});

export const start = () => {
  let cleanupTimer: NodeJS.Timeout | undefined;
  if (imageAssetStorageConfig.mode !== 'data-url' && process.env.NODE_ENV !== 'test') {
    cleanupTimer = setInterval(
      () => void cleanupExpiredImageAssets(imageAssetStorageConfig),
      Math.min(imageAssetStorageConfig.ttlMs, 60 * 60 * 1_000),
    );
    cleanupTimer.unref();
  }

  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Agent service listening on http://localhost:${port}`);
  });
  server.on('close', () => {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
    }
  });
  return server;
};

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
