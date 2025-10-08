import { describe, expect, it } from 'vitest';
import { planStory } from '../agents/storyAgent.js';

describe('story agent', () => {
  it('creates the requested number of panels', () => {
    const response = planStory({ theme: 'Friendly dragon learns to share', panels: 3, ageBand: '7-9' });
    expect(response.blocked).toBe(false);
    expect(response.panels).toHaveLength(3);
    response.panels?.forEach((panel, index) => {
      expect(panel.title).toContain(`Panel ${index + 1}`);
      expect(panel.imageUrl).toBeNull();
    });
  });

  it('blocks themes flagged by moderation', () => {
    const response = planStory({ theme: 'A violent fight', panels: 2, ageBand: '7-9' });
    expect(response.blocked).toBe(true);
  });
});
