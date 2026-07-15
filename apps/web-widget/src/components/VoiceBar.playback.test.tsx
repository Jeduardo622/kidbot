import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceBar } from './VoiceBar.js';

const hostResult = (structuredContent: Record<string, unknown>) => ({ structuredContent });

class MockSpeechSynthesisUtterance {
  rate = 1;

  constructor(public readonly text: string) {}
}

describe('VoiceBar speech playback', () => {
  const callTool = vi.fn();
  const cancel = vi.fn();
  const speak = vi.fn();

  const installSpeechPlayback = () => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel,
        speak,
      },
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: MockSpeechSynthesisUtterance,
    });
  };

  beforeEach(() => {
    callTool.mockReset();
    cancel.mockReset();
    speak.mockReset();
    installSpeechPlayback();
    (window as { openai?: unknown }).openai = {
      callTool,
      setWidgetState: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as { openai?: unknown }).openai;
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
    delete (window as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
  });

  it('speaks successful replies and replays them on request', async () => {
    callTool.mockResolvedValueOnce(hostResult({
      blocked: false,
      persona: 'robot',
      text: 'A happy moon fact.',
    }));

    render(<VoiceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));

    await waitFor(() => {
      expect(speak).toHaveBeenCalledTimes(1);
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0]?.[0]).toMatchObject({
      rate: 1.05,
      text: 'A happy moon fact.',
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Replay' }));

    await waitFor(() => {
      expect(speak).toHaveBeenCalledTimes(2);
    });
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('does not speak blocked replies', async () => {
    callTool.mockResolvedValueOnce(hostResult({
      blocked: true,
      message: 'Kidbot paused this request.',
    }));

    render(<VoiceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));

    await waitFor(() => {
      expect(screen.getAllByText('Kidbot paused this request.').length).toBeGreaterThan(0);
    });
    expect(speak).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('does not speak degraded replies', async () => {
    callTool.mockResolvedValueOnce(hostResult({
      blocked: false,
      degraded: true,
      message:
        'Kidbot is having trouble reaching its idea engine right now. Please try again in a moment.',
    }));

    render(<VoiceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));

    await waitFor(() => {
      expect(
        screen.getAllByText(
          'Kidbot is having trouble reaching its idea engine right now. Please try again in a moment.',
        ).length,
      ).toBeGreaterThan(0);
    });
    expect(speak).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('renders successful replies when browser speech playback is unavailable', async () => {
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
    delete (window as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
    callTool.mockResolvedValueOnce(hostResult({
      blocked: false,
      persona: 'robot',
      text: 'Space fact ready!',
    }));

    render(<VoiceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));

    await screen.findByText('Space fact ready!');
    expect(screen.queryByRole('button', { name: 'Replay' })).not.toBeNull();
    expect(speak).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
});
