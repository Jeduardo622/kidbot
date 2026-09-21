import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityErrorBoundary } from './ActivityErrorBoundary.js';

const Exploder = ({ explode }: { explode: boolean }) => {
  if (explode) throw new Error('boom');
  return <p>Activity content</p>;
};

describe('ActivityErrorBoundary', () => {
  afterEach(cleanup);

  it('replaces a crashed activity with a friendly recovery message and recovers on retry', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let explode = true;
    const { rerender } = render(
      <ActivityErrorBoundary activity="Coloring Corner">
        <Exploder explode={explode} />
      </ActivityErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Coloring Corner hit a snag');
    expect(alert.textContent).not.toContain('boom');

    explode = false;
    rerender(
      <ActivityErrorBoundary activity="Coloring Corner">
        <Exploder explode={explode} />
      </ActivityErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try Coloring Corner again' }));
    expect(screen.getByText('Activity content')).toBeTruthy();
    consoleError.mockRestore();
  });
});
