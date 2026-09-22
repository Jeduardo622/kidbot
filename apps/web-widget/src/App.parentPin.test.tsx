import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './main.js';

describe('App parent PIN hardening', () => {
  beforeEach(() => {
    (window as { openai?: unknown }).openai = {
      callTool: vi.fn(),
      setWidgetState: vi.fn(),
      requestDisplayMode: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete (window as { openai?: unknown }).openai;
  });

  const parentControls = () => within(screen.getByRole('region', { name: 'Parent controls' }));

  const createPin = (pin: string, confirm = pin) => {
    fireEvent.change(screen.getByLabelText('Create parent PIN'), { target: { value: pin } });
    fireEvent.change(screen.getByLabelText('Confirm PIN'), { target: { value: confirm } });
    fireEvent.click(screen.getByRole('button', { name: 'Set Parent PIN' }));
  };

  it('requires the PIN to be typed twice before it is set', () => {
    render(<App />);
    createPin('1234', '1243');
    expect(screen.getByRole('alert').textContent).toContain('did not match');
    expect(screen.queryByRole('button', { name: 'Lock Parent Controls' })).toBeNull();

    createPin('1234');
    expect(parentControls().getByRole('status').textContent).toContain('Parent controls unlocked.');
  });

  it('explains that the PIN is session-only', () => {
    render(<App />);
    expect(screen.getByText(/only lasts for this play session/)).toBeTruthy();
  });

  it('locks parent controls for a minute after five wrong PINs', () => {
    vi.useFakeTimers();
    render(<App />);
    createPin('1234');
    fireEvent.click(screen.getByRole('button', { name: 'Lock Parent Controls' }));

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      fireEvent.change(screen.getByLabelText('Parent PIN'), { target: { value: '0000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Unlock Parent Controls' }));
      expect(screen.getByRole('alert').textContent).toContain(`${5 - attempt} tries left`);
    }
    fireEvent.change(screen.getByLabelText('Parent PIN'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Parent Controls' }));
    expect(screen.getByRole('alert').textContent).toContain('locked for 60 seconds');
    expect((screen.getByRole('button', { name: 'Unlock Parent Controls' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Parent PIN') as HTMLInputElement).disabled).toBe(true);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect((screen.getByRole('button', { name: 'Unlock Parent Controls' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('Parent PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Parent Controls' }));
    expect(screen.getByRole('button', { name: 'Lock Parent Controls' })).toBeTruthy();
  });
});
