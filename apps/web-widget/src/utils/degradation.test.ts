import { describe, expect, it } from 'vitest';

import {
  SERVICE_UNAVAILABLE_MESSAGE,
  errorMessage,
  unavailableMessageFromError,
} from './degradation.js';

describe('bridge error messages', () => {
  it('maps a genuine foreign timeout Error to curated child-facing copy', () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const foreignWindow = iframe.contentWindow;
    if (!foreignWindow) throw new Error('Expected an iframe window.');
    const ForeignError = (foreignWindow as unknown as { Error: ErrorConstructor }).Error;
    const foreignError = new ForeignError('Tool request timed out after 60000ms.');

    expect(foreignError instanceof Error).toBe(false);
    expect(errorMessage(foreignError)).toBe('This request timed out. Please try again.');
    iframe.remove();
  });

  it('does not expose arbitrary diagnostics from an Error-like bridge value', () => {
    expect(errorMessage({ message: 'Provider request failed at https://internal.example.test' })).toBe(
      'Something went wrong.',
    );
  });

  it('recognizes service-unavailable messages from Error-like bridge values', () => {
    expect(unavailableMessageFromError({ message: 'Agent request failed with status 503' })).toBe(
      SERVICE_UNAVAILABLE_MESSAGE,
    );
  });

  it('keeps the generic fallback for values without a usable message', () => {
    expect(errorMessage({ message: '   ' })).toBe('Something went wrong.');
  });

  it('fails closed when an Error-like message getter throws', () => {
    const error = Object.defineProperty({}, 'message', {
      get() {
        throw new Error('getter failed');
      },
    });

    expect(errorMessage(error)).toBe('Something went wrong.');
  });
});
