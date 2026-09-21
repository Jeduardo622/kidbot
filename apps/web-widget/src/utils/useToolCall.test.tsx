import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isVoiceResult, type VoiceResult } from './toolResult.js';
import { useToolCall } from './useToolCall.js';

const hostResult = (structuredContent: Record<string, unknown>) => ({ structuredContent });

describe('useToolCall', () => {
  const callTool = vi.fn();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    callTool.mockReset();
    consoleError.mockClear();
    (window as { openai?: unknown }).openai = { callTool };
  });

  afterEach(() => {
    cleanup();
    delete (window as { openai?: unknown }).openai;
  });

  it('returns a validated result and clears loading', async () => {
    callTool.mockResolvedValueOnce(hostResult({ blocked: false, persona: 'robot', text: 'Hi!' }));
    const { result } = renderHook(() => useToolCall<VoiceResult>('voice_chat', isVoiceResult));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.run({ text: 'hello', persona: 'robot' });
    });

    expect(outcome).toEqual({ kind: 'ok', result: { blocked: false, persona: 'robot', text: 'Hi!' } });
    expect(callTool).toHaveBeenCalledWith('voice_chat', { text: 'hello', persona: 'robot' });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('classifies blocked, degraded, and rejected calls', async () => {
    const { result } = renderHook(() => useToolCall<VoiceResult>('voice_chat', isVoiceResult));

    callTool.mockResolvedValueOnce(hostResult({ blocked: true, message: 'Paused.' }));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.run({});
    });
    expect(outcome).toEqual({ kind: 'blocked', message: 'Paused.' });
    expect(result.current.error).toBeUndefined();

    callTool.mockResolvedValueOnce(hostResult({ blocked: false, degraded: true, message: 'Down.' }));
    await act(async () => {
      outcome = await result.current.run({});
    });
    expect(outcome).toEqual({ kind: 'unavailable', message: 'Down.' });
    expect(result.current.unavailable).toBe('Down.');

    callTool.mockRejectedValueOnce(new Error('Unauthorized'));
    await act(async () => {
      outcome = await result.current.run({});
    });
    expect(outcome).toEqual({ kind: 'error', message: 'Something went wrong. Please try again.' });
    expect(result.current.error).toBe('Something went wrong. Please try again.');
    expect(consoleError).toHaveBeenCalledWith('[kidbot] tool call failed:', 'Unauthorized');
  });

  it('ignores a result that lands after a newer request started', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    callTool.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    callTool.mockResolvedValueOnce(hostResult({ blocked: false, persona: 'robot', text: 'Second' }));
    const { result } = renderHook(() => useToolCall<VoiceResult>('voice_chat', isVoiceResult));

    let first: Promise<unknown> = Promise.resolve();
    let second: unknown;
    await act(async () => {
      first = result.current.run({ text: 'one' });
      second = await result.current.run({ text: 'two' });
    });
    expect(second).toMatchObject({ kind: 'ok', result: { text: 'Second' } });

    let firstOutcome: unknown;
    await act(async () => {
      resolveFirst(hostResult({ blocked: false, persona: 'robot', text: 'First' }));
      firstOutcome = await first;
    });
    expect(firstOutcome).toEqual({ kind: 'stale' });
    expect(result.current.loading).toBe(false);
  });
});
