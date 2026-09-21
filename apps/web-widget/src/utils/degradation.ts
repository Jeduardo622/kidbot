export const SERVICE_UNAVAILABLE_MESSAGE =
  'Kidbot is having trouble reaching its idea engine right now. Please try again in a moment.';

export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

export interface DegradedResult {
  degraded?: boolean;
  message?: string;
}

export const degradedMessage = (result: DegradedResult): string | undefined =>
  result.degraded ? (result.message ?? SERVICE_UNAVAILABLE_MESSAGE) : undefined;

const messageFromError = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  try {
    const message = (error as { message?: unknown }).message;
    if (typeof message !== 'string' || !message.trim()) return undefined;
    return message;
  } catch {
    return undefined;
  }
};

/**
 * Messages the widget itself authored (see toolResult.ts). Only these, plus
 * the timeout mapping, are ever shown to a child. Anything else, including
 * bridge, network, or auth diagnostics, collapses to GENERIC_ERROR_MESSAGE
 * and is logged for the developer instead.
 */
const CHILD_SAFE_MESSAGES = new Set([
  'Widget bridge returned an invalid result.',
  'Kidbot returned an invalid result. Please try again.',
  'Kidbot could not complete this request. Please try again.',
  'Kidbot is busy with another request. Please try again shortly.',
  'Too many requests. Please try again shortly.',
  'This request timed out. Please try again.',
]);

const RETRY_AFTER_PATTERN = /^Too many requests\. Try again in \d+ seconds\.$/;

const safeBridgeMessage = (message: string): string | undefined => {
  if (/request timed out|took too long/i.test(message)) {
    return 'This request timed out. Please try again.';
  }
  if (CHILD_SAFE_MESSAGES.has(message) || RETRY_AFTER_PATTERN.test(message)) return message;
  return undefined;
};

export const unavailableMessageFromError = (error: unknown): string | undefined => {
  const message = messageFromError(error);
  if (message && /503|temporarily degraded|temporarily unavailable/i.test(message)) {
    return SERVICE_UNAVAILABLE_MESSAGE;
  }

  return undefined;
};

/**
 * Child-facing message for any thrown value. Raw diagnostics never reach the
 * screen; they go to the console so a developer can still see them.
 */
export const errorMessage = (error: unknown): string => {
  const raw = messageFromError(error);
  const safe = raw ? safeBridgeMessage(raw) : undefined;
  if (safe) return safe;
  if (raw) {
    // eslint-disable-next-line no-console
    console.error('[kidbot] tool call failed:', raw);
  }
  return GENERIC_ERROR_MESSAGE;
};
