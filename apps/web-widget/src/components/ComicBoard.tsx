import { useEffect, useState } from 'react';

interface StoryPanel {
  title: string;
  caption: string;
  imagePrompt: string;
  imageUrl: string | null;
}

interface StoryResponse {
  blocked: boolean;
  message?: string;
  theme?: string;
  panels?: StoryPanel[];
}

export const ComicBoard = () => {
  const [theme, setTheme] = useState('A brave turtle shares snacks');
  const [panelCount, setPanelCount] = useState(4);
  const [ageBand, setAgeBand] = useState<'4-6' | '7-9' | '10-12'>('7-9');
  const [panels, setPanels] = useState<StoryPanel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    window.openai?.setWidgetState?.({ tab: 'comics', theme, panelCount, ageBand });
  }, [theme, panelCount, ageBand]);

  const handlePlan = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = (await window.openai?.callTool?.('story_panels', {
        theme,
        panels: panelCount,
        ageBand
      })) as StoryResponse | undefined;
      if (!result) {
        throw new Error('Widget bridge unavailable.');
      }
      if (result.blocked) {
        setPanels([]);
        setError(result.message ?? 'KidBot paused this story idea.');
      } else {
        setPanels(result.panels ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel comic-board">
      <h2>Comic Storyboard</h2>
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
        <label htmlFor="panel-age">Age</label>
        <select id="panel-age" value={ageBand} onChange={(event) => setAgeBand(event.target.value as '4-6' | '7-9' | '10-12')}>
          <option value="4-6">Ages 4-6</option>
          <option value="7-9">Ages 7-9</option>
          <option value="10-12">Ages 10-12</option>
        </select>
        <button type="button" onClick={handlePlan} disabled={loading}>
          {loading ? 'Planning...' : 'Plan Panels'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
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
