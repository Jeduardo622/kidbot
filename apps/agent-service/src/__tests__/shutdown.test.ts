import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDrain } from '../shutdown.js';

afterEach(() => { vi.useRealTimers(); });
describe('bounded service drain', () => {
  it('marks unready immediately, closes admission once, and releases dependencies after requests finish', async () => {
    let complete!: () => void;
    const server = { close: vi.fn((callback: () => void) => { complete = callback; }), closeAllConnections: vi.fn() };
    const unready = vi.fn();
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const drain = createDrain(server, unready, cleanup);
    const first = drain();
    const second = drain();
    expect(unready).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
    complete();
    await Promise.all([first, second]);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(server.closeAllConnections).not.toHaveBeenCalled();
  });
  it('terminates stuck connections at the deadline', async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    const server = {
      close: vi.fn((callback: () => void) => { complete = callback; }),
      closeAllConnections: vi.fn(() => complete()),
    };
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const drain = createDrain(server, vi.fn(), cleanup, 100);
    const done = drain();
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
