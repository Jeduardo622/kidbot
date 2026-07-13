import type { StoryPanel, StoryRequest, StoryResponse } from '../types.js';
import { kidTone, moderate, moderateAsync, safeSystemPrompt } from '../guardrails.js';
import { MalformedOutputError, UnsafeOutputError, type ModelProvider } from '../provider.js';
import { asRecord, cleanText, extractJson } from '../structuredOutput.js';

export interface StoryGenerationOptions {
  resolveGeneratedImageUrl?: (panel: StoryPanel, pngBase64: string) => Promise<string> | string;
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
  options: StoryGenerationOptions = {},
): Promise<StoryPanel[]> => {
  if (!provider.generateImage) {
    return panels;
  }

  const generated = new Array<StoryPanel>(panels.length);
  let nextIndex = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && nextIndex < panels.length) {
      const index = nextIndex;
      nextIndex += 1;
      const panel = panels[index];
      if (!panel) continue;
      try {
        const pngBase64 = await provider.generateImage?.({
          prompt: panel.imagePrompt,
          size: '1024x1024',
        });

        if (!pngBase64) {
          throw new MalformedOutputError('Provider image output did not include base64 data');
        }

        generated[index] = {
          ...panel,
          imageUrl: options.resolveGeneratedImageUrl
            ? await options.resolveGeneratedImageUrl(panel, pngBase64)
            : `data:image/png;base64,${pngBase64}`,
        };
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, panels.length) }, () => worker()));
  return generated;
};

const planStoryWithProvider = async (
  request: StoryRequest,
  provider: ModelProvider,
  options: StoryGenerationOptions = {},
): Promise<StoryResponse> => {
  const inputModeration = await moderateAsync(request.theme, provider);
  if (inputModeration.blocked) {
    return { blocked: true, message: inputModeration.message };
  }

  const tone = kidTone(request.ageBand ?? '7-9');
  const raw = await provider.generateText({
    task: 'story',
    system: safeSystemPrompt,
    user: [
      'Return only JSON with this shape: {"panels":[{"title":"","caption":"","imagePrompt":"","imageUrl":null}]}',
      `Create exactly ${request.panels} coherent comic panels with a clear beginning, middle, and ending.`,
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
  const outputModeration = await moderateAsync(outputText, provider);
  if (outputModeration.blocked) {
    throw new UnsafeOutputError(outputModeration.message);
  }
  const panels = await attachGeneratedImages(repaired, provider, options);

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

  const inputModeration = moderate(request.theme);
  if (inputModeration.blocked) {
    return { blocked: true, message: inputModeration.message };
  }

  const panels = createPanels(request);
  const outputModeration = moderate(panels.map((panel) => panel.caption).join(' '));
  if (outputModeration.blocked) {
    return { blocked: true, message: outputModeration.message };
  }

  return {
    blocked: false,
    theme: request.theme,
    panels,
  };
}
