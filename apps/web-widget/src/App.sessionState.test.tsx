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
    expect(document.activeElement).toBe(screen.getByLabelText('Parent PIN'));
  });

  it('announces PIN failures assertively and unlock success politely', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Create parent PIN'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set Parent PIN' }));
    expect(screen.getByRole('alert').textContent).toContain('Enter a 4-digit PIN.');

    fireEvent.change(screen.getByLabelText('Create parent PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set Parent PIN' }));
    expect((await parentControls().findByRole('status')).textContent).toContain(
      'Parent controls unlocked.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Lock Parent Controls' }));
    fireEvent.change(screen.getByLabelText('Parent PIN'), { target: { value: '9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Parent Controls' }));
    expect(screen.getByRole('alert').textContent).toContain('PIN did not match.');
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

  it('rejects a success-shaped isError create result without retaining credentials', async () => {
    callTool.mockResolvedValueOnce({
      isError: true,
      structuredContent: {
        ageBand: '7-9',
        historyEnabled: true,
        profileId: 'kb_profile_must_not_persist',
      },
      _meta: { parentAccessToken: 'kb_parent_must_not_persist1234567890' },
    });
    render(<App />);
    await setPin();

    fireEvent.click(screen.getByRole('checkbox', { name: /save activity history/i }));

    expect((await parentControls().findByRole('alert')).textContent).toContain(
      'History could not be enabled',
    );
    expect(screen.getByText('Profile: local-default')).toBeTruthy();
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

  it('re-enables history by updating the retained profile instead of creating another one', async () => {
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
    await screen.findByText('Saved history was purged.');

    callTool.mockResolvedValueOnce({
      structuredContent: {
        ageBand: '7-9',
        historyEnabled: true,
        profileId: 'kb_profile_widget123',
      },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /save activity history/i }));
    await screen.findByText('History is enabled.');

    expect(callTool.mock.calls.map(([name]) => name)).toEqual([
      'parent_profile_create',
      'parent_profile_update',
      'parent_profile_update',
    ]);
    expect(callTool).toHaveBeenLastCalledWith('parent_profile_update', {
      historyEnabled: true,
      parentAccessToken: 'kb_parent_widgettoken1234567890',
      profileId: 'kb_profile_widget123',
    });
    expect(screen.getByText('Profile: kb_profile_widget123')).toBeTruthy();
  });

  it('rejects a success-shaped isError re-enable result and keeps the retained credential', async () => {
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
    await screen.findByText('Saved history was purged.');

    callTool.mockResolvedValueOnce({
      isError: true,
      structuredContent: {
        ageBand: '7-9',
        historyEnabled: true,
        profileId: 'kb_profile_widget123',
      },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /save activity history/i }));

    expect((await parentControls().findByRole('alert')).textContent).toContain(
      'History could not be enabled',
    );
    expect(screen.getByText('Profile: kb_profile_widget123')).toBeTruthy();
    expect(screen.getByText('History: Local only')).toBeTruthy();
  });

  it('reports a rejected re-enable bridge promise without clearing the retained credential', async () => {
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
    await screen.findByText('Saved history was purged.');

    callTool.mockRejectedValueOnce(new Error('bridge unavailable'));
    fireEvent.click(screen.getByRole('checkbox', { name: /save activity history/i }));

    expect((await parentControls().findByRole('alert')).textContent).toContain(
      'History could not be enabled',
    );
    expect(screen.getByText('Profile: kb_profile_widget123')).toBeTruthy();
    expect(screen.getByText('History: Local only')).toBeTruthy();
  });

  it('clears only an expired retained credential after re-enable fails and creates on the next retry', async () => {
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
    await screen.findByText('Saved history was purged.');

    callTool.mockResolvedValueOnce({
      isError: true,
      structuredContent: { error: true, code: 'invalid_parent_access' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /save activity history/i }));

    expect((await parentControls().findByRole('alert')).textContent).toContain(
      'History could not be enabled',
    );
    expect(screen.getByText('Profile: local-default')).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: /save activity history/i }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(callTool.mock.calls.map(([name]) => name)).toEqual([
      'parent_profile_create',
      'parent_profile_update',
      'parent_profile_update',
    ]);

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

    expect(callTool).toHaveBeenLastCalledWith('parent_profile_create', {
      ageBand: '7-9',
      historyEnabled: true,
      sessionId: expect.stringMatching(/^kb_session_/),
    });
    expect(screen.getByText('Profile: kb_profile_recreated456')).toBeTruthy();
  });

  it('keeps the visible and persisted age unchanged when profile update fails', async () => {
    render(<App />);
    await setPin();
    await enableHistory();
    setWidgetState.mockClear();
    callTool.mockRejectedValueOnce(new Error('offline'));

    fireEvent.change(screen.getByLabelText('Locked age'), { target: { value: '10-12' } });

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Profile age could not be updated.',
    );
    expect((screen.getByLabelText('Locked age') as HTMLSelectElement).value).toBe('7-9');
    expect(screen.getAllByText('Age: 7-9')).toHaveLength(2);
    for (const [state] of setWidgetState.mock.calls) {
      expect((state as Record<string, unknown>).ageBand).toBe('7-9');
    }
  });

  it('rejects a success-shaped isError age update without changing local state', async () => {
    render(<App />);
    await setPin();
    await enableHistory();
    callTool.mockResolvedValueOnce({
      isError: true,
      structuredContent: {
        ageBand: '10-12',
        historyEnabled: true,
        profileId: 'kb_profile_widget123',
      },
    });

    fireEvent.change(screen.getByLabelText('Locked age'), { target: { value: '10-12' } });

    expect((await parentControls().findByRole('alert')).textContent).toContain(
      'Profile age could not be updated.',
    );
    expect((screen.getByLabelText('Locked age') as HTMLSelectElement).value).toBe('7-9');
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

  it('rejects a success-shaped isError disable result and keeps consent enabled', async () => {
    render(<App />);
    await setPin();
    await enableHistory();
    callTool.mockResolvedValueOnce({
      isError: true,
      structuredContent: {
        ageBand: '7-9',
        historyEnabled: false,
        profileId: 'kb_profile_widget123',
      },
    });

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

  it('rejects a success-shaped isError delete result and keeps the active profile', async () => {
    render(<App />);
    await setPin();
    await enableHistory();
    callTool.mockResolvedValueOnce({
      isError: true,
      structuredContent: { deleted: true, profileId: 'kb_profile_widget123' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete parent profile' }));

    expect((await parentControls().findByRole('alert')).textContent).toContain(
      'Profile could not be deleted',
    );
    expect(screen.getByText('Profile: kb_profile_widget123')).toBeTruthy();
    expect(screen.getByText('History: On')).toBeTruthy();
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

  it('marks the active navigation item for assistive technology', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Voice' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Comics' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Comics' }));
    expect(screen.getByRole('button', { name: 'Comics' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('applies border-box sizing and narrow viewport overflow containment', () => {
    expect(styleSource).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{\s*box-sizing:\s*border-box;/s);
    expect(styleSource).toMatch(/@media\s*\(max-width:\s*480px\)/);
    expect(styleSource).toMatch(/\.kidbot-app\s*\{[^}]*padding:\s*0\.75rem;/s);
    expect(styleSource).toMatch(/\.control-row\s*>\s*input,[^{]*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
  });
});
