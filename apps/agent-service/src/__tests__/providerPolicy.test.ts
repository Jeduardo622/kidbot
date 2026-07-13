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
  withProviderRetry,
} from '../provider.js';

describe('provider failure policy', () => {
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
      async moderateText(_text, signal) {
        if (signal) observed.push(signal);
        return { blocked: false };
      },
    }, controller.signal);

    await provider.generateText({ task: 'voice', system: 'safe', user: 'hello' });
    await provider.generateImage?.({ prompt: 'safe' });
    await provider.moderateText('safe');
    expect(observed).toEqual([controller.signal, controller.signal, controller.signal]);
  });

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
