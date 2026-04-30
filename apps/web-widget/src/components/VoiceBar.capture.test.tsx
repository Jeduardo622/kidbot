import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceBar } from './VoiceBar.js';

interface MockSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly 0: {
    readonly transcript: string;
  };
}

interface MockSpeechRecognitionResultEvent {
  readonly results: ArrayLike<MockSpeechRecognitionResult>;
}

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];

  continuous = true;
  interimResults = true;
  lang = '';
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onresult: ((event: MockSpeechRecognitionResultEvent) => void) | null = null;
  onstart: (() => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn(() => this.onend?.());

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }
}

const finalTranscriptEvent = (transcript: string): MockSpeechRecognitionResultEvent => ({
  results: {
    0: {
      0: { transcript },
      isFinal: true,
    },
    length: 1,
  },
});

describe('VoiceBar voice capture', () => {
  const callTool = vi.fn();

  const installVoiceCapture = () => {
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: MockSpeechRecognition,
    });
  };

  beforeEach(() => {
    callTool.mockReset();
    MockSpeechRecognition.instances = [];
    (window as { openai?: unknown }).openai = {
      callTool,
      setWidgetState: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as { openai?: unknown }).openai;
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });

  it('shows disabled unavailable control when speech recognition is unsupported', () => {
    render(<VoiceBar />);

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Voice Input Unavailable' }).disabled,
    ).toBe(true);
  });

  it('starts supported voice capture and shows the stop control', async () => {
    installVoiceCapture();

    render(<VoiceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Start Voice Input' }));

    const recognition = MockSpeechRecognition.instances[0];
    expect(recognition?.continuous).toBe(false);
    expect(recognition?.interimResults).toBe(false);
    expect(recognition?.lang).toBe('en-US');
    expect(recognition?.start).toHaveBeenCalledTimes(1);
    await screen.findByRole('button', { name: 'Stop Voice Input' });
  });

  it('writes captured transcript into the textarea without submitting', async () => {
    installVoiceCapture();

    render(<VoiceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Start Voice Input' }));
    MockSpeechRecognition.instances[0]?.onresult?.(finalTranscriptEvent('Tell me about Saturn'));

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText<HTMLTextAreaElement>('Ask a question or share a topic').value,
      ).toBe('Tell me about Saturn');
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('stops supported voice capture and returns to idle', async () => {
    installVoiceCapture();

    render(<VoiceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Start Voice Input' }));
    const recognition = MockSpeechRecognition.instances[0];

    fireEvent.click(await screen.findByRole('button', { name: 'Stop Voice Input' }));

    expect(recognition?.stop).toHaveBeenCalledTimes(1);
    await screen.findByRole('button', { name: 'Start Voice Input' });
  });

  it('stops active capture on unmount', async () => {
    installVoiceCapture();

    const { unmount } = render(<VoiceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Start Voice Input' }));
    await screen.findByRole('button', { name: 'Stop Voice Input' });
    const recognition = MockSpeechRecognition.instances[0];

    unmount();

    expect(recognition?.stop).toHaveBeenCalledTimes(1);
  });
});
