import { randomUUID } from 'crypto';
import {
  applyModerationRules,
  type ApplyModerationOptions,
  type LocalModerationResult,
} from './moderationRules.js';
import { ModerationFailureError, type ModelProvider } from './provider.js';
import type { AgeBand } from './types.js';

export const safeSystemPrompt = `You are Kidbot, a cheerful guide for kids. Keep answers short, clear, and age-appropriate. Encourage curiosity, avoid anything scary, violent, or adult. No personal data. Offer gentle redirections when content is unsafe.`;

export type ModerationResult = LocalModerationResult;

/**
 * Local, synchronous moderation. By default only unambiguous, word-bounded
 * terms block here; see moderationRules.ts. Everything context dependent is
 * left to the provider moderation call in moderateAsync. Pass
 * `{ strict: true }` (or use moderateWithoutProvider) on any path where no
 * provider moderation will run.
 */
export const moderate = (
  text: string | undefined | null,
  options: ApplyModerationOptions = {},
): ModerationResult => applyModerationRules(text, options);

/**
 * Moderation for stub, fallback, and provider-failure paths. There is no
 * contextual judge behind these, so the strict local tier applies and
 * over-blocking is accepted.
 */
export const moderateWithoutProvider = (text: string | undefined | null): ModerationResult =>
  applyModerationRules(text, { strict: true });

/**
 * Provider moderation category thresholds by age band. The provider returns
 * a 0..1 score per category. A request is blocked when the provider flags it
 * outright, or when any listed category exceeds the band's threshold.
 * Younger bands are stricter. Categories not listed rely on the provider's
 * own `flagged` decision.
 */
export const PROVIDER_CATEGORY_THRESHOLDS: Record<AgeBand, Record<string, number>> = {
  '4-6': {
    'sexual': 0.05,
    'sexual/minors': 0.02,
    'self-harm': 0.05,
    'self-harm/intent': 0.02,
    'self-harm/instructions': 0.02,
    'hate': 0.2,
    'harassment': 0.3,
    'violence': 0.3,
    'violence/graphic': 0.15,
    'illicit': 0.2,
  },
  '7-9': {
    'sexual': 0.05,
    'sexual/minors': 0.02,
    'self-harm': 0.05,
    'self-harm/intent': 0.02,
    'self-harm/instructions': 0.02,
    'hate': 0.3,
    'harassment': 0.4,
    'violence': 0.4,
    'violence/graphic': 0.2,
    'illicit': 0.3,
  },
  '10-12': {
    'sexual': 0.1,
    'sexual/minors': 0.02,
    'self-harm': 0.1,
    'self-harm/intent': 0.02,
    'self-harm/instructions': 0.02,
    'hate': 0.4,
    'harassment': 0.5,
    'violence': 0.5,
    'violence/graphic': 0.3,
    'illicit': 0.4,
  },
};

export const DEFAULT_AGE_BAND: AgeBand = '7-9';

export const exceedsAgeBandThreshold = (
  categoryScores: Record<string, number> | undefined,
  ageBand: AgeBand,
): string | undefined => {
  if (!categoryScores) return undefined;
  const thresholds = PROVIDER_CATEGORY_THRESHOLDS[ageBand];
  for (const [category, threshold] of Object.entries(thresholds)) {
    const score = categoryScores[category];
    if (typeof score === 'number' && score >= threshold) {
      return category;
    }
  }
  return undefined;
};

export const moderateAsync = async (
  text: string | undefined | null,
  provider?: ModelProvider,
  ageBand: AgeBand = DEFAULT_AGE_BAND,
): Promise<ModerationResult> => {
  if (!provider) {
    return moderateWithoutProvider(text);
  }
  const local = moderate(text);
  if (local.blocked || !text?.trim()) {
    return local;
  }

  try {
    const providerResult = await provider.moderateText(text);
    if (providerResult.blocked || exceedsAgeBandThreshold(providerResult.categoryScores, ageBand)) {
      return {
        blocked: true,
        message: "Let's choose a safe, cheerful idea instead.",
      };
    }
  } catch (error) {
    throw error instanceof ModerationFailureError ? error : new ModerationFailureError();
  }

  return local;
};

export const kidTone = (ageBand: AgeBand): { sentenceLength: string; vocabulary: string } => {
  switch (ageBand) {
    case '4-6':
      return {
        sentenceLength: 'Short 5-7 word sentences',
        vocabulary: 'Very simple words and friendly explanations',
      };
    case '7-9':
      return {
        sentenceLength: '1-2 short sentences',
        vocabulary: 'Simple vocabulary with curious hooks',
      };
    case '10-12':
    default:
      return {
        sentenceLength: '2-3 sentences with clear structure',
        vocabulary: 'Everyday words plus gentle science terms',
      };
  }
};

export const correlationId = (): string => `kb_${randomUUID()}`;
