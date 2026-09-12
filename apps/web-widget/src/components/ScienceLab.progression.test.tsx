import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScienceLab } from './ScienceLab.js';

describe('ScienceLab step progression', () => {
  const callTool = vi.fn();

  beforeEach(() => {
    callTool.mockReset();
    callTool.mockResolvedValue({
      structuredContent: {
        blocked: false,
        title: 'Float Lab',
        objective: 'Observe floating.',
        materials: ['Bowl', 'Orange'],
        steps: ['Fill the bowl.', 'Add the orange.'],
        topic: 'Buoyancy',
        prediction: {
          question: 'What happens?',
          choices: ['It floats', 'It sinks'],
          answerIndex: 0,
        },
        explanation: 'The peel holds air.',
        supervision: 'Ask an adult to help.',
      },
    });
    (window as { openai?: unknown }).openai = { callTool };
  });

  afterEach(() => {
    cleanup();
    delete (window as { openai?: unknown }).openai;
  });

  const renderPlan = async () => {
    render(<ScienceLab />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Experiment' }));
    await screen.findByRole('heading', { name: 'Float Lab' });
  };

  it('shows one experiment step at a time before prediction', async () => {
    await renderPlan();

    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    expect(screen.getByText('Fill the bowl.')).toBeTruthy();
    expect(screen.queryByText('Add the orange.')).toBeNull();
    expect(screen.queryByText('What happens?')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    expect(screen.getByText('Add the orange.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to prediction' }));
    expect(screen.getByText('What happens?')).toBeTruthy();
  });

  it('requires an accessible prediction selection before revealing the explanation', async () => {
    await renderPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to prediction' }));

    const reveal = screen.getByRole('button', { name: 'Reveal explanation' });
    const firstChoice = screen.getByRole('button', { name: 'It floats' });
    expect((reveal as HTMLButtonElement).disabled).toBe(true);
    expect(firstChoice.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(firstChoice);
    expect(firstChoice.getAttribute('aria-pressed')).toBe('true');
    expect((reveal as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(reveal);
    expect(screen.getByText(/The peel holds air/)).toBeTruthy();
  });

  it('returns from prediction to the final instruction step', async () => {
    await renderPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to prediction' }));

    fireEvent.click(screen.getByRole('button', { name: 'Back to steps' }));

    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    expect(screen.getByText('Add the orange.')).toBeTruthy();
    expect(screen.queryByText('What happens?')).toBeNull();
  });
});
