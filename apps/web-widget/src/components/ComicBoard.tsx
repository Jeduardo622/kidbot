import { useEffect, useState } from 'react';
import { LiveRegion } from './LiveRegion.js';
import { buildAnnouncementState } from '../utils/announcementState.js';
import type { ScrapbookDraft } from '../utils/scrapbook.js';
import { defaultSessionContext, type SessionContext } from '../utils/sessionContext.js';
import { isStoryResult, type StoryPanel, type StoryResult } from '../utils/toolResult.js';
import { useToolCall } from '../utils/useToolCall.js';
import { isSpeechPlaybackAvailable, speakText, stopSpeaking } from '../utils/voicePlayback.js';

interface ComicBoardProps {
  sessionContext?: SessionContext;
  onSaveToScrapbook?: (draft: ScrapbookDraft) => void;
}

const CONTINUE_PANELS = 2;
const CONTINUE_FROM_MAX = 240;

const artworkAltText = (imagePrompt: string) => `Story panel artwork: ${imagePrompt}`;

export const PanelArtwork = ({ panel }: { panel: StoryPanel }) => {
  const altText = artworkAltText(panel.imagePrompt);
  const imageUrl = panel.imageUrl;
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  if (imageUrl && imageUrl !== failedImageUrl) {
    return (
      <img
        className="panel-artwork"
        src={imageUrl}
        alt={altText}
        onError={() => setFailedImageUrl(imageUrl)}
      />
    );
  }

  return (
    <div className="panel-artwork panel-artwork-placeholder" role="img" aria-label={altText}>
      <span className="panel-artwork-placeholder-sun" aria-hidden="true" />
      <span className="panel-artwork-placeholder-hill panel-artwork-placeholder-hill-back" aria-hidden="true" />
      <span className="panel-artwork-placeholder-hill" aria-hidden="true" />
    </div>
  );
};

const SkeletonPanels = ({ count }: { count: number }) => (
  <div className="panel-grid" aria-hidden="true">
    {Array.from({ length: count }, (_, index) => (
      <article key={index} className="panel-card skeleton">
        <div className="panel-artwork skeleton-block" />
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line" />
        <div className="skeleton-line short" />
      </article>
    ))}
  </div>
);

export const ComicBoard = ({
  sessionContext = defaultSessionContext,
  onSaveToScrapbook,
}: ComicBoardProps) => {
  const [theme, setTheme] = useState('A brave turtle shares snacks');
  const [panelCount, setPanelCount] = useState(4);
  const [panels, setPanels] = useState<StoryPanel[]>([]);
  const [blocked, setBlocked] = useState<string | undefined>();
  const [speaking, setSpeaking] = useState(false);
  const [saved, setSaved] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const tool = useToolCall<StoryResult>('story_panels', isStoryResult, {
    blockedFallback: 'Kidbot paused this story idea.',
  });
  const safePanelCount = Number.isInteger(panelCount) && panelCount >= 2 && panelCount <= 8
    ? panelCount
    : 4;
  const announcement = buildAnnouncementState({
    loading: tool.loading,
    loadingMessage: continuing ? 'Kidbot is writing what happens next.' : 'Kidbot is planning story panels.',
    errorMessage: tool.error,
    urgentMessage: tool.unavailable ?? blocked,
    readyMessage: panels.length > 0 ? `Planned ${panels.length} panels.` : '',
  });

  useEffect(() => () => stopSpeaking(), []);

  const handlePlan = async () => {
    stopSpeaking();
    setSpeaking(false);
    setPanels([]);
    setBlocked(undefined);
    setSaved(false);
    setContinuing(false);
    const outcome = await tool.run({ ...sessionContext, theme, panels: safePanelCount });
    if (outcome.kind === 'ok') {
      setPanels(outcome.result.panels ?? []);
    } else if (outcome.kind === 'blocked') {
      setBlocked(outcome.message);
    }
  };

  const handleContinue = async () => {
    const last = panels[panels.length - 1];
    if (!last) return;
    stopSpeaking();
    setSpeaking(false);
    setBlocked(undefined);
    setSaved(false);
    setContinuing(true);
    const outcome = await tool.run({
      ...sessionContext,
      theme,
      panels: CONTINUE_PANELS,
      continueFrom: last.caption.slice(0, CONTINUE_FROM_MAX),
    });
    setContinuing(false);
    if (outcome.kind === 'ok') {
      setPanels((prev) => [...prev, ...(outcome.result.panels ?? [])]);
    } else if (outcome.kind === 'blocked') {
      setBlocked(outcome.message);
    }
  };

  const readAloud = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    const narration = panels.map((panel) => `${panel.title}. ${panel.caption}`).join(' ');
    const started = speakText(narration, { persona: 'explorer', onEnd: () => setSpeaking(false) });
    setSpeaking(started);
  };

  const saveStory = () => {
    if (panels.length === 0 || !onSaveToScrapbook) return;
    onSaveToScrapbook({ kind: 'story', title: theme, panels });
    setSaved(true);
  };

  const showSkeleton = tool.loading && !continuing;

  return (
    <section className="panel comic-board" aria-busy={tool.loading}>
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
        <button type="button" onClick={() => void handlePlan()} disabled={tool.loading}>
          {tool.loading && !continuing ? 'Planning...' : 'Plan Panels'}
        </button>
      </div>
      {tool.error && <p className="error">{tool.error}</p>}
      {tool.unavailable && <p className="degraded">{tool.unavailable}</p>}
      {blocked && <p className="blocked">{blocked}</p>}
      {showSkeleton && <SkeletonPanels count={safePanelCount} />}
      {panels.length > 0 && (
        <>
          <div className="control-row story-actions">
            <button
              type="button"
              disabled={!isSpeechPlaybackAvailable()}
              aria-pressed={speaking}
              onClick={readAloud}
            >
              {speaking ? 'Stop reading' : 'Read to me'}
            </button>
            <button type="button" disabled={tool.loading || panels.length + CONTINUE_PANELS > 16} onClick={() => void handleContinue()}>
              {continuing ? 'Writing...' : 'What happens next?'}
            </button>
            {onSaveToScrapbook && (
              <button type="button" disabled={saved || tool.loading} onClick={saveStory}>
                {saved ? 'Saved to My Creations' : 'Save to My Creations'}
              </button>
            )}
          </div>
          <div className="panel-grid">
            {panels.map((panel, index) => (
              <article key={`${index}-${panel.title}`} className="panel-card">
                <PanelArtwork panel={panel} />
                <h3>
                  <span className="panel-number" aria-hidden="true">{index + 1}</span> {panel.title}
                </h3>
                <p>{panel.caption}</p>
              </article>
            ))}
          </div>
        </>
      )}
      {continuing && tool.loading && <SkeletonPanels count={CONTINUE_PANELS} />}
    </section>
  );
};
