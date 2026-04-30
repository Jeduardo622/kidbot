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
  historyEnabled: boolean;
  parentAccessToken?: string;
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
  const savedParentAccessToken =
    typeof saved?.parentAccessToken === 'string' ? saved.parentAccessToken : undefined;
  return {
    ageBand: isAgeBand(saved?.ageBand) ? saved.ageBand : '7-9',
    historyEnabled: Boolean(saved?.historyEnabled && savedParentAccessToken),
    parentAccessToken: savedParentAccessToken,
    parentModeUnlocked: false,
    parentPin: savedPin,
    parentPinSet: Boolean(savedPin || saved?.parentPinSet),
    profileId: typeof saved?.profileId === 'string' ? saved.profileId : profileId,
    sessionId: savedSessionId ?? createSessionId(),
    tab: isTabKey(saved?.tab) ? saved.tab : 'voice',
  };
};

interface ParentProfileCreateResponse {
  ageBand?: AgeBand;
  historyEnabled?: boolean;
  parentAccessToken?: string;
  profileId?: string;
}

interface ParentProfileUpdateResponse {
  ageBand?: AgeBand;
  historyEnabled?: boolean;
  profileId?: string;
}

export const App = () => {
  const [sessionState, setSessionState] = useState<WidgetSessionState>(() => readInitialState());
  const [activeTab, setActiveTab] = useState<TabKey>('voice');
  const [pinInput, setPinInput] = useState('');
  const [pinMessage, setPinMessage] = useState<string | undefined>();
  const sessionContext: SessionContext = {
    ageBand: sessionState.ageBand,
    ...(sessionState.historyEnabled && sessionState.parentAccessToken
      ? { parentAccessToken: sessionState.parentAccessToken }
      : {}),
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
      historyEnabled: sessionState.historyEnabled,
      parentAccessToken: sessionState.parentAccessToken,
      parentModeUnlocked: sessionState.parentModeUnlocked,
      parentPin: sessionState.parentPin,
      parentPinSet: sessionState.parentPinSet,
      profileId: sessionState.profileId,
      sessionId: sessionState.sessionId,
      tab: activeTab,
    });
  }, [activeTab, sessionState]);

  const createPersistentProfile = async (ageBand: AgeBand, sessionId: string) => {
    const result = (await window.openai?.callTool?.('parent_profile_create', {
      ageBand,
      sessionId,
    })) as ParentProfileCreateResponse | undefined;
    if (!result?.parentAccessToken || !result.profileId || result.historyEnabled !== true) {
      return undefined;
    }
    return {
      ageBand: isAgeBand(result.ageBand) ? result.ageBand : ageBand,
      historyEnabled: true,
      parentAccessToken: result.parentAccessToken,
      profileId: result.profileId,
    };
  };

  const handleParentSubmit = async () => {
    if (!/^\d{4}$/.test(pinInput)) {
      setPinMessage('Enter a 4-digit PIN.');
      return;
    }

    if (!sessionState.parentPinSet) {
      const persistedProfile = await createPersistentProfile(
        sessionState.ageBand,
        sessionState.sessionId,
      ).catch(() => undefined);
      setSessionState((prev) => ({
        ...prev,
        ...persistedProfile,
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

    const persistedProfile = sessionState.parentAccessToken
      ? undefined
      : await createPersistentProfile(sessionState.ageBand, sessionState.sessionId).catch(() => undefined);
    setSessionState((prev) => ({ ...prev, ...persistedProfile, parentModeUnlocked: true }));
    setPinInput('');
    setPinMessage('Parent controls unlocked.');
  };

  const lockParentMode = () => {
    setSessionState((prev) => ({ ...prev, parentModeUnlocked: false }));
    setPinInput('');
    setPinMessage(undefined);
  };

  const updateAgeBand = async (ageBand: AgeBand) => {
    setSessionState((prev) => ({ ...prev, ageBand }));
    if (!sessionState.historyEnabled || !sessionState.parentAccessToken) {
      return;
    }
    const result = (await window.openai?.callTool?.('parent_profile_update', {
      ageBand,
      parentAccessToken: sessionState.parentAccessToken,
      profileId: sessionState.profileId,
    }).catch(() => undefined)) as ParentProfileUpdateResponse | undefined;
    if (result?.profileId === sessionState.profileId) {
      setSessionState((prev) => ({
        ...prev,
        ageBand: isAgeBand(result.ageBand) ? result.ageBand : prev.ageBand,
        historyEnabled: result.historyEnabled ?? prev.historyEnabled,
      }));
    }
  };

  return (
    <div className="kidbot-app">
      <header className="kidbot-header">
        <h1>Kidbot Play Studio</h1>
        <section className="parent-controls" aria-label="Parent controls">
          <div className="session-summary">
            <span>Age: {sessionState.ageBand}</span>
            <span>Profile: {sessionState.profileId}</span>
            <span>History: {sessionState.historyEnabled ? 'On' : 'Local only'}</span>
          </div>
          {sessionState.parentModeUnlocked ? (
            <div className="control-row">
              <label htmlFor="locked-age">Locked age</label>
              <select
                id="locked-age"
                value={sessionState.ageBand}
                onChange={(event) => {
                  void updateAgeBand(event.target.value as AgeBand);
                }}
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
