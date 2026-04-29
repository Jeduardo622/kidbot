import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComicBoard } from './ComicBoard.js';

describe('ComicBoard stale-state handling', () => {
  const callTool = vi.fn();

  beforeEach(() => {
    callTool.mockReset();
    (window as { openai?: unknown }).openai = {
      callTool,
      setWidgetState: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as { openai?: unknown }).openai;
  });

  it('clears previous panels when a later request fails', async () => {
    callTool.mockResolvedValueOnce({
      blocked: false,
      panels: [
        {
          title: 'Panel One',
          caption: 'A bright start.',
          imagePrompt: 'friendly comic panel',
          imageUrl: null,
        },
      ],
    });
    callTool.mockRejectedValueOnce(new Error('Unauthorized'));

    render(<ComicBoard />);

    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));
    await screen.findByText('Panel One');

    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));
    await waitFor(() => {
      expect(screen.queryAllByText('Unauthorized').length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.queryByText('Panel One')).toBeNull();
    });
  });

  it('shows provider degradation without rendering it as a story safety pause', async () => {
    callTool.mockResolvedValueOnce({
      blocked: false,
      degraded: true,
      message:
        'Kidbot is having trouble reaching its idea engine right now. Please try again in a moment.',
    });

    render(<ComicBoard />);

    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));

    await waitFor(() => {
      expect(
        screen.getAllByText(
          'Kidbot is having trouble reaching its idea engine right now. Please try again in a moment.',
        ).length,
      ).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Kidbot paused this story idea.')).toBeNull();
  });
});
