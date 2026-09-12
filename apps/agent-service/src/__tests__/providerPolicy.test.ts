import { describe, expect, it } from 'vitest';
import {
  GenerationTimeoutError,
  MalformedOutputError,
  ModerationFailureError,
  ProviderUnavailableError,
  UnsafeOutputError,
  classifyProviderError,
  bindProviderSignal,
  parseProviderFailurePolicy,
  parseProviderRetryOptions,
  safeProviderErrorSummary,
  withProviderRetry,
} from '../provider.js';

describe('provider failure policy', () => {
  it('parses bounded provider timeouts and retry counts', () => {
    expect(parseProviderRetryOptions({})).toEqual({ timeoutMs: 15_000, retries: 1 });
    expect(parseProviderRetryOptions({
      PROVIDER_TIMEOUT_MS: '180000',
      PROVIDER_RETRIES: '2',
    })).toEqual({ timeoutMs: 180_000, retries: 2 });

    for (const value of ['0', '1.5', '180001', 'Infinity', 'NaN']) {
      expect(() => parseProviderRetryOptions({ PROVIDER_TIMEOUT_MS: value })).toThrow(
        /PROVIDER_TIMEOUT_MS must be an integer between 1 and 180000/i,
      );
    }
    for (const value of ['-1', '1.5', '3', 'Infinity', 'NaN']) {
      expect(() => parseProviderRetryOptions({ PROVIDER_RETRIES: value })).toThrow(
        /PROVIDER_RETRIES must be an integer between 0 and 2/i,
      );
    }
  });

  it('binds the request signal to every provider operation', async () => {
    const controller = new AbortController();
    const observed: AbortSignal[] = [];
    const provider = bindProviderSignal({
      async generateText(_request, signal) {
        if (signal) observed.push(signal);
        return 'ok';
      },
      async generateImage(_request, signal) {
        if (signal) observed.push(signal);
        return 'png';
      },
      async moderateImage(_pngBase64, signal) {
        if (signal) observed.push(signal);
        return { blocked: false };
      },
      async moderateText(_text, signal) {
        if (signal) observed.push(signal);
        return { blocked: false };
      },
    }, controller.signal);

    await provider.generateText({ task: 'voice', system: 'safe', user: 'hello' });
    await provider.generateImage?.({ prompt: 'safe' });
    await provider.moderateImage?.('cG5n');
    await provider.moderateText('safe');
    expect(observed).toEqual([
      controller.signal,
      controller.signal,
      controller.signal,
      controller.signal,
    ]);
  });

  it('allows fallback for local development by default', () => {
    expect(parseProviderFailurePolicy({ NODE_ENV: 'development', KIDBOT_LOCAL_DEV: '1' })).toEqual({
      allowFallback: true,
    });
  });

  it('forces degraded service and rejects fixture fallback in production startup policy', () => {
    expect(parseProviderFailurePolicy({ NODE_ENV: 'production' })).toEqual({
      allowFallback: false,
    });
    expect(() =>
      parseProviderFailurePolicy({ NODE_ENV: 'production', PROVIDER_FAILURE_POLICY: 'fallback' }),
    ).toThrow(/PROVIDER_FAILURE_POLICY=fallback is not allowed in production/i);
    expect(parseProviderFailurePolicy({
      NODE_ENV: 'production',
      KIDBOT_LOCAL_DEV: '1',
    })).toEqual({ allowFallback: false });
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

  it('summarizes provider errors without serializing arbitrary error text', () => {
    const sentinel = 'prompt=PRIVATE token=SECRET profile=profile-123 session=session-456 https://private.example/image.png?token=SECRET';
    const error = Object.assign(new Error(sentinel), { status: 503 });

    const serialized = JSON.stringify(safeProviderErrorSummary(error));

    expect(serialized).toContain('provider_unavailable');
    expect(serialized).toContain('503');
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain('PRIVATE');
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('profile-123');
    expect(serialized).not.toContain('session-456');
    expect(serialized).not.toContain('https://private.example');
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

  it('aborts timed-out provider work and does not retry it in the background', async () => {
    let attempts = 0;
    let observedAbort = false;
    await expect(
      withProviderRetry(
        (signal) => new Promise<string>((_resolve, reject) => {
          attempts += 1;
          signal.addEventListener('abort', () => {
            observedAbort = true;
            reject(signal.reason);
          }, { once: true });
        }),
        { timeoutMs: 5, retries: 2 },
      ),
    ).rejects.toBeInstanceOf(GenerationTimeoutError);

    expect(attempts).toBe(1);
    expect(observedAbort).toBe(true);
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
