import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColoringBook } from './ColoringBook.js';

const hostResult = (structuredContent: Record<string, unknown>) => ({ structuredContent });

describe('ColoringBook completion interactions', () => {
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
    set lineWidth(_value: number) {},
    set strokeStyle(_value: string | CanvasGradient | CanvasPattern) {},
  };
  let imageShouldFail = false;

  beforeEach(() => {
    callTool.mockReset();
    Object.values(context).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) value.mockClear();
    });
    imageShouldFail = false;
    (window as { openai?: unknown }).openai = { callTool };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,combined');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:kidbot-outline'),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      'Image',
      class MockImage {
        onerror: (() => void) | null = null;
        onload: (() => void) | null = null;

        set src(_value: string) {
          queueMicrotask(() => (imageShouldFail ? this.onerror?.() : this.onload?.()));
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

  const loadOutline = async () => {
    callTool.mockResolvedValueOnce(
      hostResult({
        blocked: false,
        svg: '<svg viewBox="0 0 512 512"><path d="M0 0 L512 512" /></svg>',
      }),
    );
    render(<ColoringBook />);
    fireEvent.click(screen.getByRole('button', { name: 'Get Outline' }));
    await screen.findByText('Use arrow keys to draw from the center of the canvas.');
  };

  it('gives the canvas an accessible keyboard drawing interaction', async () => {
    await loadOutline();
    const canvas = screen.getByLabelText('Coloring canvas');

    expect(canvas.getAttribute('tabindex')).toBe('0');
    expect(canvas.getAttribute('aria-describedby')).toBe('coloring-canvas-instructions');
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });

    await waitFor(() => expect(context.lineTo).toHaveBeenCalled());
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('exports the visible outline and paint as one PNG', async () => {
    await loadOutline();
    fireEvent.keyDown(screen.getByLabelText('Coloring canvas'), { key: 'ArrowDown' });
    await waitFor(() => expect(context.stroke).toHaveBeenCalled());
    context.stroke.mockClear();
    context.drawImage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Save PNG' }));

    await screen.findByText('Coloring page saved.');
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 512, 512);
    expect(context.drawImage).toHaveBeenCalled();
    expect(context.stroke.mock.invocationCallOrder[0]).toBeLessThan(
      context.drawImage.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/png');
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:kidbot-outline');
  });

  it('shows an actionable error when the outline cannot be composited', async () => {
    await loadOutline();
    imageShouldFail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Save PNG' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Coloring page could not be saved',
    );
  });
});
