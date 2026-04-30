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

  it('creates a persistent parent profile token after PIN setup', async () => {
    callTool.mockImplementation(async (name: string) => {
      if (name === 'parent_profile_create') {
        return {
          ageBand: '7-9',
          historyEnabled: true,
          parentAccessToken: 'kb_parent_widgettoken1234567890',
          profileId: 'kb_profile_widget123',
        };
      }
      return undefined;
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText('Create parent PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set Parent PIN' }));

    await waitFor(() => {
      expect(savedState?.profileId).toBe('kb_profile_widget123');
      expect(savedState?.parentAccessToken).toBe('kb_parent_widgettoken1234567890');
      expect(savedState?.historyEnabled).toBe(true);
    });
    expect(callTool).toHaveBeenCalledWith('parent_profile_create', {
      ageBand: '7-9',
      sessionId: expect.stringMatching(/^kb_session_/),
    });
  });

  it('restores a parent profile token while keeping parent controls locked', async () => {
    savedState = {
      ageBand: '10-12',
      historyEnabled: true,
      parentAccessToken: 'kb_parent_existingtoken1234567890',
      parentPin: '1234',
      parentPinSet: true,
      profileId: 'kb_profile_existing123',
      sessionId: 'kb_session_existing456',
      tab: 'voice',
    };

    render(<App />);

    await waitFor(() => {
      expect(savedState?.profileId).toBe('kb_profile_existing123');
      expect(savedState?.parentAccessToken).toBe('kb_parent_existingtoken1234567890');
    });
    expect(screen.queryByLabelText('Locked age')).toBeNull();
  });

  it('persists age updates and sends parent token only when history is enabled', async () => {
    callTool.mockImplementation(async (name: string) => {
      if (name === 'parent_profile_update') {
        return {
          ageBand: '4-6',
          historyEnabled: true,
          profileId: 'kb_profile_existing123',
        };
      }
      if (name === 'voice_chat') {
        return {
          blocked: false,
          persona: 'robot',
          text: 'A happy moon fact.',
        };
      }
      return undefined;
    });
    savedState = {
      ageBand: '7-9',
      historyEnabled: true,
      parentAccessToken: 'kb_parent_existingtoken1234567890',
      parentPin: '1234',
      parentPinSet: true,
      profileId: 'kb_profile_existing123',
      sessionId: 'kb_session_existing456',
      tab: 'voice',
    };

    render(<App />);

    fireEvent.change(screen.getByLabelText('Parent PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Parent Controls' }));
    await screen.findByLabelText('Locked age');
    fireEvent.change(screen.getByLabelText('Locked age'), { target: { value: '4-6' } });

    await waitFor(() => {
      expect(callTool).toHaveBeenCalledWith('parent_profile_update', {
        ageBand: '4-6',
        parentAccessToken: 'kb_parent_existingtoken1234567890',
        profileId: 'kb_profile_existing123',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
    await waitFor(() => {
      expect(callTool).toHaveBeenCalledWith(
        'voice_chat',
        expect.objectContaining({
          ageBand: '4-6',
          parentAccessToken: 'kb_parent_existingtoken1234567890',
          profileId: 'kb_profile_existing123',
          sessionId: 'kb_session_existing456',
        }),
      );
    });
  });
});
