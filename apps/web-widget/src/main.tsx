import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ColoringBook } from './components/ColoringBook.js';
import { ComicBoard } from './components/ComicBoard.js';
import { ScienceLab } from './components/ScienceLab.js';
import { VoiceBar } from './components/VoiceBar.js';
import {
  ageBandOptions,
  createSessionId,
  isAgeBand,
  type AgeBand,
  type SessionContext,
} from './utils/sessionContext.js';
import './styles.css';

type TabKey = 'voice' | 'comics' | 'coloring' | 'science';

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'voice', label: 'Voice' },
  { key: 'comics', label: 'Comics' },
  { key: 'coloring', label: 'Coloring' },
  { key: 'science', label: 'Science Lab' }
];

const profileId = 'local-default';

interface WidgetSessionState {
  ageBand: AgeBand;
  parentModeUnlocked: boolean;
  parentPin?: string;
  parentPinSet: boolean;
  profileId: string;
  sessionId: string;
  tab: TabKey;
}

declare global {
  interface Window {
    openai?: {
      callTool?: (name: string, input: unknown) => Promise<unknown>;
      setWidgetState?: (state: Record<string, unknown>) => void;
      getWidgetState?: () => Record<string, unknown> | undefined;
      requestDisplayMode?: (options: { mode: 'fullscreen' | 'windowed' }) => void;
    };
  }
}

const isTabKey = (value: unknown): value is TabKey =>
  typeof value === 'string' && tabs.some((tab) => tab.key === value);

const readInitialState = (): WidgetSessionState => {
  const saved = window.openai?.getWidgetState?.();
  const savedSessionId = typeof saved?.sessionId === 'string' ? saved.sessionId : undefined;
  const savedPin = typeof saved?.parentPin === 'string' ? saved.parentPin : undefined;
  return {
    ageBand: isAgeBand(saved?.ageBand) ? saved.ageBand : '7-9',
    parentModeUnlocked: false,
    parentPin: savedPin,
    parentPinSet: Boolean(savedPin || saved?.parentPinSet),
    profileId,
    sessionId: savedSessionId ?? createSessionId(),
    tab: isTabKey(saved?.tab) ? saved.tab : 'voice',
  };
};

export const App = () => {
  const [sessionState, setSessionState] = useState<WidgetSessionState>(() => readInitialState());
  const [activeTab, setActiveTab] = useState<TabKey>('voice');
  const [pinInput, setPinInput] = useState('');
  const [pinMessage, setPinMessage] = useState<string | undefined>();
  const sessionContext: SessionContext = {
    ageBand: sessionState.ageBand,
    profileId: sessionState.profileId,
    sessionId: sessionState.sessionId,
  };

  useEffect(() => {
    setActiveTab(sessionState.tab);
    window.openai?.requestDisplayMode?.({ mode: 'fullscreen' });
  }, [sessionState.tab]);

  useEffect(() => {
    window.openai?.setWidgetState?.({
      ageBand: sessionState.ageBand,
      parentModeUnlocked: sessionState.parentModeUnlocked,
      parentPin: sessionState.parentPin,
      parentPinSet: sessionState.parentPinSet,
      profileId: sessionState.profileId,
      sessionId: sessionState.sessionId,
      tab: activeTab,
    });
  }, [activeTab, sessionState]);

  const handleParentSubmit = () => {
    if (!/^\d{4}$/.test(pinInput)) {
      setPinMessage('Enter a 4-digit PIN.');
      return;
    }

    if (!sessionState.parentPinSet) {
      setSessionState((prev) => ({
        ...prev,
        parentModeUnlocked: true,
        parentPin: pinInput,
        parentPinSet: true,
      }));
      setPinInput('');
      setPinMessage('Parent controls unlocked.');
      return;
    }

    if (pinInput !== sessionState.parentPin) {
      setPinMessage('PIN did not match.');
      return;
    }

    setSessionState((prev) => ({ ...prev, parentModeUnlocked: true }));
    setPinInput('');
    setPinMessage('Parent controls unlocked.');
  };

  const lockParentMode = () => {
    setSessionState((prev) => ({ ...prev, parentModeUnlocked: false }));
    setPinInput('');
    setPinMessage(undefined);
  };

  const updateAgeBand = (ageBand: AgeBand) => {
    setSessionState((prev) => ({ ...prev, ageBand }));
  };

  return (
    <div className="kidbot-app">
      <header className="kidbot-header">
        <h1>Kidbot Play Studio</h1>
        <section className="parent-controls" aria-label="Parent controls">
          <div className="session-summary">
            <span>Age: {sessionState.ageBand}</span>
            <span>Profile: {sessionState.profileId}</span>
          </div>
          {sessionState.parentModeUnlocked ? (
            <div className="control-row">
              <label htmlFor="locked-age">Locked age</label>
              <select
                id="locked-age"
                value={sessionState.ageBand}
                onChange={(event) => updateAgeBand(event.target.value as AgeBand)}
              >
                {ageBandOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button type="button" onClick={lockParentMode}>
                Lock Parent Controls
              </button>
            </div>
          ) : (
            <div className="control-row">
              <label htmlFor="parent-pin">
                {sessionState.parentPinSet ? 'Parent PIN' : 'Create parent PIN'}
              </label>
              <input
                id="parent-pin"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]*"
                type="password"
                value={pinInput}
                onChange={(event) => setPinInput(event.target.value.replace(/\D/g, '').slice(0, 4))}
              />
              <button type="button" onClick={handleParentSubmit}>
                {sessionState.parentPinSet ? 'Unlock Parent Controls' : 'Set Parent PIN'}
              </button>
            </div>
          )}
          {pinMessage && <p className="parent-message">{pinMessage}</p>}
        </section>
        <nav>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={activeTab === tab.key ? 'active' : ''}
              type="button"
              onClick={() => {
                setActiveTab(tab.key);
                setSessionState((prev) => ({ ...prev, tab: tab.key }));
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {activeTab === 'voice' && <VoiceBar sessionContext={sessionContext} />}
        {activeTab === 'comics' && <ComicBoard sessionContext={sessionContext} />}
        {activeTab === 'coloring' && <ColoringBook sessionContext={sessionContext} />}
        {activeTab === 'science' && <ScienceLab sessionContext={sessionContext} />}
      </main>
    </div>
  );
};

const container = document.getElementById('kidbot-root');

if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
