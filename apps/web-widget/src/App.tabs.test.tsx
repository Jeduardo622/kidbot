import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './main.js';

describe('App activity tabs and age presentation', () => {
  beforeEach(() => {
    (window as { openai?: unknown }).openai = {
      callTool: vi.fn(),
      setWidgetState: vi.fn(),
      requestDisplayMode: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as { openai?: unknown }).openai;
  });

  it('exposes a real tablist with labelled panels', () => {
    render(<App />);
    const tablist = screen.getByRole('tablist', { name: 'Play studio activities' });
    const tabs = screen.getAllByRole('tab');
    expect(tablist).toBeTruthy();
    expect(tabs).toHaveLength(5);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]?.getAttribute('tabindex')).toBe('0');
    expect(tabs[1]?.getAttribute('tabindex')).toBe('-1');
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe('tab-voice');
  });

  it('moves between tabs with the arrow keys', () => {
    render(<App />);
    const voice = screen.getByRole('tab', { name: 'Voice' });
    voice.focus();
    fireEvent.keyDown(voice, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Comics' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Comics' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Comics' }), { key: 'ArrowLeft' });
    expect(voice.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(voice, { key: 'End' });
    expect(screen.getByRole('tab', { name: /^My Creations/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('scales the widget for the locked age band', () => {
    const { container } = render(<App />);
    const root = container.querySelector('.kidbot-app');
    expect(root?.getAttribute('data-age-band')).toBe('7-9');
    expect(root?.getAttribute('data-age-scale')).toBe('medium');

    fireEvent.change(screen.getByLabelText('Create parent PIN'), { target: { value: '1234' } });
    fireEvent.change(screen.getByLabelText('Confirm PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set Parent PIN' }));
    fireEvent.change(screen.getByLabelText('Locked age'), { target: { value: '4-6' } });
    expect(root?.getAttribute('data-age-scale')).toBe('large');

    fireEvent.click(screen.getByRole('tab', { name: 'Comics' }));
    expect(screen.queryByLabelText('Panels')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Coloring' }));
    expect(screen.queryByLabelText('Brush size')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Science Lab' }));
    expect(screen.getByRole('button', { name: 'Float or sink' })).toBeTruthy();
  });
});
