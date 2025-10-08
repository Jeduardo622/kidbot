import { describe, expect, it } from 'vitest';
import { craftVoiceReply } from '../agents/voiceAgent.js';

describe('voice agent', () => {
  it('crafts persona responses', () => {
    const response = craftVoiceReply({ text: 'Tell me about rainbows', persona: 'robot', ageBand: '7-9' });
    expect(response.blocked).toBe(false);
    expect(response.persona).toBe('robot');
    expect(response.text).toContain('🤖');
    expect(response.ssml).toContain('<speak>');
  });

  it('blocks unsafe requests', () => {
    const response = craftVoiceReply({ text: 'Talk about violence', persona: 'robot', ageBand: '7-9' });
    expect(response.blocked).toBe(true);
  });
});
