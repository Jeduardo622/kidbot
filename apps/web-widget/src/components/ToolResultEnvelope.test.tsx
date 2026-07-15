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
});
