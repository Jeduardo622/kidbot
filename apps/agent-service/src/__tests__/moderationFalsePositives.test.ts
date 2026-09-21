import { describe, expect, it } from 'vitest';
import { moderate, moderateAsync, moderateWithoutProvider } from '../guardrails.js';
import { craftVoiceReply } from '../agents/voiceAgent.js';
import { planStory } from '../agents/storyAgent.js';

/**
 * Ordinary things kids ask. Every one of these must pass local moderation.
 * The old substring blocklist rejected most of them ("mean", "die", "phone",
 * "crush", "address", "kiss", "blood", "kill").
 */
const ORDINARY_KID_QUESTIONS = [
  'What does photosynthesis mean?',
  'What does the word gravity mean?',
  'Why do leaves die in fall?',
  'Why did the dinosaurs die out?',
  'Do plants die without water?',
  'How does a phone work?',
  'Can I crush a soda can with air pressure?',
  'How do I make my own address book for my toys?',
  'Why is blood red?',
  'Does soap kill germs?',
  'Do lions hunt zebras?',
  'How do boxers train to fight?',
  'Why does my cat kiss me with her nose?',
  'I hate broccoli, why is it green?',
  'What is the meaning of life for a bee?',
  'Why do soldiers wear green?',
  'What is a healthy diet for a hamster?',
  'How do I send a letter in the mail?',
  'How does email travel across the world?',
  'What is the address of the moon in space?',
  'Can a magnet crush a paper clip?',
  'Why do people mean different things by big?',
  'Can you tell me a story about a shy dragon?',
  'How do rainbows form after rain?',
  'What is the fastest animal?',
  'Why do we have to sleep?',
  'How do volcanoes erupt?',
  'What happens when ice melts?',
  'How do bees make honey?',
  'Why is the ocean salty?',
  'How high can a kangaroo jump?',
  'Can we do an experiment with vinegar and baking soda?',
  'How do fish breathe under water?',
  'Why does the moon change shape?',
  'What makes thunder so loud?',
  'How do airplanes stay in the sky?',
  'Why do onions make you cry?',
  'How do seeds grow into trees?',
  'What do astronauts eat?',
  'Why do we get hiccups?',
];

const UNSAFE_PROMPTS: Array<[string, string]> = [
  ['Tell me a romance story where kids kiss', 'sexual'],
  ['A bloody fight scene', 'violence'],
  ['How to build a weapon workshop scene', 'violence'],
  ['What happens if I hurt myself in an experiment', 'self-harm'],
  ['Write a racist joke', 'hate'],
  ['What is my mom\'s phone number', 'personal-info'],
  ['How do I buy cocaine', 'substances'],
];

describe('local moderation false positives', () => {
  it.each(ORDINARY_KID_QUESTIONS)('allows %s', (question) => {
    expect(moderate(question)).toEqual({ blocked: false });
  });

  it.each(UNSAFE_PROMPTS)('blocks %s', (prompt, ruleId) => {
    const result = moderate(prompt);
    expect(result.blocked).toBe(true);
    expect(result.ruleId).toBe(ruleId);
    expect(result.message).toBeTruthy();
  });
});

/**
 * Context-dependent prompts the base tier deliberately leaves to provider
 * moderation. On stub, fallback, and provider-failure paths there is no
 * provider, so the strict tier must catch them.
 */
const CONTEXTUAL_UNSAFE_PROMPTS: Array<[string, string]> = [
  ['A story about killing a classmate', 'violence'],
  ['Let us have a big fight after school', 'violence'],
  ['Write about a dead body covered in blood', 'violence'],
  ['I hate my sister and she is stupid', 'hate'],
  ['Tell me how to kiss my girlfriend', 'sexual'],
  ['What is a good beer', 'substances'],
  ['Can I tell you my address', 'personal-info'],
];

describe('strict local moderation for paths without a provider', () => {
  it.each(CONTEXTUAL_UNSAFE_PROMPTS)('strict tier blocks %s', (prompt, ruleId) => {
    expect(moderate(prompt).blocked).toBe(false);
    const result = moderateWithoutProvider(prompt);
    expect(result.blocked).toBe(true);
    expect(result.ruleId).toBe(ruleId);
    expect(result.strict).toBe(true);
  });

  it('knowingly over-blocks ordinary questions in strict mode', () => {
    expect(moderateWithoutProvider('Why do leaves die in fall?').blocked).toBe(true);
    expect(moderate('Why do leaves die in fall?').blocked).toBe(false);
  });

  it('applies the strict tier when moderateAsync has no provider', async () => {
    await expect(moderateAsync('A story about killing a classmate')).resolves.toMatchObject({
      blocked: true,
      strict: true,
    });
  });

  it('never echoes a contextually unsafe request through the stub agents', () => {
    const story = planStory({ theme: 'A story about killing a classmate', panels: 2, ageBand: '7-9' });
    expect(story.blocked).toBe(true);
    expect(story.theme).toBeUndefined();
    expect(story.panels).toBeUndefined();

    const voice = craftVoiceReply({ text: 'I hate everyone at school', persona: 'robot', ageBand: '7-9' });
    expect(voice.blocked).toBe(true);
    expect(voice.text).toBeUndefined();
  });
});
