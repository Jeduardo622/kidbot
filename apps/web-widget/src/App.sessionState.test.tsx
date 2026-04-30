import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './main.js';

describe('App parent/session safety controls', () => {
  const callTool = vi.fn();
  const setWidgetState = vi.fn();
  const requestDisplayMode = vi.fn();
  let savedState: Record<string, unknown> | undefined;

  beforeEach(() => {
    callTool.mockReset();
    setWidgetState.mockReset();
    requestDisplayMode.mockReset();
    savedState = undefined;
    setWidgetState.mockImplementation((state: Record<string, unknown>) => {
      savedState = state;
    });
    (window as { openai?: unknown }).openai = {
      callTool,
      getWidgetState: () => savedState,
      requestDisplayMode,
      setWidgetState,
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as { openai?: unknown }).openai;
  });

  it('creates and persists a local session state', async () => {
    render(<App />);

    await waitFor(() => {
      expect(setWidgetState).toHaveBeenCalled();
    });

    expect(savedState?.sessionId).toMatch(/^kb_session_/);
    expect(savedState?.profileId).toBe('local-default');
    expect(savedState?.ageBand).toBe('7-9');
    expect(savedState?.parentModeUnlocked).toBe(false);
  });

  it('uses a session PIN to unlock and change the locked age band', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Create parent PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set Parent PIN' }));

    await screen.findByText('Parent controls unlocked.');
    fireEvent.change(screen.getByLabelText('Locked age'), { target: { value: '10-12' } });

    await waitFor(() => {
      expect(savedState?.ageBand).toBe('10-12');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Lock Parent Controls' }));
    fireEvent.change(screen.getByLabelText('Parent PIN'), { target: { value: '9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Parent Controls' }));

    await screen.findByText('PIN did not match.');
    expect(screen.queryByLabelText('Locked age')).toBeNull();
  });

  it('sends locked session metadata to child tool calls', async () => {
    callTool.mockResolvedValue({
      blocked: false,
      persona: 'robot',
      text: 'A happy moon fact.',
    });
    savedState = {
      ageBand: '4-6',
      parentPin: '1234',
      parentPinSet: true,
      profileId: 'local-default',
      sessionId: 'kb_session_existing123',
      tab: 'voice',
    };

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));

    await waitFor(() => {
      expect(callTool).toHaveBeenCalledWith(
        'voice_chat',
        expect.objectContaining({
          ageBand: '4-6',
          profileId: 'local-default',
          sessionId: 'kb_session_existing123',
        }),
      );
    });
    expect(screen.queryByLabelText('Age')).toBeNull();
  });
});
