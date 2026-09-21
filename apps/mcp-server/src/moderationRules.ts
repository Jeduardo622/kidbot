/**
 * Local moderation rules shared by agent-service and mcp-server.
 *
 * This file is intentionally byte-identical in both packages
 * (`apps/agent-service/src/moderationRules.ts` and
 * `apps/mcp-server/src/moderationRules.ts`); the agent-service contract
 * integrity test enforces parity. Edit both copies together.
 *
 * Design rules:
 * - Every pattern uses word boundaries. Bare substrings ("die", "mean",
 *   "phone") blocked ordinary kid questions such as "what does photosynthesis
 *   mean?" and "why do leaves die in fall?".
 * - Two tiers. The base tier holds only unambiguous terms; anything context
 *   dependent ("blood", "kill", "fight", "hate", "kiss") is left to the
 *   provider moderation call, which sees the whole sentence and scores it by
 *   category. The strict tier adds those context-dependent terms and is used
 *   on every path that has NO provider moderation behind it: stub content,
 *   the fallback widget, and provider-failure fallback. Strict mode knowingly
 *   over-blocks ("why do leaves die?") because in those modes there is no
 *   contextual judge, and echoing an unmoderated request is worse.
 * - Messages are supportive redirects, never scolding.
 */
export interface ModerationRule {
  id: 'violence' | 'sexual' | 'self-harm' | 'hate' | 'personal-info' | 'substances';
  pattern: RegExp;
  message: string;
}

export const MODERATION_RULES: readonly ModerationRule[] = [
  {
    id: 'violence',
    pattern:
      /\b(?:violence|violent|murder(?:s|ed|er)?|stab(?:s|bed|bing)?|guns?|firearms?|bombs?|explosives?|bloody|gore|gory|torture[ds]?|weapons?|massacre|terrorists?)\b/i,
    message: "Let's pick a calm and friendly idea instead.",
  },
  {
    id: 'sexual',
    pattern:
      /\b(?:sex|sexy|sexual|naked|nudes?|porn(?:ography)?|romance|romantic|dating|make out)\b/i,
    message: 'Kidbot sticks to friendly adventures and science fun.',
  },
  {
    id: 'self-harm',
    pattern:
      /\b(?:hurt(?:ing)? myself|self[- ]harm|suicide|suicidal|kill(?:ing)? myself|cut(?:ting)? myself|want(?:s|ed)? to die|wanna die)\b/i,
    message:
      "If you're feeling upset, please talk with a trusted adult. I'm here for cheerful topics.",
  },
  {
    id: 'hate',
    pattern: /\b(?:racist|racism|nazis?|slurs?|hate crimes?|white power)\b/i,
    message: 'Kidbot celebrates kindness and respect for everyone.',
  },
  {
    id: 'personal-info',
    pattern:
      /\b(?:home address|street address|phone number|email address|passwords?|credit cards?|social security|last name|where do you live|my address is)\b/i,
    message: "Let's keep personal information private and talk about stories or science instead.",
  },
  {
    id: 'substances',
    pattern:
      /\b(?:cocaine|heroin|meth(?:amphetamine)?|marijuana|vapes?|vaping|cigarettes?|get(?:ting)? drunk|vodka|whisk(?:e)?y)\b/i,
    message: "Let's explore a healthy, fun idea instead.",
  },
];

/**
 * Context-dependent terms. Only applied in strict mode (no provider
 * moderation available). Each reuses a base rule id and message.
 */
export const STRICT_MODERATION_RULES: readonly ModerationRule[] = [
  {
    id: 'violence',
    pattern:
      /\b(?:kill(?:s|ed|ing|er|ers)?|die(?:s|d)?|dying|dead|death|blood|fight(?:s|ing)?|fought|hurt(?:s|ing)?|shoot(?:s|ing)?|shot|attack(?:s|ed|ing)?|wars?|knife|knives|swords?|punch(?:es|ed|ing)?|scary|monsters?)\b/i,
    message: "Let's pick a calm and friendly idea instead.",
  },
  {
    id: 'sexual',
    pattern: /\b(?:kiss(?:es|ed|ing)?|boyfriends?|girlfriends?|crush(?:es)?)\b/i,
    message: 'Kidbot sticks to friendly adventures and science fun.',
  },
  {
    id: 'hate',
    pattern: /\b(?:hate(?:s|d|ful)?|stupid|ugly|losers?|idiots?|dumb|bully|bullies|bullying)\b/i,
    message: 'Kidbot celebrates kindness and respect for everyone.',
  },
  {
    id: 'personal-info',
    pattern: /\b(?:address(?:es)?|phones?|emails?|birthday|school name)\b/i,
    message: "Let's keep personal information private and talk about stories or science instead.",
  },
  {
    id: 'substances',
    pattern: /\b(?:drugs?|beer|wine|alcohol|drunk|smoking)\b/i,
    message: "Let's explore a healthy, fun idea instead.",
  },
];

export interface LocalModerationResult {
  blocked: boolean;
  message?: string;
  ruleId?: ModerationRule['id'];
  /** True when a strict-tier (context-dependent) rule produced the block. */
  strict?: true;
}

export interface ApplyModerationOptions {
  /** Apply the strict tier as well. Use when no provider moderation will run. */
  strict?: boolean;
}

export const applyModerationRules = (
  text: string | undefined | null,
  options: ApplyModerationOptions = {},
): LocalModerationResult => {
  if (!text) {
    return { blocked: false };
  }

  for (const rule of MODERATION_RULES) {
    if (rule.pattern.test(text)) {
      return { blocked: true, message: rule.message, ruleId: rule.id };
    }
  }

  if (options.strict) {
    for (const rule of STRICT_MODERATION_RULES) {
      if (rule.pattern.test(text)) {
        return { blocked: true, message: rule.message, ruleId: rule.id, strict: true };
      }
    }
  }

  return { blocked: false };
};
