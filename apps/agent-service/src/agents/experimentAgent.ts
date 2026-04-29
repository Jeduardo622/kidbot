import { kidTone, moderate, moderateAsync, safeSystemPrompt } from '../guardrails.js';
import { MalformedOutputError, UnsafeOutputError, type ModelProvider } from '../provider.js';
import { asRecord, cleanText, cleanTextArray, extractJson } from '../structuredOutput.js';
import type { AgeBand, ScienceRequest, ScienceResponse } from '../types.js';

const topicMap: Record<
  string,
  { title: string; objective: string; steps: string[]; explanation: string }
> = {
  buoyancy: {
    title: 'Floating Fruit Test',
    objective: 'Discover which fruits float or sink in water',
    steps: [
      'Fill a clear bowl with water halfway.',
      'Gently drop in one fruit at a time.',
      'Watch if it floats on top or sinks to the bottom.',
      'Sort the fruits into float and sink groups.',
    ],
    explanation: 'Fruits with more air or lower density float. Denser fruits sink.',
  },
  magnetism: {
    title: 'Treasure Magnet Hunt',
    objective: 'Test which objects stick to a magnet',
    steps: [
      'Place a magnet on a table.',
      'Slide different small objects toward the magnet.',
      'Notice which ones snap to the magnet and which ones stay still.',
    ],
    explanation: 'Magnets pull on objects made with iron or steel.',
  },
};

const defaultTopic = {
  title: 'Rainbow Water Mix',
  objective: 'See how colors blend in water',
  steps: [
    'Fill three clear cups with water.',
    'Add red, yellow, and blue food coloring.',
    'Pour a little from two cups into an empty one to make new colors.',
  ],
  explanation: 'Mixing primary colors creates secondary colors like green, orange, and purple.',
};

const toneSummary = (ageBand: AgeBand | undefined): string => {
  const tone = kidTone(ageBand ?? '7-9');
  return `${tone.sentenceLength}; ${tone.vocabulary}`;
};

const unsafeExperimentPattern =
  /\b(heat|hot|boil|oven|stove|microwave|knife|scissors|blade|cut|chemical|bleach|vinegar\s+and\s+baking\s+soda|acid|borax|choking|marble|bead|battery|electric|outlet|wire|fire|flame|match|lighter|glass|break|explode|unsupervised)\b/i;

const isUnsafeExperiment = (response: ScienceResponse): boolean => {
  const text = [
    response.title,
    response.objective,
    response.materials?.join(' '),
    response.steps?.join(' '),
    response.prediction?.question,
    response.prediction?.choices.join(' '),
    response.explanation,
    response.supervision,
  ]
    .filter(Boolean)
    .join(' ');
  return unsafeExperimentPattern.test(text);
};

const repairExperiment = (value: unknown, request: ScienceRequest): ScienceResponse | undefined => {
  const root = asRecord(value);
  if (!root) {
    return undefined;
  }

  const prediction = asRecord(root.prediction);
  const choices = cleanTextArray(
    prediction?.choices,
    ['It floats', 'It sinks', 'It stays the same'],
    3,
    90,
  );
  if (choices.length !== 3) {
    return undefined;
  }

  const answerIndex =
    typeof prediction?.answerIndex === 'number' ? Math.trunc(prediction.answerIndex) : 0;
  const response: ScienceResponse = {
    blocked: false,
    title: cleanText(root.title, `Safe Science: ${request.topic}`, 90),
    objective: cleanText(root.objective, 'Explore a safe household science idea.', 160),
    materials: cleanTextArray(
      root.materials,
      ['Clear plastic cup', 'Fresh water', 'Paper towel'],
      6,
      80,
    ),
    steps: cleanTextArray(
      root.steps,
      ['Ask an adult to join.', 'Set up on a towel.', 'Observe what happens.'],
      6,
      140,
    ),
    prediction: {
      question: cleanText(prediction?.question, 'What do you think will happen?', 120),
      choices,
      answerIndex: answerIndex >= 0 && answerIndex < choices.length ? answerIndex : 0,
    },
    explanation: cleanText(root.explanation, 'Careful observing helps us notice patterns.', 220),
    supervision: cleanText(root.supervision, 'Ask an adult to supervise the whole activity.', 140),
    topic: request.topic,
  };

  if (!/adult|grown-up|supervis/i.test(response.supervision ?? '')) {
    response.supervision =
      `Ask an adult to supervise the whole activity. ${response.supervision ?? ''}`.trim();
  }

  return isUnsafeExperiment(response) ? undefined : response;
};

const planExperimentWithProvider = async (
  request: ScienceRequest,
  provider: ModelProvider,
): Promise<ScienceResponse> => {
  const topicModeration = await moderateAsync(request.topic, provider);
  if (topicModeration.blocked) {
    return { blocked: true, message: topicModeration.message };
  }

  const tone = kidTone(request.ageBand ?? '7-9');
  const raw = await provider.generateText({
    task: 'science',
    system: safeSystemPrompt,
    user: [
      'Return only JSON for a household-safe science activity.',
      'Shape: {"title":"","objective":"","materials":[],"steps":[],"prediction":{"question":"","choices":["","",""],"answerIndex":0},"explanation":"","supervision":""}',
      `Topic: ${request.topic}`,
      `Tone: ${tone.sentenceLength}; ${tone.vocabulary}`,
      'Rules: no heat, sharp tools, chemicals, choking hazards, electricity, fire, glass breakage, or unsupervised risky steps.',
      'Use no more than 6 simple steps. Prediction must have exactly 3 choices and a valid answerIndex. Include a supervision note.',
    ].join('\n'),
    maxTokens: 900,
    temperature: 0.45,
  });
  const repaired = repairExperiment(extractJson(raw), request);
  if (!repaired) {
    throw new MalformedOutputError(
      'Provider science output did not match safety or schema requirements',
    );
  }

  const outputText = [
    repaired.title,
    repaired.objective,
    repaired.materials?.join(' '),
    repaired.steps?.join(' '),
    repaired.explanation,
    repaired.supervision,
  ].join(' ');
  const outputModeration = await moderateAsync(outputText, provider);
  if (outputModeration.blocked) {
    throw new UnsafeOutputError(outputModeration.message);
  }

  return repaired;
};

export function planExperiment(request: ScienceRequest): ScienceResponse;
export function planExperiment(
  request: ScienceRequest,
  provider: ModelProvider,
): Promise<ScienceResponse>;
export function planExperiment(
  request: ScienceRequest,
  provider?: ModelProvider,
): ScienceResponse | Promise<ScienceResponse> {
  if (provider) {
    return planExperimentWithProvider(request, provider);
  }

  const topicModeration = moderate(request.topic);
  if (topicModeration.blocked) {
    return { blocked: true, message: topicModeration.message };
  }

  const lowerTopic = request.topic.toLowerCase();
  const selected =
    Object.entries(topicMap).find(([key]) => lowerTopic.includes(key))?.[1] ?? defaultTopic;

  const stepsModeration = moderate(selected.steps.join(' '));
  if (stepsModeration.blocked) {
    return { blocked: true, message: stepsModeration.message };
  }

  const predictionChoices = ['It will float', 'It will sink', 'It will wobble in the middle'];

  return {
    blocked: false,
    title: selected.title,
    objective: selected.objective,
    materials: ['Large clear bowl', 'Fresh water', 'Safe household items'],
    steps: selected.steps,
    prediction: {
      question: `What do you think will happen? (${toneSummary(request.ageBand)})`,
      choices: predictionChoices,
      answerIndex: 0,
    },
    explanation: selected.explanation,
    supervision: 'Ask an adult to help pour water and tidy up spills.',
  };
}
