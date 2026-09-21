import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColoringBook } from './ColoringBook.js';

const hostResult = (structuredContent: Record<string, unknown>) => ({ structuredContent });

describe('ColoringBook starter outlines', () => {
  const callTool = vi.fn();
  const context = {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    stroke: vi.fn(),
    set fillStyle(_value: string) {},
    set lineCap(_value: CanvasLineCap) {},
    set lineJoin(_value: CanvasLineJoin) {},
    set lineWidth(_value: number) {},
    set strokeStyle(_value: string | CanvasGradient | CanvasPattern) {},
    set globalCompositeOperation(_value: GlobalCompositeOperation) {},
  };

  beforeEach(() => {
    callTool.mockReset();
    (window as { openai?: unknown }).openai = { callTool };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    vi.stubGlobal(
      'Image',
      class MockImage {
        onerror: (() => void) | null = null;
        onload: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as { openai?: unknown }).openai;
  });

  it('applies a starter instantly without a tool call', () => {
    const { container } = render(<ColoringBook />);
    fireEvent.click(screen.getByRole('button', { name: 'Ready rocket' }));
    expect(callTool).not.toHaveBeenCalled();
    expect(container.querySelector('.outline svg')).toBeTruthy();
  });

  it('keeps the starter and its strokes when a pending outline request resolves later', async () => {
    let resolveOutline: (value: unknown) => void = () => undefined;
    callTool.mockImplementationOnce(() => new Promise((resolve) => { resolveOutline = resolve; }));
    const { container } = render(<ColoringBook />);

    fireEvent.click(screen.getByRole('button', { name: 'Get Outline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Happy fish' }));
    const canvas = screen.getByLabelText('Coloring canvas');
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      resolveOutline(
        hostResult({ blocked: false, svg: '<svg viewBox="0 0 512 512"><path d="M0 0 L1 1" /></svg>' }),
      );
    });

    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false);
    expect(container.querySelector('.outline')?.innerHTML).toContain('M220 512');
    expect(screen.getByRole('button', { name: 'Get Outline' }).textContent).toBe('Get Outline');
  });
});
