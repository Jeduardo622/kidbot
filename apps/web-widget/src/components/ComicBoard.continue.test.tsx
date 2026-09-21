import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComicBoard } from './ComicBoard.js';

const hostResult = (structuredContent: Record<string, unknown>) => ({ structuredContent });

const panel = (title: string, caption: string) => ({
  title,
  caption,
  imagePrompt: `${title} art`,
  imageUrl: null,
});

describe('ComicBoard continuation, narration, and saving', () => {
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

  const planStory = async () => {
    callTool.mockResolvedValueOnce(
      hostResult({
        blocked: false,
        theme: 'A brave turtle shares snacks',
        panels: [panel('Quiet Cave', 'Dara peeks out.'), panel('A Small Hello', 'A fox waves.')],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));
    await screen.findByText('A fox waves.');
  };

  it('shows skeleton panels while planning and hides the raw image prompt', async () => {
    let resolvePlan: (value: unknown) => void = () => undefined;
    callTool.mockImplementationOnce(() => new Promise((resolve) => { resolvePlan = resolve; }));
    const { container } = render(<ComicBoard />);

    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));
    await waitFor(() => expect(container.querySelectorAll('.panel-card.skeleton')).toHaveLength(4));

    resolvePlan(hostResult({ blocked: false, theme: 't', panels: [panel('One', 'First.')] }));
    await screen.findByText('First.');
    expect(container.querySelectorAll('.panel-card.skeleton')).toHaveLength(0);
    expect(screen.queryByText('One art')).toBeNull();
    expect(screen.getByRole('img', { name: 'Story panel artwork: One art' })).toBeTruthy();
  });

  it('asks what happens next from the last caption and appends the new panels', async () => {
    render(<ComicBoard />);
    await planStory();

    callTool.mockResolvedValueOnce(
      hostResult({ blocked: false, theme: 't', panels: [panel('Snacks', 'They share berries.')] }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'What happens next?' }));
    await screen.findByText('They share berries.');

    expect(callTool).toHaveBeenLastCalledWith(
      'story_panels',
      expect.objectContaining({ panels: 2, continueFrom: 'A fox waves.' }),
    );
    expect(screen.getByText('Dara peeks out.')).toBeTruthy();
    expect(screen.getByText('A fox waves.')).toBeTruthy();
  });

  it('reads the story aloud and can stop', async () => {
    render(<ComicBoard />);
    await planStory();

    fireEvent.click(screen.getByRole('button', { name: 'Read to me' }));
    expect(speak).toHaveBeenCalledTimes(1);
    expect((speak.mock.calls[0]?.[0] as { text: string }).text).toContain('Dara peeks out.');
    expect((speak.mock.calls[0]?.[0] as { text: string }).text).toContain('A fox waves.');

    fireEvent.click(screen.getByRole('button', { name: 'Stop reading' }));
    expect(cancel).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Read to me' })).toBeTruthy();
  });

  it('saves the story to the scrapbook once', async () => {
    const onSave = vi.fn();
    render(<ComicBoard onSaveToScrapbook={onSave} />);
    await planStory();

    fireEvent.click(screen.getByRole('button', { name: 'Save to My Creations' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'story', title: 'A brave turtle shares snacks' }),
    );
    expect((onSave.mock.calls[0]?.[0] as { panels: unknown[] }).panels).toHaveLength(2);
    expect(
      (screen.getByRole('button', { name: 'Saved to My Creations' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('renders a blocked story as a safety pause, not an error', async () => {
    callTool.mockResolvedValueOnce(hostResult({ blocked: true, message: 'Kidbot paused this story idea.' }));
    const { container } = render(<ComicBoard />);
    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));
    await screen.findAllByText('Kidbot paused this story idea.');
    expect(container.querySelector('.blocked')).toBeTruthy();
    expect(container.querySelector('.error')).toBeNull();
  });
});
