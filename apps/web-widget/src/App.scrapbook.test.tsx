import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './main.js';

const hostResult = (structuredContent: Record<string, unknown>) => ({ structuredContent });

describe('App scrapbook', () => {
  const callTool = vi.fn();

  beforeEach(() => {
    callTool.mockReset();
    (window as { openai?: unknown }).openai = {
      callTool,
      setWidgetState: vi.fn(),
      requestDisplayMode: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as { openai?: unknown }).openai;
  });

  it('keeps a saved story in My Creations across tab switches and can remove it', async () => {
    callTool.mockResolvedValueOnce(
      hostResult({
        blocked: false,
        theme: 'A brave turtle shares snacks',
        panels: [
          { title: 'Quiet Cave', caption: 'Dara peeks out.', imagePrompt: 'cave', imageUrl: null },
        ],
      }),
    );
    render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: 'Comics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));
    await screen.findByText('Dara peeks out.');
    fireEvent.click(screen.getByRole('button', { name: 'Save to My Creations' }));

    const creationsTab = screen.getByRole('tab', { name: /^My Creations/ });
    expect(within(creationsTab).getByLabelText('1 saved')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Voice' }));
    fireEvent.click(creationsTab);
    const scrapbook = screen.getByRole('region', { name: 'My Creations' });
    expect(within(scrapbook).getByText('A brave turtle shares snacks')).toBeTruthy();
    expect(within(scrapbook).getByText('1 panel')).toBeTruthy();

    fireEvent.click(within(scrapbook).getByRole('button', { name: 'Read story' }));
    expect(within(scrapbook).getByText('Dara peeks out.')).toBeTruthy();

    fireEvent.click(within(scrapbook).getByRole('button', { name: 'Remove' }));
    expect(within(scrapbook).getByText(/Nothing saved yet/)).toBeTruthy();
  });
});
