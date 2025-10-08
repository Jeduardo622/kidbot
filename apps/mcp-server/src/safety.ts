import type { ModerationResult } from './types.js';

const BLOCK_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /(weapon|fight|blood|violence)/i, message: 'Let\'s choose a calm, friendly idea instead.' },
  { pattern: /(romance|dating|kiss)/i, message: 'KidBot keeps things cozy and kid-friendly.' },
  { pattern: /(hurt myself|suicide|die)/i, message: 'Please talk with a trusted adult if you feel upset. We can explore cheerful topics.' },
  { pattern: /(hate|bully|racis)/i, message: 'KidBot celebrates kindness for everyone.' },
  { pattern: /(address|phone|email|password)/i, message: 'Let\'s keep personal information private and chat about adventures instead.' }
];

export const safeSystemPrompt = `KidBot MCP Tooling: Provide cheerful, kid-safe responses. Always redirect away from scary, adult, or personal topics. Keep answers short and positive.`;

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

export const moderate = (text: string | undefined | null): ModerationResult => {
  if (!text) {
    return { blocked: false };
  }

  for (const entry of BLOCK_PATTERNS) {
    if (entry.pattern.test(text)) {
      return { blocked: true, message: entry.message };
    }
  }

  return { blocked: false };
};
