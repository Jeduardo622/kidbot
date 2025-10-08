import { describe, expect, it } from 'vitest';
import { planExperiment } from '../agents/experimentAgent.js';

describe('experiment agent', () => {
  it('selects a matching experiment', () => {
    const response = planExperiment({ topic: 'Teach me about buoyancy', ageBand: '7-9' });
    expect(response.blocked).toBe(false);
    expect(response.title).toContain('Floating');
    expect(response.prediction?.choices).toHaveLength(3);
  });

  it('falls back to default experiment for unknown topics', () => {
    const response = planExperiment({ topic: 'Mystery topic', ageBand: '7-9' });
    expect(response.blocked).toBe(false);
    expect(response.title).toContain('Rainbow');
  });
});
