import { describe, expect, it } from 'vitest';
import { planExperiment } from '../agents/experimentAgent.js';
import { generateColoringOutline } from '../agents/imageAgent.js';
import { planStory } from '../agents/storyAgent.js';
import { craftVoiceReply } from '../agents/voiceAgent.js';
import { moderate } from '../guardrails.js';
import {
  MalformedOutputError,
  UnsafeOutputError,
  type ImageGenerationRequest,
  type ModelProvider,
  type TextGenerationRequest,
} from '../provider.js';

const fakeProvider = (
  generate: (request: TextGenerationRequest) => string,
  generateImage?: (request: ImageGenerationRequest) => string,
): ModelProvider => ({
  async generateText(request) {
    return generate(request);
  },
  ...(generateImage
    ? {
        async generateImage(request: ImageGenerationRequest) {
          return generateImage(request);
        },
      }
    : {}),
  async moderateText(text) {
    const result = moderate(text);
    return { blocked: result.blocked, reason: result.message };
  },
});

describe('provider-backed agents', () => {
  it('uses fake provider responses without network calls', async () => {
    const provider = fakeProvider((request) => {
      if (request.task === 'voice') {
        return 'Rainbows happen when sunlight bends through raindrops.';
      }
      if (request.task === 'story') {
        return JSON.stringify({
          panels: [
            {
              title: 'Seed',
              caption: 'Mia plants a bean.',
              imagePrompt: 'Mia planting a bean',
              imageUrl: null,
            },
            {
              title: 'Sprout',
              caption: 'A green sprout pops up.',
              imagePrompt: 'A happy sprout',
              imageUrl: null,
            },
          ],
        });
      }
      if (request.task === 'coloring') {
        return '<svg viewBox="0 0 1024 1024"><circle cx="512" cy="512" r="320" fill="none" stroke="#222"/></svg>';
      }
      return JSON.stringify({
        title: 'Paper Towel Rainbow',
        objective: 'Watch colors move through paper.',
        materials: ['Paper towel', 'Washable markers', 'Clear plastic cup', 'Water'],
        steps: [
          'Ask an adult to join.',
          'Draw dots on a paper towel.',
          'Dip one edge in water.',
          'Watch colors travel.',
        ],
        prediction: {
          question: 'What will the colors do?',
          choices: ['Move upward', 'Disappear', 'Turn black'],
          answerIndex: 0,
        },
        explanation: 'Water carries color through tiny spaces in the paper.',
        supervision: 'Ask an adult to supervise the whole activity.',
      });
    });

    await expect(
      craftVoiceReply({ text: 'Explain rainbows', persona: 'robot', ageBand: '7-9' }, provider),
    ).resolves.toMatchObject({
      blocked: false,
      persona: 'robot',
    });
    await expect(
      planStory({ theme: 'A bean grows', panels: 2, ageBand: '7-9' }, provider),
    ).resolves.toMatchObject({
      blocked: false,
      panels: expect.arrayContaining([expect.objectContaining({ imageUrl: null })]),
    });
    await expect(
      generateColoringOutline({ scene: 'big friendly planet' }, provider),
    ).resolves.toMatchObject({
      blocked: false,
      svg: expect.stringContaining('viewBox="0 0 1024 1024"'),
    });
    await expect(
      planExperiment({ topic: 'color moving in paper', ageBand: '7-9' }, provider),
    ).resolves.toMatchObject({
      blocked: false,
      prediction: expect.objectContaining({
        choices: expect.arrayContaining(['Move upward']),
        answerIndex: 0,
      }),
    });
  });

  it('attaches generated image data URLs to provider-backed story panels', async () => {
    const imagePrompts: string[] = [];
    const provider = fakeProvider(
      () =>
        JSON.stringify({
          panels: [
            {
              title: 'Seed',
              caption: 'Mia plants a bean.',
              imagePrompt: 'Mia planting a bean',
              imageUrl: null,
            },
            {
              title: 'Sprout',
              caption: 'A green sprout pops up.',
              imagePrompt: 'A happy sprout',
              imageUrl: null,
            },
          ],
        }),
      (request) => {
        imagePrompts.push(request.prompt);
        return Buffer.from(request.prompt).toString('base64');
      },
    );

    await expect(
      planStory({ theme: 'A bean grows', panels: 2, ageBand: '7-9' }, provider),
    ).resolves.toMatchObject({
      blocked: false,
      panels: [
        expect.objectContaining({
          imagePrompt: 'Mia planting a bean',
          imageUrl: `data:image/png;base64,${Buffer.from('Mia planting a bean').toString('base64')}`,
        }),
        expect.objectContaining({
          imagePrompt: 'A happy sprout',
          imageUrl: `data:image/png;base64,${Buffer.from('A happy sprout').toString('base64')}`,
        }),
      ],
    });
    expect(imagePrompts).toEqual(['Mia planting a bean', 'A happy sprout']);
  });

  it('surfaces malformed structured provider output for route-level policy handling', async () => {
    const provider = fakeProvider(() => 'not json');

    await expect(
      planStory({ theme: 'A dragon learns kindness', panels: 3, ageBand: '7-9' }, provider),
    ).rejects.toBeInstanceOf(MalformedOutputError);
    await expect(
      planExperiment({ topic: 'Mystery topic', ageBand: '7-9' }, provider),
    ).rejects.toBeInstanceOf(MalformedOutputError);
  });

  it('surfaces unsafe generated output after provider generation', async () => {
    const provider = fakeProvider(() => 'This story includes violence and blood.');
    await expect(
      craftVoiceReply({ text: 'Tell me a story', persona: 'robot', ageBand: '7-9' }, provider),
    ).rejects.toBeInstanceOf(UnsafeOutputError);
  });

  it('surfaces invalid provider SVG instead of returning it', async () => {
    const provider = fakeProvider(
      () =>
        '<svg viewBox="0 0 1024 1024"><script>alert(1)</script><circle cx="1" cy="1" r="1"/></svg>',
    );
    await expect(generateColoringOutline({ scene: 'space cat' }, provider)).rejects.toBeInstanceOf(
      MalformedOutputError,
    );
  });
});
