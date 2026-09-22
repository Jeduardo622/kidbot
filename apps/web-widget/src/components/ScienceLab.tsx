import { useState } from 'react';
import { EmptyState } from './EmptyState.js';
import { LiveRegion } from './LiveRegion.js';
import { ageBandPresentation } from '../utils/ageBand.js';
import { buildAnnouncementState } from '../utils/announcementState.js';
import type { ScrapbookDraft } from '../utils/scrapbook.js';
import { defaultSessionContext, type SessionContext } from '../utils/sessionContext.js';
import { isScienceResult, type ScienceResult } from '../utils/toolResult.js';
import { useToolCall } from '../utils/useToolCall.js';

const TOPIC_MIN = 3;
const TOPIC_MAX = 120;

interface ScienceLabProps {
  sessionContext?: SessionContext;
  onSaveToScrapbook?: (draft: ScrapbookDraft) => void;
}

export const ScienceLab = ({
  sessionContext = defaultSessionContext,
  onSaveToScrapbook,
}: ScienceLabProps) => {
  const presentation = ageBandPresentation(sessionContext.ageBand);
  const topics = presentation.scienceTopics;
  const [topic, setTopic] = useState(topics[0] ?? 'Buoyancy');
  const [plan, setPlan] = useState<ScienceResult | undefined>();
  const [blocked, setBlocked] = useState<string | undefined>();
  const [selectedChoice, setSelectedChoice] = useState<number | undefined>();
  const [showExplanation, setShowExplanation] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [predictionReady, setPredictionReady] = useState(false);
  const [observation, setObservation] = useState('');
  const [saved, setSaved] = useState(false);
  const tool = useToolCall<ScienceResult>('science_sim', isScienceResult, {
    blockedFallback: 'Kidbot paused this experiment.',
  });
  const trimmedTopic = topic.trim();
  const topicValid = trimmedTopic.length >= TOPIC_MIN && trimmedTopic.length <= TOPIC_MAX;
  const announcement = buildAnnouncementState({
    loading: tool.loading,
    loadingMessage: 'Kidbot is preparing your science experiment.',
    errorMessage: tool.error,
    urgentMessage: tool.unavailable ?? blocked,
    readyMessage: plan ? `${plan.title ?? 'Experiment'} ready.` : '',
  });

  const resetProgress = () => {
    setShowExplanation(false);
    setSelectedChoice(undefined);
    setCurrentStep(0);
    setPredictionReady(false);
    setObservation('');
    setSaved(false);
  };

  const fetchPlan = async () => {
    if (!topicValid) return;
    setPlan(undefined);
    setBlocked(undefined);
    resetProgress();
    const outcome = await tool.run({ ...sessionContext, topic: trimmedTopic });
    if (outcome.kind === 'ok') {
      setPlan(outcome.result);
      setPredictionReady((outcome.result.steps?.length ?? 0) === 0);
    } else if (outcome.kind === 'blocked') {
      setBlocked(outcome.message);
    }
  };

  const wasCorrect =
    plan?.prediction !== undefined && selectedChoice === plan.prediction.answerIndex;

  const saveExperiment = () => {
    if (!plan?.prediction || selectedChoice === undefined || !onSaveToScrapbook) return;
    onSaveToScrapbook({
      kind: 'experiment',
      title: plan.title ?? trimmedTopic,
      prediction: plan.prediction.choices[selectedChoice] ?? '',
      wasCorrect,
      explanation: plan.explanation ?? '',
      ...(observation.trim() ? { observation: observation.trim() } : {}),
    });
    setSaved(true);
  };

  const steps = plan?.steps ?? [];

  return (
    <section className="panel science-lab" aria-busy={tool.loading}>
      <h2>Science Lab</h2>
      <LiveRegion message={announcement.message} isAlert={announcement.isAlert} />
      <div className="control-row">
        <label htmlFor="topic" className={presentation.simplified ? 'sr-only' : ''}>Topic</label>
        <input
          id="topic"
          className={presentation.simplified ? 'sr-only' : ''}
          list="topic-ideas"
          maxLength={TOPIC_MAX}
          placeholder="What do you want to explore?"
          readOnly={presentation.simplified}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
        />
        <datalist id="topic-ideas">
          {topics.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        <span className="locked-age">Age: {sessionContext.ageBand}</span>
        <button type="button" onClick={() => void fetchPlan()} disabled={tool.loading || !topicValid}>
          {tool.loading ? 'Mixing...' : 'Generate Experiment'}
        </button>
      </div>
      <div className="topic-chips" aria-label="Topic ideas">
        {topics.slice(0, presentation.simplified ? 4 : 6).map((item) => (
          <button
            key={item}
            type="button"
            className="chip"
            aria-pressed={trimmedTopic.toLowerCase() === item.toLowerCase()}
            onClick={() => setTopic(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {!topicValid && trimmedTopic.length > 0 && (
        <p className="hint">Topics need at least {TOPIC_MIN} letters.</p>
      )}
      {tool.error && <p className="error">{tool.error}</p>}
      {tool.unavailable && <p className="degraded">{tool.unavailable}</p>}
      {blocked && <p className="blocked">{blocked}</p>}
      {!plan && !tool.loading && !blocked && !tool.error && !tool.unavailable && (
        <EmptyState
          icon="🧪"
          title="Try an experiment!"
          hint={presentation.greeting}
          actionLabel={`Explore ${trimmedTopic || topics[0] || 'science'}`}
          onAction={() => void fetchPlan()}
          disabled={!topicValid}
        />
      )}
      {plan && (
        <article className="experiment-card">
          <h3>{plan.title}</h3>
          {plan.supervision && (
            <p className="supervision" role="note">
              <strong>Grown-up check:</strong> {plan.supervision}
            </p>
          )}
          <p className="objective">Objective: {plan.objective}</p>
          {plan.materials && (
            <div>
              <h4>Materials</h4>
              <ul>
                {plan.materials.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {steps.length > 0 && (
            <ol className="step-track" aria-label="Experiment progress">
              {steps.map((_, index) => {
                const done = predictionReady || index < currentStep;
                const current = !predictionReady && index === currentStep;
                return (
                  <li
                    key={index}
                    className={done ? 'done' : current ? 'current' : ''}
                    aria-current={current ? 'step' : undefined}
                    aria-label={`Step ${index + 1}${done ? ', done' : current ? ', in progress' : ''}`}
                  >
                    {done ? '✓' : index + 1}
                  </li>
                );
              })}
            </ol>
          )}
          {steps.length > 0 && !predictionReady && (
            <div className="experiment-step">
              <h4>Steps</h4>
              <p className="step-progress">Step {currentStep + 1} of {steps.length}</p>
              <p>{steps[currentStep]}</p>
              <div className="step-actions">
                <button
                  type="button"
                  disabled={currentStep === 0}
                  onClick={() => setCurrentStep((step) => Math.max(0, step - 1))}
                >
                  Previous step
                </button>
                {currentStep < steps.length - 1 ? (
                  <button type="button" onClick={() => setCurrentStep((step) => step + 1)}>
                    Next step
                  </button>
                ) : (
                  <button type="button" onClick={() => setPredictionReady(true)}>
                    Continue to prediction
                  </button>
                )}
              </div>
            </div>
          )}
          {plan.prediction && predictionReady && (
            <div className="prediction">
              <h4>Prediction</h4>
              <p>{plan.prediction.question}</p>
              {steps.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setPredictionReady(false);
                    setShowExplanation(false);
                  }}
                >
                  Back to steps
                </button>
              )}
              <div className="choices" role="group" aria-label="Prediction choices">
                {plan.prediction.choices.map((choice, index) => (
                  <button
                    aria-pressed={selectedChoice === index}
                    key={`${index}-${choice}`}
                    type="button"
                    className={selectedChoice === index ? 'selected' : ''}
                    onClick={() => {
                      setSelectedChoice(index);
                      setShowExplanation(false);
                    }}
                  >
                    {choice}
                  </button>
                ))}
              </div>
              {selectedChoice === undefined && (
                <p className="hint">Pick your guess first, then reveal what happens.</p>
              )}
              <button
                type="button"
                disabled={selectedChoice === undefined}
                onClick={() => setShowExplanation(true)}
              >
                Reveal explanation
              </button>
              {showExplanation && plan.explanation && (
                <>
                  <p className="explanation">
                    {plan.explanation}{' '}
                    {wasCorrect ? '✅ Great prediction!' : "Let's explore why!"}
                  </p>
                  <div className="observation">
                    <label htmlFor="observation">What did you see when you tried it?</label>
                    <textarea
                      id="observation"
                      rows={2}
                      maxLength={280}
                      placeholder="The orange floated!"
                      value={observation}
                      onChange={(event) => setObservation(event.target.value)}
                    />
                  </div>
                  {onSaveToScrapbook && (
                    <button type="button" disabled={saved} onClick={saveExperiment}>
                      {saved ? 'Saved to My Creations' : 'Save to My Creations'}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </article>
      )}
    </section>
  );
};
