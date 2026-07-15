export const SERVICE_UNAVAILABLE_MESSAGE =
  'Kidbot is having trouble reaching its idea engine right now. Please try again in a moment.';

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

const safeBridgeMessage = (message: string): string | undefined => {
  if (/request timed out|took too long/i.test(message)) {
    return 'This request timed out. Please try again.';
  }
  if (message === 'Widget bridge returned an invalid result.') return message;
  if (message === 'Kidbot returned an invalid result. Please try again.') return message;
  return undefined;
};

export const unavailableMessageFromError = (error: unknown): string | undefined => {
  const message = messageFromError(error);
  if (message && /503|temporarily degraded|temporarily unavailable/i.test(message)) {
    return SERVICE_UNAVAILABLE_MESSAGE;
  }

  return undefined;
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? (error.message || 'Something went wrong.')
    : safeBridgeMessage(messageFromError(error) ?? '') ?? 'Something went wrong.';
