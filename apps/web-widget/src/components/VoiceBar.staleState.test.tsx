import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceBar } from './VoiceBar.js';

describe('VoiceBar stale-state handling', () => {
  const callTool = vi.fn();

  beforeEach(() => {
    callTool.mockReset();
    (window as { openai?: unknown }).openai = {
      callTool,
      setWidgetState: vi.fn()
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as { openai?: unknown }).openai;
  });

  it('clears a previous successful response when a later request fails', async () => {
    callTool.mockResolvedValueOnce({
      blocked: false,
      persona: 'robot',
      text: 'Space fact ready!'
    });
    callTool.mockRejectedValueOnce(new Error('Unauthorized'));

    render(<VoiceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
    await screen.findByText('Space fact ready!');
    expect(screen.queryByRole('button', { name: 'Replay' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
    await waitFor(() => {
      expect(screen.queryAllByText('Unauthorized').length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.queryByText('Space fact ready!')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Replay' })).toBeNull();
    });
  });

  it('shows blocked feedback as an alert and hides previous success UI', async () => {
    callTool.mockResolvedValueOnce({
      blocked: false,
      persona: 'robot',
      text: 'A happy moon fact.'
    });
    callTool.mockResolvedValueOnce({
      blocked: true,
      message: 'KidBot paused this request.'
    });

    render(<VoiceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
    await screen.findByText('A happy moon fact.');

    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
    await waitFor(() => {
      expect(screen.queryAllByText('KidBot paused this request.').length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.queryByText('A happy moon fact.')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Replay' })).toBeNull();
    });
  });
});
