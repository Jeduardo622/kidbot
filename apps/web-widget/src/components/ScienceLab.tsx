import { useEffect, useState } from 'react';

type AgeBand = '4-6' | '7-9' | '10-12';

interface ScienceResponse {
  blocked: boolean;
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

export const ScienceLab = () => {
  const [topic, setTopic] = useState('Buoyancy');
  const [ageBand, setAgeBand] = useState<AgeBand>('7-9');
  const [plan, setPlan] = useState<ScienceResponse | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<number | undefined>();
  const [showExplanation, setShowExplanation] = useState(false);

  useEffect(() => {
    window.openai?.setWidgetState?.({ tab: 'science', topic, ageBand });
  }, [topic, ageBand]);

  const fetchPlan = async () => {
    setLoading(true);
    setError(undefined);
    setShowExplanation(false);
    setSelectedChoice(undefined);
    try {
      const result = (await window.openai?.callTool?.('science_sim', { topic, ageBand })) as ScienceResponse | undefined;
      if (!result) {
        throw new Error('Widget bridge unavailable.');
      }
      if (result.blocked) {
        setPlan(undefined);
        setError(result.message ?? 'KidBot paused this experiment.');
      } else {
        setPlan(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel science-lab">
      <h2>Science Lab</h2>
      <div className="control-row">
        <label htmlFor="topic">Topic</label>
        <select id="topic" value={topic} onChange={(event) => setTopic(event.target.value)}>
          {topics.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <label htmlFor="science-age">Age</label>
        <select id="science-age" value={ageBand} onChange={(event) => setAgeBand(event.target.value as AgeBand)}>
          <option value="4-6">Ages 4-6</option>
          <option value="7-9">Ages 7-9</option>
          <option value="10-12">Ages 10-12</option>
        </select>
        <button type="button" onClick={fetchPlan} disabled={loading}>
          {loading ? 'Mixing...' : 'Generate Experiment'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
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
                  {plan.explanation} {selectedChoice === plan.prediction.answerIndex ? '✅ Great prediction!' : 'Let\'s explore why!'}
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
