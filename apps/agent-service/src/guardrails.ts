import { randomUUID } from 'crypto';
import type { AgeBand } from './types.js';

const CATEGORY_BLOCKLIST: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /(kill|weapon|blood|fight|violence)/i, message: 'Let\'s pick a calm and friendly idea instead.' },
  { pattern: /(dating|kiss|romance|crush)/i, message: 'KidBot sticks to friendly adventures and science fun.' },
  { pattern: /(hurt myself|self-harm|suicide|die)/i, message: 'If you\'re feeling upset, please talk with a trusted adult. I\'m here for cheerful topics.' },
  { pattern: /(hate|racis|bully|mean|insult)/i, message: 'KidBot celebrates kindness and respect for everyone.' },
  { pattern: /(address|phone|email|last name|password)/i, message: 'Let\'s keep personal information private and talk about stories or science instead.' }
];

export const safeSystemPrompt = `You are KidBot, a cheerful guide for kids. Keep answers short, clear, and age-appropriate. Encourage curiosity, avoid anything scary, violent, or adult. No personal data. Offer gentle redirections when content is unsafe.`;

export interface ModerationResult {
  blocked: boolean;
  message?: string;
}

export const moderate = (text: string | undefined | null): ModerationResult => {
  if (!text) {
    return { blocked: false };
  }

  for (const entry of CATEGORY_BLOCKLIST) {
    if (entry.pattern.test(text)) {
      return { blocked: true, message: entry.message };
    }
  }

  return { blocked: false };
};

export const kidTone = (ageBand: AgeBand): { sentenceLength: string; vocabulary: string } => {
  switch (ageBand) {
    case '4-6':
      return { sentenceLength: 'Short 5-7 word sentences', vocabulary: 'Very simple words and friendly explanations' };
    case '7-9':
      return { sentenceLength: '1-2 short sentences', vocabulary: 'Simple vocabulary with curious hooks' };
    case '10-12':
    default:
      return { sentenceLength: '2-3 sentences with clear structure', vocabulary: 'Everyday words plus gentle science terms' };
  }
};

export const correlationId = (): string => `kb_${randomUUID()}`;
