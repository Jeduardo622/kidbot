import type { StoryPanel, StoryRequest, StoryResponse } from '../types.js';
import { kidTone, moderate } from '../guardrails.js';

const buildPanelCaption = (theme: string, toneNote: string, index: number): string => {
  const intro = [
    'First',
    'Next',
    'Then',
    'After that',
    'Almost there',
    'Finally'
  ][Math.min(index, 5)];

  return `${intro}, ${theme.toLowerCase()} (${toneNote.toLowerCase()})`.slice(0, 160);
};

const createPanels = (request: StoryRequest): StoryPanel[] => {
  const tone = kidTone(request.ageBand ?? '7-9');
  const prompts = [
    'gentle wide-angle view',
    'friendly close-up',
    'action moment',
    'heartwarming ending'
  ];

  const panels: StoryPanel[] = [];
  const total = request.panels;

  for (let i = 0; i < total; i += 1) {
    const prompt = prompts[Math.min(i, prompts.length - 1)];
    panels.push({
      title: `${request.theme} — Panel ${i + 1}`,
      caption: buildPanelCaption(request.theme, tone.vocabulary, i),
      imagePrompt: `${request.theme} for kids, ${prompt}, bright colors`,
      imageUrl: null
    });
  }

  return panels;
};

export const planStory = (request: StoryRequest): StoryResponse => {
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
    panels
  };
};
