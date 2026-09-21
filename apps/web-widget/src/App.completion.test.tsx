import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './main.js';

describe('App completion flows', () => {
  const callTool = vi.fn();

  beforeEach(() => {
    callTool.mockReset();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    (window as { openai?: unknown }).openai = {
      callTool,
      requestDisplayMode: vi.fn(),
      setWidgetState: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window as { openai?: unknown }).openai;
  });

  const unlockAndEnableHistory = async () => {
    fireEvent.change(screen.getByLabelText('Create parent PIN'), { target: { value: '1234' } });
    fireEvent.change(screen.getByLabelText('Confirm PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set Parent PIN' }));
    callTool.mockResolvedValueOnce({
      structuredContent: {
        ageBand: '7-9',
        historyEnabled: true,
        profileId: 'kb_profile_widget123',
      },
      _meta: { parentAccessToken: 'kb_parent_widgettoken1234567890' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /save activity history/i }));
    await screen.findByText('History is enabled.');
  };

  it('keeps feature work mounted while switching tabs', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Coloring' }));
    fireEvent.change(screen.getByLabelText('Scene'), { target: { value: 'My saved sketch' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Science Lab' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Coloring' }));

    expect((screen.getByLabelText('Scene') as HTMLInputElement).value).toBe('My saved sketch');
  });

  it('clears mounted feature state when the locked age changes', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Coloring' }));
    fireEvent.change(screen.getByLabelText('Scene'), { target: { value: 'Age-specific sketch' } });
    fireEvent.change(screen.getByLabelText('Create parent PIN'), { target: { value: '1234' } });
    fireEvent.change(screen.getByLabelText('Confirm PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set Parent PIN' }));
    fireEvent.change(screen.getByLabelText('Locked age'), { target: { value: '10-12' } });

    await waitFor(() =>
      expect((screen.getByLabelText('Scene') as HTMLInputElement).value).toBe(
        'Joyful treehouse afternoon',
      ),
    );
  });

  it('shows child-facing AI transparency and a parent privacy link', () => {
    render(<App />);

    expect(screen.getByText('Kidbot is an AI friend that helps you learn and play.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Read the Kidbot privacy policy' }).getAttribute('href')).toBe(
      '/privacy',
    );
  });

  it('loads and renders saved activity metadata for a parent', async () => {
    render(<App />);
    await unlockAndEnableHistory();
    callTool.mockResolvedValueOnce({
      structuredContent: {
        events: [
          {
            id: 'kb_event_1',
            timestamp: '2026-09-12T16:00:00.000Z',
            tool: 'science_sim',
            sessionId: 'kb_session_1',
            profileId: 'kb_profile_widget123',
            ageBand: '7-9',
            status: 'ok',
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'View saved activity' }));

    const history = await screen.findByRole('region', { name: 'Saved activity' });
    expect(within(history).getByText('Science Lab')).toBeTruthy();
    expect(within(history).getByText('Ages 7-9 · Completed')).toBeTruthy();
    expect(callTool).toHaveBeenLastCalledWith('parent_history_list', {
      limit: 25,
      parentAccessToken: 'kb_parent_widgettoken1234567890',
      profileId: 'kb_profile_widget123',
    });
  });

  it('shows an empty saved-activity state', async () => {
    render(<App />);
    await unlockAndEnableHistory();
    callTool.mockResolvedValueOnce({ structuredContent: { events: [] } });

    fireEvent.click(screen.getByRole('button', { name: 'View saved activity' }));

    expect(await screen.findByText('No saved activity yet.')).toBeTruthy();
  });

  it('announces saved-activity loading and a recoverable request error', async () => {
    render(<App />);
    await unlockAndEnableHistory();
    let rejectHistory: ((reason?: unknown) => void) | undefined;
    callTool.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectHistory = reject;
        }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'View saved activity' }));

    expect(
      screen
        .getAllByRole('status')
        .some((status) => status.textContent?.includes('Loading saved activity')),
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Loading saved activity…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    rejectHistory?.(new Error('offline'));
    expect(
      await screen.findByText('Saved activity could not be loaded. Please try again.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View saved activity' })).toBeTruthy();
  });

  it('ignores a saved-activity success that resolves after history is purged', async () => {
    render(<App />);
    await unlockAndEnableHistory();
    let resolveHistory: ((value: unknown) => void) | undefined;
    callTool.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'View saved activity' }));
    callTool.mockResolvedValueOnce({
      structuredContent: {
        ageBand: '7-9',
        historyEnabled: false,
        profileId: 'kb_profile_widget123',
      },
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /save activity history/i }));
    await screen.findByText('Saved history was purged.');
    await act(async () => {
      resolveHistory?.({
        structuredContent: {
          events: [
            {
              ageBand: '7-9',
              id: 'kb_event_stale',
              profileId: 'kb_profile_widget123',
              sessionId: 'kb_session_stale',
              status: 'ok',
              timestamp: '2026-09-12T16:00:00.000Z',
              tool: 'science_sim',
            },
          ],
        },
      });
    });

    expect(screen.queryByRole('region', { name: 'Saved activity' })).toBeNull();
    expect(screen.getByText('History: Local only')).toBeTruthy();
  });

  it('ignores a saved-activity error that rejects after history is purged', async () => {
    render(<App />);
    await unlockAndEnableHistory();
    let rejectHistory: ((reason?: unknown) => void) | undefined;
    callTool.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectHistory = reject;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'View saved activity' }));
    callTool.mockResolvedValueOnce({
      structuredContent: {
        ageBand: '7-9',
        historyEnabled: false,
        profileId: 'kb_profile_widget123',
      },
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /save activity history/i }));
    await screen.findByText('Saved history was purged.');
    await act(async () => {
      rejectHistory?.(new Error('late offline failure'));
    });

    expect(screen.queryByText('Saved activity could not be loaded. Please try again.')).toBeNull();
    expect(screen.getByText('History: Local only')).toBeTruthy();
  });

  it('prevents a saved-activity read from starting while history purge is pending', async () => {
    render(<App />);
    await unlockAndEnableHistory();
    let resolvePurge: ((value: unknown) => void) | undefined;
    callTool.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePurge = resolve;
        }),
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /save activity history/i }));
    await screen.findByText('Purging saved history…');
    const viewHistory = screen.getByRole('button', { name: 'View saved activity' });

    expect((viewHistory as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(viewHistory);
    expect(callTool).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvePurge?.({
        structuredContent: {
          ageBand: '7-9',
          historyEnabled: false,
          profileId: 'kb_profile_widget123',
        },
      });
    });

    expect(await screen.findByText('Saved history was purged.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Saved activity' })).toBeNull();
    expect(screen.getByText('History: Local only')).toBeTruthy();
  });

  it('clears an expired parent credential when history access is invalid', async () => {
    render(<App />);
    await unlockAndEnableHistory();
    callTool.mockResolvedValueOnce({
      isError: true,
      structuredContent: { error: true, code: 'invalid_parent_access' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'View saved activity' }));

    expect(await screen.findByText('Saved profile access expired. Enable history again to continue.')).toBeTruthy();
    expect(screen.getByText('Profile: local-default')).toBeTruthy();
    expect(screen.getByText('History: Local only')).toBeTruthy();

    callTool.mockResolvedValueOnce({
      structuredContent: {
        ageBand: '7-9',
        historyEnabled: true,
        profileId: 'kb_profile_recreated456',
      },
      _meta: { parentAccessToken: 'kb_parent_recreatedtoken1234567890' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /save activity history/i }));

    await screen.findByText('History is enabled.');
    expect(
      screen.queryByText('Saved profile access expired. Enable history again to continue.'),
    ).toBeNull();
  });

  it('requires confirmation before deleting a parent profile', async () => {
    render(<App />);
    await unlockAndEnableHistory();
    fireEvent.click(screen.getByRole('button', { name: 'Delete parent profile' }));

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Delete this parent profile and all saved activity?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel deletion' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm delete parent profile' })).toBeTruthy();
  });
});
