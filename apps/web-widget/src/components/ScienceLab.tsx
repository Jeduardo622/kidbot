import { useState } from 'react';
import { LiveRegion } from './LiveRegion.js';
import { buildAnnouncementState } from '../utils/announcementState.js';
import {
  degradedMessage,
  errorMessage,
  unavailableMessageFromError,
} from '../utils/degradation.js';
import { defaultSessionContext, type SessionContext } from '../utils/sessionContext.js';
import { readStructuredContent, type ToolResultRecord } from '../utils/toolResult.js';

interface ScienceResponse extends ToolResultRecord {
  blocked: boolean;
  degraded?: boolean;
  message?: string;
  title?: string;
  objective?: string;
  materials?: string[];
  steps?: string[];
  prediction?: { question: string; choices: string[]; answerIndex: number };
  explanation?: string;
  supervision?: string;
}

const topics = ['Buoyancy', 'Magnetism', 'Rainbows', 'Plant Growth'];

interface ScienceLabProps {
  sessionContext?: SessionContext;
}

export const ScienceLab = ({ sessionContext = defaultSessionContext }: ScienceLabProps) => {
  const [topic, setTopic] = useState('Buoyancy');
  const [plan, setPlan] = useState<ScienceResponse | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [unavailable, setUnavailable] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<number | undefined>();
  const [showExplanation, setShowExplanation] = useState(false);
  const announcement = buildAnnouncementState({
    loading,
    loadingMessage: 'Kidbot is preparing your science experiment.',
    errorMessage: error,
    urgentMessage: unavailable,
    readyMessage: plan && !plan.blocked ? `${plan.title ?? 'Experiment'} ready.` : '',
  });

  const fetchPlan = async () => {
    setLoading(true);
    setError(undefined);
    setUnavailable(undefined);
    setPlan(undefined);
    setShowExplanation(false);
    setSelectedChoice(undefined);
    try {
      const result = readStructuredContent<ScienceResponse>(await window.openai?.callTool?.('science_sim', {
        ...sessionContext,
        topic,
      }));
      const unavailableMessage = degradedMessage(result);
      if (unavailableMessage) {
        setUnavailable(unavailableMessage);
      } else if (result.blocked) {
        setPlan(undefined);
        setError(result.message ?? 'Kidbot paused this experiment.');
      } else {
        setPlan(result);
      }
    } catch (err) {
      setPlan(undefined);
      const unavailableMessage = unavailableMessageFromError(err);
      if (unavailableMessage) {
        setUnavailable(unavailableMessage);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel science-lab" aria-busy={loading}>
      <h2>Science Lab</h2>
      <LiveRegion message={announcement.message} isAlert={announcement.isAlert} />
      <div className="control-row">
        <label htmlFor="topic">Topic</label>
        <select id="topic" value={topic} onChange={(event) => setTopic(event.target.value)}>
          {topics.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <span className="locked-age">Age: {sessionContext.ageBand}</span>
        <button type="button" onClick={fetchPlan} disabled={loading}>
          {loading ? 'Mixing...' : 'Generate Experiment'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {unavailable && <p className="degraded">{unavailable}</p>}
      {plan && !plan.blocked && (
        <article className="experiment-card">
          <h3>{plan.title}</h3>
          <p className="objective">Objective: {plan.objective}</p>
          {plan.materials && (
            <div>
              <h4>Materials</h4>
              <ul>
                {plan.materials.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {plan.steps && (
            <div>
              <h4>Steps</h4>
              <ol>
                {plan.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          )}
          {plan.prediction && (
            <div className="prediction">
              <h4>Prediction</h4>
              <p>{plan.prediction.question}</p>
              <div className="choices">
                {plan.prediction.choices.map((choice, index) => (
                  <button
                    key={choice}
                    type="button"
                    className={selectedChoice === index ? 'selected' : ''}
                    onClick={() => setSelectedChoice(index)}
                  >
                    {choice}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setShowExplanation(true)}>
                Reveal Explanation
              </button>
              {showExplanation && plan.explanation && (
                <p className="explanation">
                  {plan.explanation}{' '}
                  {selectedChoice === plan.prediction.answerIndex
                    ? '✅ Great prediction!'
                    : "Let's explore why!"}
                </p>
              )}
            </div>
          )}
          {plan.supervision && <p className="supervision">Supervision: {plan.supervision}</p>}
        </article>
      )}
    </section>
  );
};
