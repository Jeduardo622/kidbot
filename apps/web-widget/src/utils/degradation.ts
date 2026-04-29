export const SERVICE_UNAVAILABLE_MESSAGE =
  'Kidbot is having trouble reaching its idea engine right now. Please try again in a moment.';

export interface DegradedResult {
  degraded?: boolean;
  message?: string;
}

export const degradedMessage = (result: DegradedResult): string | undefined =>
  result.degraded ? (result.message ?? SERVICE_UNAVAILABLE_MESSAGE) : undefined;

export const unavailableMessageFromError = (error: unknown): string | undefined => {
  if (
    error instanceof Error &&
    /503|temporarily degraded|temporarily unavailable/i.test(error.message)
  ) {
    return SERVICE_UNAVAILABLE_MESSAGE;
  }

  return undefined;
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong.';
