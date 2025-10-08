import { describe, expect, it } from 'vitest';
import { correlationId, kidTone, moderate, safeSystemPrompt } from '../guardrails.js';

describe('guardrails', () => {
  it('provides a non-empty system prompt', () => {
    expect(safeSystemPrompt.length).toBeGreaterThan(10);
  });

  it('generates kid tone guidance by age band', () => {
    expect(kidTone('4-6').sentenceLength).toContain('5-7');
    expect(kidTone('7-9').vocabulary).toContain('Simple');
    expect(kidTone('10-12').vocabulary).toContain('science');
  });

  it('blocks unsafe text', () => {
    const result = moderate('This story has violence and blood');
    expect(result.blocked).toBe(true);
    expect(result.message).toContain('friendly');
  });

  it('allows safe text', () => {
    const result = moderate('Happy adventure in the park');
    expect(result.blocked).toBe(false);
  });

  it('creates unique correlation ids', () => {
    const first = correlationId();
    const second = correlationId();
    expect(first).not.toEqual(second);
    expect(first.startsWith('kb_')).toBe(true);
  });
});
