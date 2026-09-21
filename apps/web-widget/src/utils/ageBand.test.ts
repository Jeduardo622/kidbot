import { describe, expect, it } from 'vitest';
import { ageBandPresentation } from './ageBand.js';

describe('ageBandPresentation', () => {
  it('simplifies and enlarges for early learners', () => {
    const early = ageBandPresentation('4-6');
    expect(early.scale).toBe('large');
    expect(early.simplified).toBe(true);
    expect(early.defaultPanels).toBe(3);
    expect(early.brushSize).toBeGreaterThan(ageBandPresentation('10-12').brushSize);
  });

  it('offers band-specific science topics', () => {
    expect(ageBandPresentation('4-6').scienceTopics).toContain('Float or sink');
    expect(ageBandPresentation('10-12').scienceTopics).toContain('Photosynthesis');
    expect(ageBandPresentation('7-9').simplified).toBe(false);
    expect(ageBandPresentation('10-12').scale).toBe('default');
  });
});
