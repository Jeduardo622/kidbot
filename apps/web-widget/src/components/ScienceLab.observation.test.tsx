import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScienceLab } from './ScienceLab.js';

const hostResult = (structuredContent: Record<string, unknown>) => ({ structuredContent });

const experiment = {
  blocked: false,
  title: 'Float Lab',
  objective: 'See what floats.',
  materials: ['Bowl', 'Orange'],
  steps: ['Fill the bowl.', 'Add the orange.'],
  prediction: { question: 'What happens?', choices: ['It floats', 'It sinks'], answerIndex: 0 },
  explanation: 'The peel holds air.',
  supervision: 'Ask a grown-up to help with water.',
  topic: 'Buoyancy',
};

describe('ScienceLab free topics, supervision, and observations', () => {
  const callTool = vi.fn();

  beforeEach(() => {
    callTool.mockReset();
    (window as { openai?: unknown }).openai = { callTool, setWidgetState: vi.fn() };
  });

  afterEach(() => {
    cleanup();
    delete (window as { openai?: unknown }).openai;
  });

  it('accepts a typed topic and sends it trimmed', async () => {
    callTool.mockResolvedValueOnce(hostResult(experiment));
    render(<ScienceLab />);

    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: '  Why do boats float  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Experiment' }));
    await screen.findByText('Float Lab');

    expect(callTool).toHaveBeenCalledWith(
      'science_sim',
      expect.objectContaining({ topic: 'Why do boats float' }),
    );
  });

  it('refuses a topic that is too short', () => {
    render(<ScienceLab />);
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'ab' } });
    expect(
      (screen.getByRole('button', { name: 'Generate Experiment' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('Topics need at least 3 letters.')).toBeTruthy();
    expect(callTool).not.toHaveBeenCalled();
  });

  it('shows the grown-up check before the steps', async () => {
    callTool.mockResolvedValueOnce(hostResult(experiment));
    const { container } = render(<ScienceLab />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Experiment' }));
    await screen.findByText('Float Lab');

    const card = container.querySelector('.experiment-card');
    const supervision = card?.querySelector('.supervision');
    const step = card?.querySelector('.experiment-step');
    expect(supervision?.textContent).toContain('Ask a grown-up to help with water.');
    expect(supervision && step && supervision.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('captures what the child saw and saves the experiment to the scrapbook', async () => {
    const onSave = vi.fn();
    callTool.mockResolvedValueOnce(hostResult(experiment));
    render(<ScienceLab onSaveToScrapbook={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Experiment' }));
    await screen.findByText('Float Lab');

    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to prediction' }));
    expect(screen.getByText('Pick your guess first, then reveal what happens.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'It sinks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal explanation' }));

    fireEvent.change(screen.getByLabelText('What did you see when you tried it?'), {
      target: { value: 'It floated!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to My Creations' }));

    expect(onSave).toHaveBeenCalledWith({
      kind: 'experiment',
      title: 'Float Lab',
      prediction: 'It sinks',
      wasCorrect: false,
      explanation: 'The peel holds air.',
      observation: 'It floated!',
    });
  });
});
