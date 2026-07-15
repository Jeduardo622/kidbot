import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComicBoard, PanelArtwork } from './ComicBoard.js';

const hostResult = (structuredContent: Record<string, unknown>) => ({ structuredContent });

describe('ComicBoard artwork rendering', () => {
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

  it('renders an accessible placeholder for a null imageUrl without dropping panel layout', async () => {
    callTool.mockResolvedValueOnce(hostResult({
      blocked: false,
      theme: 'A brave turtle shares snacks',
      panels: [
        {
          title: 'Quiet Cave',
          caption: 'Dara peeks out.',
          imagePrompt: 'friendly dragon in a cozy cave',
          imageUrl: null,
        },
      ],
    }));

    render(<ComicBoard />);

    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));

    const panel = (await screen.findByText('Quiet Cave')).closest('article');
    expect(panel).not.toBeNull();
    if (!panel) {
      throw new Error('Expected Quiet Cave to render inside a panel card.');
    }
    expect(
      within(panel)
        .getByRole('img', { name: 'Story panel artwork: friendly dragon in a cozy cave' })
        .classList.contains('panel-artwork-placeholder'),
    ).toBe(true);
    expect(within(panel).queryByRole('img', { name: 'friendly dragon in a cozy cave' })).toBeNull();
    expect(within(panel).getByText('Dara peeks out.')).toBeTruthy();
    expect(within(panel).getByText('friendly dragon in a cozy cave')).toBeTruthy();
  });

  it('renders a real imageUrl as an image with stable prompt-based alt text', async () => {
    callTool.mockResolvedValueOnce(hostResult({
      blocked: false,
      theme: 'A brave turtle shares snacks',
      panels: [
        {
          title: 'New Friends',
          caption: 'They wave together.',
          imagePrompt: 'happy dragon and fox at sunset',
          imageUrl: 'https://cdn.example.test/story/new-friends.png',
        },
      ],
    }));

    render(<ComicBoard />);

    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));

    const image = await screen.findByRole('img', { name: 'Story panel artwork: happy dragon and fox at sunset' });
    expect(image).toBeInstanceOf(HTMLImageElement);
    expect(image.getAttribute('src')).toBe('https://cdn.example.test/story/new-friends.png');
  });

  it('replaces artwork that fails to load with the accessible placeholder', async () => {
    callTool.mockResolvedValueOnce(hostResult({
      blocked: false,
      theme: 'A brave turtle shares snacks',
      panels: [
        {
          title: 'Forest Friends',
          caption: 'The friends keep exploring.',
          imagePrompt: 'fox and owl exploring a friendly forest',
          imageUrl: 'https://cdn.example.test/story/expired.png',
        },
      ],
    }));

    render(<ComicBoard />);

    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));

    const accessibleName = 'Story panel artwork: fox and owl exploring a friendly forest';
    const image = await screen.findByRole('img', { name: accessibleName });
    expect(image).toBeInstanceOf(HTMLImageElement);

    fireEvent.error(image);

    const panel = screen.getByText('Forest Friends').closest('article');
    expect(panel).not.toBeNull();
    if (!panel) {
      throw new Error('Expected Forest Friends to render inside a panel card.');
    }
    const fallback = within(panel).getByRole('img', { name: accessibleName });
    expect(fallback).not.toBeInstanceOf(HTMLImageElement);
    expect(fallback.classList.contains('panel-artwork-placeholder')).toBe(true);
    expect(within(panel).getByText('The friends keep exploring.')).toBeTruthy();
  });

  it('attempts a changed imageUrl after the previous URL failed', () => {
    const panel = {
      title: 'Sky Friends',
      caption: 'The friends look up.',
      imagePrompt: 'owl and fox watching clouds',
      imageUrl: 'https://cdn.example.test/story/expired.png',
    };
    const { rerender } = render(<PanelArtwork panel={panel} />);

    const accessibleName = 'Story panel artwork: owl and fox watching clouds';
    fireEvent.error(screen.getByRole('img', { name: accessibleName }));
    expect(screen.getByRole('img', { name: accessibleName })).not.toBeInstanceOf(HTMLImageElement);

    const replacementUrl = 'https://cdn.example.test/story/replacement.png';
    rerender(<PanelArtwork panel={{ ...panel, imageUrl: replacementUrl }} />);

    const replacement = screen.getByRole('img', { name: accessibleName });
    expect(replacement).toBeInstanceOf(HTMLImageElement);
    expect(replacement.getAttribute('src')).toBe(replacementUrl);
  });

  it('clears stale panels when a later response is blocked', async () => {
    callTool.mockResolvedValueOnce(hostResult({
      blocked: false,
      theme: 'A brave turtle shares snacks',
      panels: [
        {
          title: 'Sunny Start',
          caption: 'A sunny story begins.',
          imagePrompt: 'sunny comic panel',
          imageUrl: null,
        },
      ],
    }));
    callTool.mockResolvedValueOnce(hostResult({
      blocked: true,
      message: 'Kidbot paused this story idea.',
    }));

    render(<ComicBoard />);

    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));
    await screen.findByText('Sunny Start');

    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));
    await waitFor(() => {
      expect(screen.getAllByText('Kidbot paused this story idea.').length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.queryByText('Sunny Start')).toBeNull();
    });
  });

  it('clears stale panels when a later response is degraded', async () => {
    callTool.mockResolvedValueOnce(hostResult({
      blocked: false,
      theme: 'A brave turtle shares snacks',
      panels: [
        {
          title: 'Bright Path',
          caption: 'Friends walk together.',
          imagePrompt: 'bright path comic panel',
          imageUrl: null,
        },
      ],
    }));
    callTool.mockResolvedValueOnce(hostResult({
      blocked: false,
      degraded: true,
      message: 'Kidbot is having trouble reaching its idea engine right now. Please try again in a moment.',
    }));

    render(<ComicBoard />);

    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));
    await screen.findByText('Bright Path');

    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));
    await waitFor(() => {
      expect(
        screen.getAllByText('Kidbot is having trouble reaching its idea engine right now. Please try again in a moment.')
          .length,
      ).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.queryByText('Bright Path')).toBeNull();
    });
  });

  it('keeps requested panel count and theme behavior unchanged', async () => {
    callTool.mockResolvedValueOnce(hostResult({
      blocked: false,
      theme: 'A tiny inventor builds a kite',
      panels: [],
    }));

    render(<ComicBoard />);

    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'A tiny inventor builds a kite' } });
    fireEvent.change(screen.getByLabelText('Panels'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));

    await waitFor(() => {
      expect(callTool).toHaveBeenCalledWith(
        'story_panels',
        expect.objectContaining({
          theme: 'A tiny inventor builds a kite',
          panels: 6,
        }),
      );
    });
  });
});
