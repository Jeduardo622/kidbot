import { describe, expect, it } from 'vitest';
import {
  GenerationTimeoutError,
  MalformedOutputError,
  ModerationFailureError,
  ProviderUnavailableError,
  UnsafeOutputError,
  classifyProviderError,
  parseProviderFailurePolicy,
  withProviderRetry,
} from '../provider.js';

describe('provider failure policy', () => {
  it('allows fallback for local development by default', () => {
    expect(parseProviderFailurePolicy({ NODE_ENV: 'development', KIDBOT_LOCAL_DEV: '1' })).toEqual({
      allowFallback: true,
    });
  });

  it('returns degraded service in production unless fallback is explicit', () => {
    expect(parseProviderFailurePolicy({ NODE_ENV: 'production' })).toEqual({
      allowFallback: false,
    });
    expect(
      parseProviderFailurePolicy({ NODE_ENV: 'production', PROVIDER_FAILURE_POLICY: 'fallback' }),
    ).toEqual({
      allowFallback: true,
    });
  });

  it('classifies each explicit provider failure reason', () => {
    expect(classifyProviderError(new ModerationFailureError('moderation unavailable'))).toBe(
      'moderation_failure',
    );
    expect(classifyProviderError(new GenerationTimeoutError('generation timed out'))).toBe(
      'generation_timeout',
    );
    expect(classifyProviderError(new MalformedOutputError('bad JSON'))).toBe('malformed_output');
    expect(classifyProviderError(new UnsafeOutputError('unsafe output'))).toBe('unsafe_output');
    expect(classifyProviderError(new ProviderUnavailableError('provider unavailable'))).toBe(
      'provider_unavailable',
    );
  });

  it('wraps slow provider calls as generation timeouts', async () => {
    await expect(
      withProviderRetry(
        () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 50)),
        {
          timeoutMs: 1,
          retries: 0,
        },
      ),
    ).rejects.toBeInstanceOf(GenerationTimeoutError);
  });

  it('retries transient provider failures before surfacing unavailable', async () => {
    let attempts = 0;
    const result = await withProviderRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('temporary');
        }
        return 'ok';
      },
      { timeoutMs: 100, retries: 1 },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });
});
