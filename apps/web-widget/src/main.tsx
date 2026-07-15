import { StrictMode, useEffect, useRef, useState } from 'react';
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
import { isStaleParentCredentialFailure, readToolEnvelope } from './utils/toolResult.js';
import './styles.css';

type TabKey = 'voice' | 'comics' | 'coloring' | 'science';

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'voice', label: 'Voice' },
  { key: 'comics', label: 'Comics' },
  { key: 'coloring', label: 'Coloring' },
  { key: 'science', label: 'Science Lab' }
];

const defaultProfileId = 'local-default';

interface PersistedWidgetState {
  ageBand: AgeBand;
  sessionId: string;
  tab: TabKey;
}

interface ParentCredentialState {
  historyEnabled: boolean;
  parentAccessToken?: string;
  parentModeUnlocked: boolean;
  parentPin?: string;
  profileId: string;
}

type PersistenceStatus =
  | { kind: 'error' | 'pending' | 'success'; message: string }
  | undefined;

type PinStatus = { kind: 'error' | 'success'; message: string } | undefined;

declare global {
  interface Window {
    openai?: {
      callTool?: (name: string, input: unknown) => Promise<unknown>;
      setWidgetState?: (state: Record<string, unknown>) => void;
      widgetState?: Record<string, unknown>;
      requestDisplayMode?: (options: { mode: 'fullscreen' | 'windowed' }) => void;
    };
  }
}

const isTabKey = (value: unknown): value is TabKey =>
  typeof value === 'string' && tabs.some((tab) => tab.key === value);

const readInitialState = (): PersistedWidgetState => {
  const saved = window.openai?.widgetState;
  const savedSessionId = typeof saved?.sessionId === 'string' ? saved.sessionId : undefined;
  return {
    ageBand: isAgeBand(saved?.ageBand) ? saved.ageBand : '7-9',
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

interface ParentProfileDeleteResponse {
  deleted?: boolean;
  profileId?: string;
}

export const App = () => {
  const historyConsentRef = useRef<HTMLInputElement>(null);
  const parentPinRef = useRef<HTMLInputElement>(null);
  const [sessionState, setSessionState] = useState<PersistedWidgetState>(() => readInitialState());
  const [parentCredentials, setParentCredentials] = useState<ParentCredentialState>({
    historyEnabled: false,
    parentModeUnlocked: false,
    profileId: defaultProfileId,
  });
  const [activeTab, setActiveTab] = useState<TabKey>('voice');
  const [pinInput, setPinInput] = useState('');
  const [pinStatus, setPinStatus] = useState<PinStatus>();
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>();
  const persistencePending = persistenceStatus?.kind === 'pending';
  const parentPinSet = Boolean(parentCredentials.parentPin);
  const sessionContext: SessionContext = {
    ageBand: sessionState.ageBand,
    ...(parentCredentials.historyEnabled && parentCredentials.parentAccessToken
      ? { parentAccessToken: parentCredentials.parentAccessToken }
      : {}),
    profileId: parentCredentials.profileId,
    sessionId: sessionState.sessionId,
  };

  useEffect(() => {
    setActiveTab(sessionState.tab);
    window.openai?.requestDisplayMode?.({ mode: 'fullscreen' });
  }, [sessionState.tab]);

  useEffect(() => {
    window.openai?.setWidgetState?.({
      ageBand: sessionState.ageBand,
      sessionId: sessionState.sessionId,
      tab: activeTab,
    });
  }, [activeTab, sessionState.ageBand, sessionState.sessionId]);

  useEffect(() => {
    if (parentCredentials.parentModeUnlocked) {
      historyConsentRef.current?.focus();
    } else if (parentPinSet) {
      parentPinRef.current?.focus();
    }
  }, [parentCredentials.parentModeUnlocked, parentPinSet]);

  const createPersistentProfile = async (ageBand: AgeBand, sessionId: string) => {
    const envelope = readToolEnvelope(await window.openai?.callTool?.('parent_profile_create', {
      ageBand,
      historyEnabled: true,
      sessionId,
    }));
    const result = envelope.structuredContent as ParentProfileCreateResponse | undefined;
    const parentAccessToken = envelope.meta?.parentAccessToken;
    if (typeof parentAccessToken !== 'string' || !result?.profileId || result.historyEnabled !== true) {
      return undefined;
    }
    return {
      ageBand: isAgeBand(result.ageBand) ? result.ageBand : ageBand,
      historyEnabled: true,
      parentAccessToken,
      profileId: result.profileId,
    };
  };

  const handleParentSubmit = async () => {
    if (!/^\d{4}$/.test(pinInput)) {
      setPinStatus({ kind: 'error', message: 'Enter a 4-digit PIN.' });
      return;
    }

    if (!parentPinSet) {
      setParentCredentials((prev) => ({
        ...prev,
        parentModeUnlocked: true,
        parentPin: pinInput,
      }));
      setPinInput('');
      setPinStatus({ kind: 'success', message: 'Parent controls unlocked.' });
      return;
    }

    if (pinInput !== parentCredentials.parentPin) {
      setPinStatus({ kind: 'error', message: 'PIN did not match.' });
      return;
    }

    setParentCredentials((prev) => ({ ...prev, parentModeUnlocked: true }));
    setPinInput('');
    setPinStatus({ kind: 'success', message: 'Parent controls unlocked.' });
  };

  const lockParentMode = () => {
    setParentCredentials((prev) => ({ ...prev, parentModeUnlocked: false }));
    setPinInput('');
    setPinStatus(undefined);
  };

  const updateAgeBand = async (ageBand: AgeBand) => {
    if (!parentCredentials.historyEnabled || !parentCredentials.parentAccessToken) {
      setSessionState((prev) => ({ ...prev, ageBand }));
      return;
    }
    setPinStatus(undefined);
    setPersistenceStatus({ kind: 'pending', message: 'Updating parent profile…' });
    try {
      const { structuredContent: result } = readToolEnvelope(await window.openai?.callTool?.('parent_profile_update', {
        ageBand,
        parentAccessToken: parentCredentials.parentAccessToken,
        profileId: parentCredentials.profileId,
      }));
      const updateResult = result as ParentProfileUpdateResponse | undefined;
      if (updateResult?.profileId !== parentCredentials.profileId) {
        throw new Error('Unexpected profile update result.');
      }
      setSessionState((prev) => ({
        ...prev,
        ageBand: isAgeBand(updateResult.ageBand) ? updateResult.ageBand : prev.ageBand,
      }));
      setPersistenceStatus({ kind: 'success', message: 'Parent profile updated.' });
    } catch {
      setPersistenceStatus({ kind: 'error', message: 'Profile age could not be updated.' });
    }
  };

  const updateHistoryConsent = async (enabled: boolean) => {
    if (persistencePending) return;
    setPinStatus(undefined);

    if (enabled) {
      setPersistenceStatus({ kind: 'pending', message: 'Enabling history…' });
      try {
        if (
          parentCredentials.parentAccessToken &&
          parentCredentials.profileId !== defaultProfileId
        ) {
          const rawResult = await window.openai?.callTool?.('parent_profile_update', {
              historyEnabled: true,
              parentAccessToken: parentCredentials.parentAccessToken,
              profileId: parentCredentials.profileId,
            });
          if (isStaleParentCredentialFailure(rawResult)) {
            setParentCredentials((prev) => ({
              historyEnabled: false,
              parentModeUnlocked: prev.parentModeUnlocked,
              parentPin: prev.parentPin,
              profileId: defaultProfileId,
            }));
            throw new Error('Retained parent credential is no longer valid.');
          }
          const { structuredContent: result } = readToolEnvelope(rawResult);
          const updateResult = result as ParentProfileUpdateResponse;
          if (
            updateResult.profileId !== parentCredentials.profileId ||
            updateResult.historyEnabled !== true
          ) {
            throw new Error('Unexpected profile update result.');
          }
          setParentCredentials((prev) => ({ ...prev, historyEnabled: true }));
        } else {
          const persistedProfile = await createPersistentProfile(
            sessionState.ageBand,
            sessionState.sessionId,
          );
          if (!persistedProfile) throw new Error('Unexpected profile create result.');
          setParentCredentials((prev) => ({ ...prev, ...persistedProfile }));
        }
        setPersistenceStatus({ kind: 'success', message: 'History is enabled.' });
      } catch {
        setParentCredentials((prev) => ({ ...prev, historyEnabled: false }));
        setPersistenceStatus({ kind: 'error', message: 'History could not be enabled.' });
      }
      return;
    }

    if (!parentCredentials.parentAccessToken || parentCredentials.profileId === defaultProfileId) {
      setParentCredentials((prev) => ({ ...prev, historyEnabled: false }));
      return;
    }

    setPersistenceStatus({ kind: 'pending', message: 'Purging saved history…' });
    try {
      const { structuredContent: result } = readToolEnvelope(await window.openai?.callTool?.('parent_profile_update', {
        historyEnabled: false,
        parentAccessToken: parentCredentials.parentAccessToken,
        profileId: parentCredentials.profileId,
      }));
      const updateResult = result as ParentProfileUpdateResponse | undefined;
      if (updateResult?.profileId !== parentCredentials.profileId || updateResult.historyEnabled !== false) {
        throw new Error('Unexpected profile update result.');
      }
      setParentCredentials((prev) => ({ ...prev, historyEnabled: false }));
      setPersistenceStatus({ kind: 'success', message: 'Saved history was purged.' });
    } catch {
      setPersistenceStatus({ kind: 'error', message: 'History could not be disabled.' });
    }
  };

  const deleteParentProfile = async () => {
    if (
      persistencePending ||
      !parentCredentials.parentAccessToken ||
      parentCredentials.profileId === defaultProfileId
    ) {
      return;
    }

    const profileIdToDelete = parentCredentials.profileId;
    setPinStatus(undefined);
    setPersistenceStatus({ kind: 'pending', message: 'Deleting parent profile…' });
    try {
      const { structuredContent: result } = readToolEnvelope(await window.openai?.callTool?.('parent_profile_delete', {
        parentAccessToken: parentCredentials.parentAccessToken,
        profileId: profileIdToDelete,
      }));
      const deleteResult = result as ParentProfileDeleteResponse | undefined;
      if (deleteResult?.deleted !== true || deleteResult.profileId !== profileIdToDelete) {
        throw new Error('Unexpected profile delete result.');
      }
      setParentCredentials((prev) => ({
        ...prev,
        historyEnabled: false,
        parentAccessToken: undefined,
        profileId: defaultProfileId,
      }));
      setPersistenceStatus({ kind: 'success', message: 'Parent profile deleted.' });
    } catch {
      setPersistenceStatus({ kind: 'error', message: 'Profile could not be deleted.' });
    }
  };

  return (
    <div className="kidbot-app">
      <header className="kidbot-header">
        <h1>Kidbot Play Studio</h1>
        <section className="parent-controls" aria-label="Parent controls">
          <div className="session-summary">
            <span>Age: {sessionState.ageBand}</span>
            <span>Profile: {parentCredentials.profileId}</span>
            <span>History: {parentCredentials.historyEnabled ? 'On' : 'Local only'}</span>
          </div>
          {parentCredentials.parentModeUnlocked ? (
            <div className="parent-settings">
              <div className="control-row">
                <label htmlFor="locked-age">Locked age</label>
                <select
                  disabled={persistencePending}
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
              <div className="history-consent">
                <label htmlFor="history-consent">
                  <input
                    ref={historyConsentRef}
                    aria-describedby="history-consent-description"
                    checked={parentCredentials.historyEnabled}
                    disabled={persistencePending}
                    id="history-consent"
                    type="checkbox"
                    onChange={(event) => {
                      void updateHistoryConsent(event.target.checked);
                    }}
                  />
                  Save activity history
                </label>
                <p id="history-consent-description">
                  With your consent, activity history is stored for up to 30 days. Leave this off
                  to keep the session local only. Viewing saved history counts as activity and
                  renews the 30-day window.
                </p>
              </div>
              {parentCredentials.parentAccessToken &&
                parentCredentials.profileId !== defaultProfileId && (
                  <div className="delete-profile">
                    <p id="delete-profile-description">
                      Permanently deletes the parent profile and saved history.
                    </p>
                    <button
                      aria-describedby="delete-profile-description"
                      className="danger-button"
                      disabled={persistencePending}
                      type="button"
                      onClick={() => {
                        void deleteParentProfile();
                      }}
                    >
                      Delete parent profile
                    </button>
                  </div>
                )}
            </div>
          ) : (
            <div className="control-row">
              <label htmlFor="parent-pin">
                {parentPinSet ? 'Parent PIN' : 'Create parent PIN'}
              </label>
              <input
                ref={parentPinRef}
                id="parent-pin"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]*"
                type="password"
                value={pinInput}
                onChange={(event) => setPinInput(event.target.value.replace(/\D/g, '').slice(0, 4))}
              />
              <button type="button" onClick={handleParentSubmit}>
                {parentPinSet ? 'Unlock Parent Controls' : 'Set Parent PIN'}
              </button>
            </div>
          )}
          {pinStatus && (
            <p
              aria-live={pinStatus.kind === 'error' ? 'assertive' : 'polite'}
              className="parent-message"
              role={pinStatus.kind === 'error' ? 'alert' : 'status'}
            >
              {pinStatus.message}
            </p>
          )}
          {persistenceStatus && (
            <p
              aria-live={persistenceStatus.kind === 'error' ? 'assertive' : 'polite'}
              className={`persistence-status ${persistenceStatus.kind}`}
              role={persistenceStatus.kind === 'error' ? 'alert' : 'status'}
            >
              {persistenceStatus.message}
            </p>
          )}
        </section>
        <nav>
          {tabs.map((tab) => (
            <button
              aria-pressed={activeTab === tab.key}
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
