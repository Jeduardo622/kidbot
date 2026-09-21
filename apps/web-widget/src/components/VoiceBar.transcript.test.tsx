import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceBar } from './VoiceBar.js';

const hostResult = (structuredContent: Record<string, unknown>) => ({ structuredContent });

describe('VoiceBar conversation transcript and persona voices', () => {
  const callTool = vi.fn();
  const speak = vi.fn();
  const cancel = vi.fn();

  beforeEach(() => {
    callTool.mockReset();
    speak.mockReset();
    cancel.mockReset();
    (window as { openai?: unknown }).openai = { callTool, setWidgetState: vi.fn() };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel, speak } });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class {
        rate = 1;
        pitch = 1;
        onend: (() => void) | null = null;
        constructor(public readonly text: string) {}
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as { openai?: unknown }).openai;
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
    delete (window as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
  });

  const ask = async (question: string, reply: string) => {
    callTool.mockResolvedValueOnce(hostResult({ blocked: false, persona: 'robot', text: reply }));
    fireEvent.change(screen.getByLabelText('Your question or story idea'), { target: { value: question } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByText(reply);
  };

  it('keeps a transcript and replays recent turns as history', async () => {
    render(<VoiceBar />);
    await ask('Why is the sky blue?', 'Sunlight scatters!');
    await ask('And at sunset?', 'Longer light waves win.');

    const conversation = screen.getByRole('list', { name: 'Conversation' });
    expect(conversation.textContent).toContain('Why is the sky blue?');
    expect(conversation.textContent).toContain('Sunlight scatters!');
    expect(conversation.textContent).toContain('And at sunset?');

    expect(callTool).toHaveBeenLastCalledWith(
      'voice_chat',
      expect.objectContaining({
        text: 'And at sunset?',
        history: [
          { role: 'child', text: 'Why is the sky blue?' },
          { role: 'kidbot', text: 'Sunlight scatters!' },
        ],
      }),
    );
    expect(callTool.mock.calls[0]?.[1]).not.toHaveProperty('history');
  });

  it('uses the persona voice preset and offers a Stop control while speaking', async () => {
    render(<VoiceBar />);
    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'fairy' } });
    await ask('Hello', 'Sparkle hello!');

    expect(speak.mock.calls[0]?.[0]).toMatchObject({ rate: 1.1, pitch: 1.5 });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(cancel).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('explains an unsupported microphone instead of only disabling the button', () => {
    render(<VoiceBar />);
    expect(
      (screen.getByRole('button', { name: 'Voice Input Unavailable' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/needs a browser with speech recognition/)).toBeTruthy();
  });

  it('clears the chat', async () => {
    render(<VoiceBar />);
    await ask('Hi', 'Hello there!');
    fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
    expect(screen.queryByRole('list', { name: 'Conversation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Replay' })).toBeNull();
  });
});
