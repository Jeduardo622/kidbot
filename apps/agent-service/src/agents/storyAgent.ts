import type { AgeBand, StoryPanel, StoryRequest, StoryResponse } from '../types.js';
import {
  exceedsAgeBandThreshold,
  kidTone,
  moderateAsync,
  moderateWithoutProvider,
  safeSystemPrompt,
} from '../guardrails.js';
import {
  MalformedOutputError,
  ModerationFailureError,
  UnsafeOutputError,
  type ModelProvider,
} from '../provider.js';
import {
  decodeBoundedImageBase64,
  defaultMaxGeneratedImageBytes,
} from '../imageAssetStore.js';
import { asRecord, cleanText, extractJson } from '../structuredOutput.js';

export interface StoryGenerationOptions {
  resolveGeneratedImageUrl?: (
    panel: StoryPanel,
    pngBase64: string,
    signal?: AbortSignal,
  ) => Promise<string> | string;
  maxGeneratedImageBytes?: number;
  signal?: AbortSignal;
}

const buildPanelCaption = (
  theme: string,
  toneNote: string,
  index: number,
): string => {
  const intro = ['First', 'Next', 'Then', 'After that', 'Almost there', 'Finally'][
    Math.min(index, 5)
  ];

  return `${intro}, ${theme.toLowerCase()} (${toneNote.toLowerCase()})`.slice(0, 160);
};

/** Theme plus the continuation caption, moderated together as one input. */
export const storyModerationInput = (request: StoryRequest): string =>
  request.continueFrom ? `${request.theme}\n${request.continueFrom}` : request.theme;

const createPanels = (request: StoryRequest): StoryPanel[] => {
  const tone = kidTone(request.ageBand ?? '7-9');
  const prompts = [
    'gentle wide-angle view',
    'friendly close-up',
    'action moment',
    'heartwarming ending',
  ];

  const panels: StoryPanel[] = [];
  const total = request.panels;

  for (let i = 0; i < total; i += 1) {
    const prompt = prompts[Math.min(i, prompts.length - 1)];
    panels.push({
      title: `${request.theme} — Panel ${i + 1}`,
      caption: buildPanelCaption(request.theme, tone.vocabulary, i),
      imagePrompt: `${request.theme} for kids, ${prompt}, bright colors`,
      imageUrl: null,
    });
  }

  return panels;
};

const repairPanels = (value: unknown, request: StoryRequest): StoryPanel[] | undefined => {
  const root = asRecord(value);
  const rawPanels = Array.isArray(root?.panels)
    ? root.panels
    : Array.isArray(value)
      ? value
      : undefined;
  if (!rawPanels) {
    return undefined;
  }

  const targetCount = Math.min(8, Math.max(2, request.panels));
  const panels = rawPanels.slice(0, targetCount).map((entry, index): StoryPanel => {
    const record = asRecord(entry) ?? {};
    const fallbackTitle = `${request.theme} - Panel ${index + 1}`;
    const title = cleanText(record.title, fallbackTitle, 80);
    const caption = cleanText(record.caption, `A friendly moment in ${request.theme}.`, 160);
    const imagePrompt = cleanText(
      record.imagePrompt,
      `${request.theme}, panel ${index + 1}, kid-safe comic art, bright simple shapes`,
      220,
    );
    return {
      title,
      caption,
      imagePrompt,
      imageUrl: null,
    };
  });

  return panels.length >= 2 ? panels : undefined;
};

const attachGeneratedImages = async (
  panels: StoryPanel[],
  provider: ModelProvider,
  ageBand: AgeBand,
  options: StoryGenerationOptions = {},
): Promise<StoryPanel[]> => {
  if (!provider.generateImage) {
    return panels;
  }
  const moderateImage = provider.moderateImage;
  if (!moderateImage) {
    throw new ModerationFailureError('Generated-image moderation is unavailable');
  }

  const generatedImages = new Array<{ panel: StoryPanel; pngBase64: string }>(panels.length);
  let nextIndex = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && nextIndex < panels.length) {
      const index = nextIndex;
      nextIndex += 1;
      const panel = panels[index];
      if (!panel) continue;
      try {
        options.signal?.throwIfAborted();
        const pngBase64 = await provider.generateImage?.({
          prompt: panel.imagePrompt,
          size: '1024x1024',
        });

        if (!pngBase64) {
          throw new MalformedOutputError('Provider image output did not include base64 data');
        }
        decodeBoundedImageBase64(
          pngBase64,
          options.maxGeneratedImageBytes ?? defaultMaxGeneratedImageBytes,
        );
        let imageModeration;
        try {
          imageModeration = await moderateImage(pngBase64);
        } catch (error) {
          if (error instanceof ModerationFailureError) {
            throw error;
          }
          throw new ModerationFailureError('Generated-image moderation failed');
        }
        if (imageModeration.blocked) {
          throw new UnsafeOutputError(imageModeration.reason ?? 'Generated image was unsafe');
        }
        const exceededCategory = exceedsAgeBandThreshold(
          imageModeration.categoryScores,
          ageBand,
        );
        if (exceededCategory) {
          throw new UnsafeOutputError(`Generated image exceeded ${exceededCategory} threshold`);
        }
        generatedImages[index] = { panel, pngBase64 };
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, panels.length) }, () => worker()));
  options.signal?.throwIfAborted();

  const stored: StoryPanel[] = [];
  for (const entry of generatedImages) {
    if (!entry) {
      throw new MalformedOutputError('Provider did not generate every story image');
    }
    options.signal?.throwIfAborted();
    const { panel, pngBase64 } = entry;
    stored.push({
      ...panel,
      imageUrl: options.resolveGeneratedImageUrl
        ? await options.resolveGeneratedImageUrl(panel, pngBase64, options.signal)
        : `data:image/png;base64,${pngBase64}`,
    });
  }
  return stored;
};

const planStoryWithProvider = async (
  request: StoryRequest,
  provider: ModelProvider,
  options: StoryGenerationOptions = {},
): Promise<StoryResponse> => {
  const inputModeration = await moderateAsync(storyModerationInput(request), provider, request.ageBand);
  if (inputModeration.blocked) {
    return { blocked: true, message: inputModeration.message };
  }

  const tone = kidTone(request.ageBand ?? '7-9');
  const raw = await provider.generateText({
    task: 'story',
    system: safeSystemPrompt,
    user: [
      'Return only JSON with this shape: {"panels":[{"title":"","caption":"","imagePrompt":"","imageUrl":null}]}',
      request.continueFrom
        ? `Continue an existing story with exactly ${request.panels} new comic panels that pick up right after this moment: "${request.continueFrom}". Keep the same characters and end on a satisfying note.`
        : `Create exactly ${request.panels} coherent comic panels with a clear beginning, middle, and ending.`,
      `Theme: ${request.theme}`,
      `Tone: ${tone.sentenceLength}; ${tone.vocabulary}`,
      'Keep it age-appropriate. Avoid scary, violent, romantic, adult, or personal-data content.',
      'Each imageUrl must be null.',
    ].join('\n'),
    maxTokens: 900,
    temperature: 0.55,
  });
  const repaired = repairPanels(extractJson(raw), request);
  if (!repaired || repaired.length !== request.panels) {
    throw new MalformedOutputError('Provider story output did not match the expected panel shape');
  }

  const outputText = repaired
    .map((panel) => `${panel.title} ${panel.caption} ${panel.imagePrompt}`)
    .join(' ');
  const outputModeration = await moderateAsync(outputText, provider, request.ageBand);
  if (outputModeration.blocked) {
    throw new UnsafeOutputError(outputModeration.message);
  }
  const panels = await attachGeneratedImages(
    repaired,
    provider,
    request.ageBand ?? '7-9',
    options,
  );

  return {
    blocked: false,
    theme: request.theme,
    panels,
  };
};

export function planStory(request: StoryRequest): StoryResponse;
export function planStory(
  request: StoryRequest,
  provider: ModelProvider,
  options?: StoryGenerationOptions,
): Promise<StoryResponse>;
export function planStory(
  request: StoryRequest,
  provider?: ModelProvider,
  options: StoryGenerationOptions = {},
): StoryResponse | Promise<StoryResponse> {
  if (provider) {
    return planStoryWithProvider(request, provider, options);
  }

  const inputModeration = moderateWithoutProvider(storyModerationInput(request));
  if (inputModeration.blocked) {
    return { blocked: true, message: inputModeration.message };
  }

  const panels = createPanels(request);
  const outputModeration = moderateWithoutProvider(panels.map((panel) => panel.caption).join(' '));
  if (outputModeration.blocked) {
    return { blocked: true, message: outputModeration.message };
  }

  return {
    blocked: false,
    theme: request.theme,
    panels,
  };
}
