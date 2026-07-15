import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './main.js';

const persistedKeys = ['ageBand', 'sessionId', 'tab'];
const styleSource = readFileSync('src/styles.css', 'utf8');

describe('App parent/session safety controls', () => {
  const callTool = vi.fn();
  const setWidgetState = vi.fn();
  const requestDisplayMode = vi.fn();
  let hostState: Record<string, unknown> | undefined;

  beforeEach(() => {
    callTool.mockReset();
    setWidgetState.mockReset();
    requestDisplayMode.mockReset();
    hostState = undefined;
    (window as { openai?: unknown }).openai = {
      callTool,
      get widgetState() {
        return hostState;
      },
      requestDisplayMode,
      setWidgetState,
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as { openai?: unknown }).openai;
  });

  const expectSecretFreeWidgetState = () => {
    expect(setWidgetState).toHaveBeenCalled();
    for (const [state] of setWidgetState.mock.calls) {
      expect(Object.keys(state as Record<string, unknown>).sort()).toEqual(persistedKeys);
    }
  };

  const parentControls = () => within(screen.getByRole('region', { name: 'Parent controls' }));

  const setPin = async () => {
    fireEvent.change(screen.getByLabelText('Create parent PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set Parent PIN' }));
    await screen.findByText('Parent controls unlocked.');
  };

  const enableHistory = async () => {
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

  it('ignores private host state and persists only the public session fields', async () => {
    hostState = {
      ageBand: '10-12',
      historyEnabled: true,
      parentAccessToken: 'kb_parent_existingtoken1234567890',
      parentModeUnlocked: true,
      parentPin: '1234',
      parentPinSet: true,
      profileId: 'kb_profile_existing123',
      sessionId: 'kb_session_existing456',
      tab: 'science',
    };

    render(<App />);

    await waitFor(expectSecretFreeWidgetState);
    expect(screen.getByLabelText('Create parent PIN')).toBeTruthy();
    expect(screen.getByText('Profile: local-default')).toBeTruthy();
    expect(screen.getByText('History: Local only')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Science Lab' })).toBeTruthy();
  });

  it('keeps PIN setup and unchecked history entirely local', async () => {
    render(<App />);

    await setPin();

    expect(callTool).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('checkbox', { name: /save activity history/i }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(screen.getByText(/history is stored for up to 30 days/i)).toBeTruthy();
    expect(screen.getByText('History: Local only')).toBeTruthy();
    expectSecretFreeWidgetState();
  });

  it('moves keyboard focus into parent settings after unlock', async () => {
    render(<App />);
    await setPin();

    expect(document.activeElement).toBe(
      screen.getByRole('checkbox', { name: /save activity history/i }),
    );
  });

  it('requires explicit consent and exposes pending state while enabling history', async () => {
    let resolveCreate: ((value: unknown) => void) | undefined;
    callTool.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    render(<App />);
    await setPin();

    const checkbox = screen.getByRole('checkbox', { name: /save activity history/i });
    fireEvent.click(checkbox);

    expect(callTool).toHaveBeenCalledWith('parent_profile_create', {
      ageBand: '7-9',
      historyEnabled: true,
      sessionId: expect.stringMatching(/^kb_session_/),
    });
    expect((await parentControls().findByRole('status')).textContent).toContain('Enabling history…');
    expect((checkbox as HTMLInputElement).disabled).toBe(true);

    resolveCreate?.({
      structuredContent: {
        ageBand: '7-9',
        historyEnabled: true,
        profileId: 'kb_profile_widget123',
      },
      _meta: { parentAccessToken: 'kb_parent_widgettoken1234567890' },
    });

    await screen.findByText('History is enabled.');
    expect(screen.getByText('Profile: kb_profile_widget123')).toBeTruthy();
    expectSecretFreeWidgetState();
  });

  it('allows parent controls to lock while a persistence request is pending', async () => {
    callTool.mockImplementationOnce(() => new Promise(() => undefined));
    render(<App />);
    await setPin();

    fireEvent.click(screen.getByRole('checkbox', { name: /save activity history/i }));
    await parentControls().findByText('Enabling history…');

    const lockButton = screen.getByRole('button', { name: 'Lock Parent Controls' });
    expect((lockButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(lockButton);
    expect(screen.getByLabelText('Parent PIN')).toBeTruthy();
  });

  it('associates consent and destructive controls with their explanatory copy', async () => {
    render(<App />);
    await setPin();

    const consent = screen.getByRole('checkbox', { name: /save activity history/i });
    expect(consent.getAttribute('aria-describedby')).toBe('history-consent-description');
    expect(document.getElementById('history-consent-description')?.textContent).toContain('30 days');

    await enableHistory();
    const deleteButton = screen.getByRole('button', { name: 'Delete parent profile' });
    expect(deleteButton.getAttribute('aria-describedby')).toBe('delete-profile-description');
    expect(document.getElementById('delete-profile-description')?.textContent).toContain(
      'Permanently deletes',
    );
  });

  it('reports enable failures and leaves history off', async () => {
    callTool.mockRejectedValueOnce(new Error('offline'));
    render(<App />);
    await setPin();

    fireEvent.click(screen.getByRole('checkbox', { name: /save activity history/i }));

    expect((await parentControls().findByRole('alert')).textContent).toContain(
      'History could not be enabled',
    );
    expect(
      (screen.getByRole('checkbox', { name: /save activity history/i }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(screen.getByText('History: Local only')).toBeTruthy();
  });

  it('purges saved history when consent is disabled', async () => {
    render(<App />);
    await setPin();
    await enableHistory();
    callTool.mockResolvedValueOnce({
      structuredContent: {
        ageBand: '7-9',
        historyEnabled: false,
        profileId: 'kb_profile_widget123',
      },
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /save activity history/i }));

    await waitFor(() => {
      expect(callTool).toHaveBeenCalledWith('parent_profile_update', {
        historyEnabled: false,
        parentAccessToken: 'kb_parent_widgettoken1234567890',
        profileId: 'kb_profile_widget123',
      });
    });
    expect(await screen.findByText('Saved history was purged.')).toBeTruthy();
    expect(screen.getByText('History: Local only')).toBeTruthy();
  });

  it('keeps consent enabled and announces an error when history purge fails', async () => {
    render(<App />);
    await setPin();
    await enableHistory();
    callTool.mockRejectedValueOnce(new Error('offline'));

    fireEvent.click(screen.getByRole('checkbox', { name: /save activity history/i }));

    expect((await parentControls().findByRole('alert')).textContent).toContain(
      'History could not be disabled',
    );
    expect(
      (screen.getByRole('checkbox', { name: /save activity history/i }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('keeps the active profile when destructive deletion fails', async () => {
    render(<App />);
    await setPin();
    await enableHistory();
    callTool.mockRejectedValueOnce(new Error('offline'));

    expect(screen.getByText(/permanently deletes the parent profile and saved history/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete parent profile' }));

    expect((await parentControls().findByRole('alert')).textContent).toContain(
      'Profile could not be deleted',
    );
    expect(screen.getByText('Profile: kb_profile_widget123')).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: /save activity history/i }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it('keeps the active profile when deletion confirms a different profile id', async () => {
    render(<App />);
    await setPin();
    await enableHistory();
    callTool.mockResolvedValueOnce({
      structuredContent: { deleted: true, profileId: 'kb_profile_other123' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete parent profile' }));

    expect((await parentControls().findByRole('alert')).textContent).toContain(
      'Profile could not be deleted',
    );
    expect(screen.getByText('Profile: kb_profile_widget123')).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: /save activity history/i }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it('clears the active profile only after confirmed destructive deletion', async () => {
    let resolveDelete: ((value: unknown) => void) | undefined;
    render(<App />);
    await setPin();
    await enableHistory();
    callTool.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete parent profile' }));

    expect(callTool).toHaveBeenCalledWith('parent_profile_delete', {
      parentAccessToken: 'kb_parent_widgettoken1234567890',
      profileId: 'kb_profile_widget123',
    });
    expect(screen.getByText('Profile: kb_profile_widget123')).toBeTruthy();
    expect((await parentControls().findByRole('status')).textContent).toContain(
      'Deleting parent profile…',
    );
    expect(
      (screen.getByRole('button', { name: 'Delete parent profile' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    resolveDelete?.({ structuredContent: { deleted: true, profileId: 'kb_profile_widget123' } });

    expect(await screen.findByText('Parent profile deleted.')).toBeTruthy();
    expect(screen.getByText('Profile: local-default')).toBeTruthy();
    expect(screen.getByText('History: Local only')).toBeTruthy();
    expectSecretFreeWidgetState();
  });

  it('keeps destructive hover and disabled colors isolated from generic button styles', () => {
    const genericHoverIndex = styleSource.indexOf('.kidbot-header button:hover');
    const dangerHoverIndex = styleSource.indexOf('.kidbot-header button.danger-button:hover');

    expect(dangerHoverIndex).toBeGreaterThan(genericHoverIndex);
    expect(styleSource).toMatch(
      /\.kidbot-header button\.danger-button:hover\s*\{[^}]*background:\s*#991b1b;[^}]*color:\s*#fff;[^}]*transform:\s*none;/s,
    );
    expect(styleSource).toMatch(
      /\.kidbot-header button\.danger-button:disabled[^\{]*\{[^}]*background:\s*#7f1d1d;[^}]*color:\s*#fff;[^}]*opacity:\s*1;[^}]*transform:\s*none;/s,
    );
  });
});
