import { applyModerationRules } from './moderationRules.js';
import type { ModerationResult } from './types.js';

export const safeSystemPrompt = `Kidbot MCP Tooling: Provide cheerful, kid-safe responses. Always redirect away from scary, adult, or personal topics. Keep answers short and positive.`;

export const kidTone = (ageBand: '4-6' | '7-9' | '10-12'): string => {
  switch (ageBand) {
    case '4-6':
      return 'Very short sentences with playful words.';
    case '7-9':
      return 'Short sentences with curious facts.';
    case '10-12':
    default:
      return 'Clear explanations with gentle science vocabulary.';
  }
};

/**
 * Local pre/post moderation. Uses the shared word-bounded rule set
 * (kept byte-identical with agent-service's copy). Context-dependent
 * judgement is the agent-service provider moderation call's job.
 */
export const moderate = (text: string | undefined | null): ModerationResult => {
  const result = applyModerationRules(text);
  return result.blocked ? { blocked: true, message: result.message } : { blocked: false };
};
