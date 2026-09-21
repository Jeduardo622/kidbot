import { useState } from 'react';
import { PanelArtwork } from './ComicBoard.js';
import { scrapbookKindLabel, type ScrapbookItem } from '../utils/scrapbook.js';

interface ScrapbookProps {
  items: readonly ScrapbookItem[];
  onRemove: (id: string) => void;
}

const formatTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const downloadColoring = (item: Extract<ScrapbookItem, { kind: 'coloring' }>) => {
  const link = document.createElement('a');
  link.href = item.pngDataUrl;
  link.download = `kidbot-${item.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'coloring'}.png`;
  link.click();
};

/**
 * Everything the child made this session, newest first. Lives in App state
 * so it survives tab switches and new requests; it is not persisted.
 */
export const Scrapbook = ({ items, onRemove }: ScrapbookProps) => {
  const [openStoryId, setOpenStoryId] = useState<string | undefined>();

  return (
    <section className="panel scrapbook" aria-label="My Creations">
      <h2>My Creations</h2>
      {items.length === 0 ? (
        <p className="scrapbook-empty">
          Nothing saved yet. Make a story, color a page, or finish an experiment, then press
          Save to keep it here for this play session.
        </p>
      ) : (
        <ul className="scrapbook-grid">
          {items.map((item) => (
            <li key={item.id} className={`scrapbook-card scrapbook-${item.kind}`}>
              <div className="scrapbook-card-header">
                <span className="scrapbook-kind">{scrapbookKindLabel[item.kind]}</span>
                <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
              </div>
              <h3>{item.title}</h3>
              {item.kind === 'story' && (
                <>
                  {item.panels[0] && <PanelArtwork panel={item.panels[0]} />}
                  <p>
                    {item.panels.length} panel{item.panels.length === 1 ? '' : 's'}
                  </p>
                  <button
                    type="button"
                    aria-expanded={openStoryId === item.id}
                    onClick={() => setOpenStoryId((open) => (open === item.id ? undefined : item.id))}
                  >
                    {openStoryId === item.id ? 'Hide story' : 'Read story'}
                  </button>
                  {openStoryId === item.id && (
                    <ol className="scrapbook-story">
                      {item.panels.map((panel, index) => (
                        <li key={`${index}-${panel.title}`}>
                          <PanelArtwork panel={panel} />
                          <strong>{panel.title}</strong>
                          <p>{panel.caption}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}
              {item.kind === 'coloring' && (
                <>
                  <img className="scrapbook-thumb" src={item.pngDataUrl} alt={`Coloring page: ${item.title}`} />
                  <button type="button" onClick={() => downloadColoring(item)}>
                    Download PNG
                  </button>
                </>
              )}
              {item.kind === 'experiment' && (
                <>
                  <p>
                    You guessed <strong>{item.prediction}</strong>.{' '}
                    {item.wasCorrect ? 'Great prediction!' : 'Good try!'}
                  </p>
                  <p className="scrapbook-explanation">{item.explanation}</p>
                  {item.observation && (
                    <p className="scrapbook-observation">You saw: {item.observation}</p>
                  )}
                </>
              )}
              <button type="button" className="subtle" onClick={() => onRemove(item.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
