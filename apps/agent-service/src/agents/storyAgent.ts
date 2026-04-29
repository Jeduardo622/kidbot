import type { StoryPanel, StoryRequest, StoryResponse } from '../types.js';
import { kidTone, moderate, moderateAsync, safeSystemPrompt } from '../guardrails.js';
import { MalformedOutputError, UnsafeOutputError, type ModelProvider } from '../provider.js';
import { asRecord, cleanText, extractJson } from '../structuredOutput.js';

const buildPanelCaption = (
  theme: string,
  toneNote: string,
  index: number,
  total: number,
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
      caption: buildPanelCaption(request.theme, tone.vocabulary, i, total),
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

const planStoryWithProvider = async (
  request: StoryRequest,
  provider: ModelProvider,
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

  return {
    blocked: false,
    theme: request.theme,
    panels: repaired,
  };
};

export function planStory(request: StoryRequest): StoryResponse;
export function planStory(request: StoryRequest, provider: ModelProvider): Promise<StoryResponse>;
export function planStory(
  request: StoryRequest,
  provider?: ModelProvider,
): StoryResponse | Promise<StoryResponse> {
  if (provider) {
    return planStoryWithProvider(request, provider);
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
