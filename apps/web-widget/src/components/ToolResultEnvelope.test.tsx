import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColoringBook } from './ColoringBook.js';
import { ComicBoard } from './ComicBoard.js';
import { ScienceLab } from './ScienceLab.js';
import { VoiceBar } from './VoiceBar.js';

describe('ChatGPT tool-result envelopes', () => {
  const callTool = vi.fn();
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    callTool.mockReset();
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    (window as { openai?: unknown }).openai = { callTool, setWidgetState: vi.fn() };
  });

  afterEach(() => {
    cleanup();
    getContextSpy.mockRestore();
    delete (window as { openai?: unknown }).openai;
  });

  it('VoiceBar renders successful structured content', async () => {
    callTool.mockResolvedValueOnce({
      structuredContent: { blocked: false, persona: 'robot', text: 'Envelope voice reply.' },
    });
    render(<VoiceBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
    expect(await screen.findByText('Envelope voice reply.')).toBeTruthy();
  });

  it('VoiceBar renders a blocked structured result', async () => {
    callTool.mockResolvedValueOnce({
      structuredContent: { blocked: true, message: 'Kidbot paused this request.' },
    });
    render(<VoiceBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
    expect((await screen.findAllByText('Kidbot paused this request.')).length).toBeGreaterThan(0);
  });

  it('ComicBoard renders successful structured content', async () => {
    callTool.mockResolvedValueOnce({
      structuredContent: {
        blocked: false,
        panels: [{ title: 'Envelope Panel', caption: 'Ready.', imagePrompt: 'sun', imageUrl: null }],
      },
    });
    render(<ComicBoard />);
    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));
    expect(await screen.findByText('Envelope Panel')).toBeTruthy();
  });

  it('ComicBoard renders a degraded structured result', async () => {
    callTool.mockResolvedValueOnce({
      structuredContent: {
        blocked: false,
        degraded: true,
        message: 'Kidbot is having trouble reaching its idea engine right now. Please try again in a moment.',
      },
    });
    render(<ComicBoard />);
    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));
    expect((await screen.findAllByText(/trouble reaching its idea engine/i)).length).toBeGreaterThan(0);
  });

  it('ColoringBook renders successful structured content', async () => {
    callTool.mockResolvedValueOnce({
      structuredContent: {
        blocked: false,
        svg: '<svg viewBox="0 0 10 10"><path d="M0 0 L10 10" /></svg>',
      },
    });
    render(<ColoringBook />);
    fireEvent.click(screen.getByRole('button', { name: 'Get Outline' }));
    await waitFor(() => expect(document.querySelector('.outline svg')).not.toBeNull());
  });

  it('ScienceLab renders successful structured content', async () => {
    callTool.mockResolvedValueOnce({
      structuredContent: {
        blocked: false,
        title: 'Envelope Experiment',
        objective: 'Observe envelopes.',
        materials: [],
        steps: [],
      },
    });
    render(<ScienceLab />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Experiment' }));
    expect(await screen.findByText('Envelope Experiment')).toBeTruthy();
  });

  it('rejects a malformed envelope as an error instead of treating it as tool content', async () => {
    callTool.mockResolvedValueOnce({ structuredContent: 'not-an-object' });
    render(<ScienceLab />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Experiment' }));
    expect((await screen.findAllByText('Widget bridge returned an invalid result.')).length).toBeGreaterThan(0);
  });

  it.each([
    ['VoiceBar', <VoiceBar key="voice-malformed" />, 'Speak', { blocked: false, persona: 'pirate', text: 42 }],
    ['ComicBoard', <ComicBoard key="comic-malformed" />, 'Plan Panels', { blocked: false, panels: 'not-panels' }],
    ['ColoringBook', <ColoringBook key="coloring-malformed" />, 'Get Outline', { blocked: false, svg: 42 }],
    [
      'ScienceLab',
      <ScienceLab key="science-malformed" />,
      'Generate Experiment',
      {
        blocked: false,
        title: 'Broken experiment',
        objective: 'Do not render this.',
        materials: [],
        steps: 'not-steps',
      },
    ],
  ])('%s rejects malformed structured content with a visible retry error', async (_name, view, action, structuredContent) => {
    callTool.mockResolvedValueOnce({ structuredContent });
    render(view);
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect((await screen.findAllByText('Kidbot returned an invalid result. Please try again.')).length).toBeGreaterThan(0);
  });

  it.each([
    [
      'VoiceBar',
      <VoiceBar key="voice-rate" />,
      'Speak',
      { error: true, code: 'rate_limited', retryAfter: 12 },
      'Too many requests. Try again in 12 seconds.',
    ],
    [
      'ComicBoard',
      <ComicBoard key="comic-concurrency" />,
      'Plan Panels',
      { error: true, code: 'concurrency_limited' },
      'Kidbot is busy with another request. Please try again shortly.',
    ],
    [
      'ColoringBook',
      <ColoringBook key="coloring-timeout" />,
      'Get Outline',
      { error: true, code: 'request_timeout' },
      'This request timed out. Please try again.',
    ],
    [
      'ScienceLab',
      <ScienceLab key="science-rate" />,
      'Generate Experiment',
      { error: true, code: 'rate_limited' },
      'Too many requests. Please try again shortly.',
    ],
  ])('%s renders advertised request-control guidance', async (_name, view, action, structuredContent, message) => {
    callTool.mockResolvedValueOnce({ isError: true, structuredContent });
    render(view);
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
  });

  it('fails closed on an isError envelope that lacks an advertised request-control result', async () => {
    callTool.mockResolvedValueOnce({
      isError: true,
      structuredContent: { blocked: false, persona: 'robot', text: 'Unsafe success.' },
    });
    render(<VoiceBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
    expect((await screen.findAllByText('Kidbot could not complete this request. Please try again.')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Unsafe success.')).toBeNull();
  });
});
