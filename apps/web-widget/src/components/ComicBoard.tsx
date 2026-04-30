import { useState } from 'react';
import { LiveRegion } from './LiveRegion.js';
import { buildAnnouncementState } from '../utils/announcementState.js';
import {
  degradedMessage,
  errorMessage,
  unavailableMessageFromError,
} from '../utils/degradation.js';
import { defaultSessionContext, type SessionContext } from '../utils/sessionContext.js';

interface StoryPanel {
  title: string;
  caption: string;
  imagePrompt: string;
  imageUrl: string | null;
}

interface StoryResponse {
  blocked: boolean;
  degraded?: boolean;
  message?: string;
  theme?: string;
  panels?: StoryPanel[];
}

interface ComicBoardProps {
  sessionContext?: SessionContext;
}

export const ComicBoard = ({ sessionContext = defaultSessionContext }: ComicBoardProps) => {
  const [theme, setTheme] = useState('A brave turtle shares snacks');
  const [panelCount, setPanelCount] = useState(4);
  const [panels, setPanels] = useState<StoryPanel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [unavailable, setUnavailable] = useState<string | undefined>();
  const announcement = buildAnnouncementState({
    loading,
    loadingMessage: 'Kidbot is planning story panels.',
    errorMessage: error,
    urgentMessage: unavailable,
    readyMessage: panels.length > 0 ? `Planned ${panels.length} panels.` : '',
  });

  const handlePlan = async () => {
    setLoading(true);
    setError(undefined);
    setUnavailable(undefined);
    setPanels([]);
    try {
      const result = (await window.openai?.callTool?.('story_panels', {
        ...sessionContext,
        theme,
        panels: panelCount,
      })) as StoryResponse | undefined;
      if (!result) {
        throw new Error('Widget bridge unavailable.');
      }
      const unavailableMessage = degradedMessage(result);
      if (unavailableMessage) {
        setUnavailable(unavailableMessage);
      } else if (result.blocked) {
        setPanels([]);
        setError(result.message ?? 'Kidbot paused this story idea.');
      } else {
        setPanels(result.panels ?? []);
      }
    } catch (err) {
      setPanels([]);
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
    <section className="panel comic-board" aria-busy={loading}>
      <h2>Comic Storyboard</h2>
      <LiveRegion message={announcement.message} isAlert={announcement.isAlert} />
      <div className="control-row">
        <label htmlFor="theme">Theme</label>
        <input id="theme" value={theme} onChange={(event) => setTheme(event.target.value)} />
        <label htmlFor="panels">Panels</label>
        <input
          id="panels"
          type="number"
          min={2}
          max={8}
          value={panelCount}
          onChange={(event) => setPanelCount(Number(event.target.value))}
        />
        <span className="locked-age">Age: {sessionContext.ageBand}</span>
        <button type="button" onClick={handlePlan} disabled={loading}>
          {loading ? 'Planning...' : 'Plan Panels'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {unavailable && <p className="degraded">{unavailable}</p>}
      <div className="panel-grid">
        {panels.map((panel) => (
          <article key={panel.title} className="panel-card">
            <img src={panel.imageUrl ?? '/placeholder.svg'} alt={panel.imagePrompt} />
            <h3>{panel.title}</h3>
            <p>{panel.caption}</p>
            <small>{panel.imagePrompt}</small>
          </article>
        ))}
      </div>
    </section>
  );
};
