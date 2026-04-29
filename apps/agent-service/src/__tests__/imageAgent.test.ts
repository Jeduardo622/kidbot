import { describe, expect, it } from 'vitest';
import { generateColoringOutline } from '../agents/imageAgent.js';

describe('image agent', () => {
  it('creates an SVG outline', () => {
    const response = generateColoringOutline({ scene: 'Happy turtle parade' });
    expect(response.blocked).toBe(false);
    expect(response.svg).toContain('<svg');
    expect(response.svg).toContain('viewBox="0 0 1024 1024"');
    expect(response.svg).toContain('fill="none"');
  });

  it('blocks unsafe scenes', () => {
    const response = generateColoringOutline({ scene: 'scary violence scene' });
    expect(response.blocked).toBe(true);
  });
});
