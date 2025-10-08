import { kidTone, moderate } from '../guardrails.js';
import type { AgeBand, ScienceRequest, ScienceResponse } from '../types.js';

const topicMap: Record<string, { title: string; objective: string; steps: string[]; explanation: string }> = {
  buoyancy: {
    title: 'Floating Fruit Test',
    objective: 'Discover which fruits float or sink in water',
    steps: [
      'Fill a clear bowl with water halfway.',
      'Gently drop in one fruit at a time.',
      'Watch if it floats on top or sinks to the bottom.',
      'Sort the fruits into float and sink groups.'
    ],
    explanation: 'Fruits with more air or lower density float. Denser fruits sink.'
  },
  magnetism: {
    title: 'Treasure Magnet Hunt',
    objective: 'Test which objects stick to a magnet',
    steps: [
      'Place a magnet on a table.',
      'Slide different small objects toward the magnet.',
      'Notice which ones snap to the magnet and which ones stay still.'
    ],
    explanation: 'Magnets pull on objects made with iron or steel.'
  }
};

const defaultTopic = {
  title: 'Rainbow Water Mix',
  objective: 'See how colors blend in water',
  steps: [
    'Fill three clear cups with water.',
    'Add red, yellow, and blue food coloring.',
    'Pour a little from two cups into an empty one to make new colors.'
  ],
  explanation: 'Mixing primary colors creates secondary colors like green, orange, and purple.'
};

const toneSummary = (ageBand: AgeBand | undefined): string => {
  const tone = kidTone(ageBand ?? '7-9');
  return `${tone.sentenceLength}; ${tone.vocabulary}`;
};

export const planExperiment = (request: ScienceRequest): ScienceResponse => {
  const topicModeration = moderate(request.topic);
  if (topicModeration.blocked) {
    return { blocked: true, message: topicModeration.message };
  }

  const lowerTopic = request.topic.toLowerCase();
  const selected = Object.entries(topicMap).find(([key]) => lowerTopic.includes(key))?.[1] ?? defaultTopic;

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
      answerIndex: 0
    },
    explanation: selected.explanation,
    supervision: 'Ask an adult to help pour water and tidy up spills.'
  };
};
