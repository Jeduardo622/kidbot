import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBoundedRequest } from '../requestDeadline.js';
import { GenerationTimeoutError } from '../provider.js';

afterEach(() => { vi.useRealTimers(); });
describe('complete request deadline', () => {
  it('aborts all work and returns even when a dependency ignores cancellation', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const pending = runBoundedRequest((value) => { signal = value; return new Promise(() => undefined); }, new AbortController().signal, 50);
    const assertion = expect(pending).rejects.toBeInstanceOf(GenerationTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(signal.aborted).toBe(true);
  });
  it('cancels sibling operations when one fails', async () => {
    let signal!: AbortSignal;
    await expect(runBoundedRequest((value) => { signal = value; throw new Error('failed'); }, new AbortController().signal, 50)).rejects.toThrow('failed');
    expect(signal.aborted).toBe(true);
  });
  it('does not start already cancelled work', async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn();
    await expect(runBoundedRequest(operation, controller.signal, 50)).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
  });
});
