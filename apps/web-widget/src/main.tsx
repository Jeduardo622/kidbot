import './devBridge.js';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ActivityErrorBoundary } from './components/ActivityErrorBoundary.js';
import { ColoringBook } from './components/ColoringBook.js';
import { ComicBoard } from './components/ComicBoard.js';
import { ScienceLab } from './components/ScienceLab.js';
import { Scrapbook } from './components/Scrapbook.js';
import { VoiceBar } from './components/VoiceBar.js';
import {
  addScrapbookItem,
  removeScrapbookItem,
  type ScrapbookDraft,
  type ScrapbookItem,
} from './utils/scrapbook.js';
import {
  ageBandOptions,
  createSessionId,
  isAgeBand,
  type AgeBand,
  type SessionContext,
} from './utils/sessionContext.js';
import { isStaleParentCredentialFailure, readToolEnvelope } from './utils/toolResult.js';
import './styles.css';

type TabKey = 'voice' | 'comics' | 'coloring' | 'science' | 'creations';

const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'voice', label: 'Voice', icon: '🎙️' },
  { key: 'comics', label: 'Comics', icon: '📖' },
  { key: 'coloring', label: 'Coloring', icon: '🖍️' },
  { key: 'science', label: 'Science Lab', icon: '🧪' },
  { key: 'creations', label: 'My Creations', icon: '⭐' },
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

interface ParentHistoryEvent {
  ageBand: AgeBand;
  id: string;
  profileId: string;
  sessionId: string;
  status: 'blocked' | 'degraded' | 'error' | 'ok';
  timestamp: string;
  tool: string;
}

type HistoryStatus =
  | { kind: 'error'; message: string }
  | { events: ParentHistoryEvent[]; kind: 'ready' }
  | { kind: 'pending' }
  | undefined;

const historyToolLabels: Record<string, string> = {
  coloring_outline: 'Coloring Corner',
  science_sim: 'Science Lab',
  story_panels: 'Comic Storyboard',
  voice_chat: 'Voice Playground',
};

const historyStatusLabels: Record<ParentHistoryEvent['status'], string> = {
  blocked: 'Paused for safety',
  degraded: 'Completed with limited service',
  error: 'Could not complete',
  ok: 'Completed',
};

const isParentHistoryEvent = (value: unknown): value is ParentHistoryEvent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === 'string' &&
    typeof event.timestamp === 'string' &&
    !Number.isNaN(Date.parse(event.timestamp)) &&
    typeof event.tool === 'string' &&
    typeof event.sessionId === 'string' &&
    typeof event.profileId === 'string' &&
    isAgeBand(event.ageBand) &&
    (event.status === 'ok' ||
      event.status === 'blocked' ||
      event.status === 'degraded' ||
      event.status === 'error')
  );
};

export const App = () => {
  const historyConsentRef = useRef<HTMLInputElement>(null);
  const historyReadVersionRef = useRef(0);
  const parentPinRef = useRef<HTMLInputElement>(null);
  const [sessionState, setSessionState] = useState<PersistedWidgetState>(() => readInitialState());
  const [parentCredentials, setParentCredentials] = useState<ParentCredentialState>({
    historyEnabled: false,
    parentModeUnlocked: false,
    profileId: defaultProfileId,
  });
  const [activeTab, setActiveTab] = useState<TabKey>('voice');
  const [scrapbook, setScrapbook] = useState<ScrapbookItem[]>([]);
  const saveToScrapbook = (draft: ScrapbookDraft) => {
    setScrapbook((prev) => addScrapbookItem(prev, draft));
  };
  const removeFromScrapbook = (id: string) => {
    setScrapbook((prev) => removeScrapbookItem(prev, id));
  };
  const [pinInput, setPinInput] = useState('');
  const [pinStatus, setPinStatus] = useState<PinStatus>();
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>();
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>();
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  const featureStateKey = `${sessionState.sessionId}:${sessionState.ageBand}`;

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
    historyReadVersionRef.current += 1;
    setHistoryStatus(undefined);
  }, [sessionState.ageBand, sessionState.sessionId]);

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
    if (envelope.isError) throw new Error('Parent profile creation failed.');
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
    setConfirmDelete(false);
  };

  const clearRetainedParentCredential = () => {
    historyReadVersionRef.current += 1;
    setHistoryStatus(undefined);
    setParentCredentials((prev) => ({
      historyEnabled: false,
      parentModeUnlocked: prev.parentModeUnlocked,
      parentPin: prev.parentPin,
      profileId: defaultProfileId,
    }));
    setConfirmDelete(false);
  };

  const updateAgeBand = async (ageBand: AgeBand) => {
    historyReadVersionRef.current += 1;
    setHistoryStatus(undefined);
    if (!parentCredentials.historyEnabled || !parentCredentials.parentAccessToken) {
      setSessionState((prev) => ({ ...prev, ageBand }));
      return;
    }
    setPinStatus(undefined);
    setPersistenceStatus({ kind: 'pending', message: 'Updating parent profile…' });
    try {
      const rawResult = await window.openai?.callTool?.('parent_profile_update', {
        ageBand,
        parentAccessToken: parentCredentials.parentAccessToken,
        profileId: parentCredentials.profileId,
      });
      if (isStaleParentCredentialFailure(rawResult)) {
        clearRetainedParentCredential();
        setHistoryStatus(undefined);
        throw new Error('Retained parent credential is no longer valid.');
      }
      const envelope = readToolEnvelope(rawResult);
      if (envelope.isError) throw new Error('Parent profile update failed.');
      const { structuredContent: result } = envelope;
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
    historyReadVersionRef.current += 1;
    setHistoryStatus(undefined);
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
            clearRetainedParentCredential();
            setHistoryStatus(undefined);
            throw new Error('Retained parent credential is no longer valid.');
          }
          const envelope = readToolEnvelope(rawResult);
          if (envelope.isError) throw new Error('Parent profile update failed.');
          const { structuredContent: result } = envelope;
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
      setHistoryStatus(undefined);
      return;
    }

    setPersistenceStatus({ kind: 'pending', message: 'Purging saved history…' });
    try {
      const envelope = readToolEnvelope(await window.openai?.callTool?.('parent_profile_update', {
        historyEnabled: false,
        parentAccessToken: parentCredentials.parentAccessToken,
        profileId: parentCredentials.profileId,
      }));
      if (envelope.isError) throw new Error('Parent profile update failed.');
      const { structuredContent: result } = envelope;
      const updateResult = result as ParentProfileUpdateResponse | undefined;
      if (updateResult?.profileId !== parentCredentials.profileId || updateResult.historyEnabled !== false) {
        throw new Error('Unexpected profile update result.');
      }
      historyReadVersionRef.current += 1;
      setParentCredentials((prev) => ({ ...prev, historyEnabled: false }));
      setHistoryStatus(undefined);
      setPersistenceStatus({ kind: 'success', message: 'Saved history was purged.' });
    } catch {
      setPersistenceStatus({ kind: 'error', message: 'History could not be disabled.' });
    }
  };

  const loadParentHistory = async () => {
    if (
      persistencePending ||
      historyStatus?.kind === 'pending' ||
      !parentCredentials.parentAccessToken ||
      parentCredentials.profileId === defaultProfileId
    ) {
      return;
    }
    const historyReadVersion = historyReadVersionRef.current + 1;
    historyReadVersionRef.current = historyReadVersion;
    setHistoryStatus({ kind: 'pending' });
    try {
      const rawResult = await window.openai?.callTool?.('parent_history_list', {
        limit: 25,
        parentAccessToken: parentCredentials.parentAccessToken,
        profileId: parentCredentials.profileId,
      });
      if (historyReadVersion !== historyReadVersionRef.current) return;
      if (isStaleParentCredentialFailure(rawResult)) {
        clearRetainedParentCredential();
        setHistoryStatus({
          kind: 'error',
          message: 'Saved profile access expired. Enable history again to continue.',
        });
        return;
      }
      const envelope = readToolEnvelope(rawResult);
      if (envelope.isError) throw new Error('Parent history request failed.');
      const events = envelope.structuredContent.events;
      if (
        !Array.isArray(events) ||
        !events.every(
          (event) =>
            isParentHistoryEvent(event) && event.profileId === parentCredentials.profileId,
        )
      ) {
        throw new Error('Unexpected parent history result.');
      }
      setHistoryStatus({ events, kind: 'ready' });
    } catch {
      if (historyReadVersion !== historyReadVersionRef.current) return;
      setHistoryStatus({
        kind: 'error',
        message: 'Saved activity could not be loaded. Please try again.',
      });
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

    historyReadVersionRef.current += 1;
    setHistoryStatus(undefined);
    const profileIdToDelete = parentCredentials.profileId;
    setPinStatus(undefined);
    setPersistenceStatus({ kind: 'pending', message: 'Deleting parent profile…' });
    try {
      const envelope = readToolEnvelope(await window.openai?.callTool?.('parent_profile_delete', {
        parentAccessToken: parentCredentials.parentAccessToken,
        profileId: profileIdToDelete,
      }));
      if (envelope.isError) throw new Error('Parent profile deletion failed.');
      const { structuredContent: result } = envelope;
      const deleteResult = result as ParentProfileDeleteResponse | undefined;
      if (deleteResult?.deleted !== true || deleteResult.profileId !== profileIdToDelete) {
        throw new Error('Unexpected profile delete result.');
      }
      historyReadVersionRef.current += 1;
      setParentCredentials((prev) => ({
        ...prev,
        historyEnabled: false,
        parentAccessToken: undefined,
        profileId: defaultProfileId,
      }));
      setHistoryStatus(undefined);
      setConfirmDelete(false);
      setPersistenceStatus({ kind: 'success', message: 'Parent profile deleted.' });
    } catch {
      setPersistenceStatus({ kind: 'error', message: 'Profile could not be deleted.' });
    }
  };

  return (
    <div className="kidbot-app">
      <header className="kidbot-header">
        <h1>Kidbot Play Studio</h1>
        <div className="transparency-note">
          <p>Kidbot is an AI friend that helps you learn and play.</p>
          <a href="/privacy" target="_blank" rel="noreferrer">
            Read the Kidbot privacy policy
          </a>
        </div>
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
                  <div className="saved-parent-data">
                    <button
                      type="button"
                      disabled={persistencePending || historyStatus?.kind === 'pending'}
                      onClick={() => void loadParentHistory()}
                    >
                      {historyStatus?.kind === 'pending'
                        ? 'Loading saved activity…'
                        : 'View saved activity'}
                    </button>
                    {historyStatus?.kind === 'pending' && (
                      <p className="history-status" role="status">
                        Loading saved activity…
                      </p>
                    )}
                    {historyStatus?.kind === 'ready' && (
                      <section
                        aria-label="Saved activity"
                        className="saved-activity"
                      >
                        <h3>Saved activity</h3>
                        {historyStatus.events.length === 0 ? (
                          <p>No saved activity yet.</p>
                        ) : (
                          <ul>
                            {historyStatus.events.map((event) => (
                              <li key={event.id}>
                                <strong>{historyToolLabels[event.tool] ?? 'Kidbot activity'}</strong>
                                <span>
                                  Ages {event.ageBand} · {historyStatusLabels[event.status]}
                                </span>
                                <time dateTime={event.timestamp}>{event.timestamp}</time>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    )}
                    <div className="delete-profile">
                      <p id="delete-profile-description">
                        Permanently deletes the parent profile and saved history.
                      </p>
                      {!confirmDelete ? (
                        <button
                          aria-describedby="delete-profile-description"
                          className="danger-button"
                          disabled={persistencePending}
                          type="button"
                          onClick={() => setConfirmDelete(true)}
                        >
                          Delete parent profile
                        </button>
                      ) : (
                        <div className="delete-confirmation" role="group" aria-label="Confirm profile deletion">
                          <p>Delete this parent profile and all saved activity?</p>
                          <div className="control-row">
                            <button
                              type="button"
                              disabled={persistencePending}
                              onClick={() => setConfirmDelete(false)}
                            >
                              Cancel deletion
                            </button>
                            <button
                              className="danger-button"
                              type="button"
                              disabled={persistencePending}
                              onClick={() => void deleteParentProfile()}
                            >
                              Confirm delete parent profile
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              {historyStatus?.kind === 'error' && (
                <p className="history-status error" role="alert">
                  {historyStatus.message}
                </p>
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
        <nav aria-label="Play studio activities">
          {tabs.map((tab) => (
            <button
              aria-controls={`activity-${tab.key}`}
              aria-pressed={activeTab === tab.key}
              key={tab.key}
              className={activeTab === tab.key ? 'active' : ''}
              type="button"
              onClick={() => {
                setActiveTab(tab.key);
                setSessionState((prev) => ({ ...prev, tab: tab.key }));
              }}
            >
              <span className="tab-icon" aria-hidden="true">{tab.icon}</span>
              {tab.label}
              {tab.key === 'creations' && scrapbook.length > 0 && (
                <span className="tab-count" aria-label={`${scrapbook.length} saved`}>
                  {scrapbook.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </header>
      <main>
        <div id="activity-voice" className="feature-panel" hidden={activeTab !== 'voice'}>
          <ActivityErrorBoundary activity="Voice Playground">
            <VoiceBar key={featureStateKey} active={activeTab === 'voice'} sessionContext={sessionContext} />
          </ActivityErrorBoundary>
        </div>
        <div id="activity-comics" className="feature-panel" hidden={activeTab !== 'comics'}>
          <ActivityErrorBoundary activity="Comic Storyboard">
            <ComicBoard key={featureStateKey} active={activeTab === 'comics'} sessionContext={sessionContext} onSaveToScrapbook={saveToScrapbook} />
          </ActivityErrorBoundary>
        </div>
        <div id="activity-coloring" className="feature-panel" hidden={activeTab !== 'coloring'}>
          <ActivityErrorBoundary activity="Coloring Corner">
            <ColoringBook key={featureStateKey} sessionContext={sessionContext} onSaveToScrapbook={saveToScrapbook} />
          </ActivityErrorBoundary>
        </div>
        <div id="activity-science" className="feature-panel" hidden={activeTab !== 'science'}>
          <ActivityErrorBoundary activity="Science Lab">
            <ScienceLab key={featureStateKey} sessionContext={sessionContext} onSaveToScrapbook={saveToScrapbook} />
          </ActivityErrorBoundary>
        </div>
        <div id="activity-creations" className="feature-panel" hidden={activeTab !== 'creations'}>
          <ActivityErrorBoundary activity="My Creations">
            <Scrapbook items={scrapbook} onRemove={removeFromScrapbook} />
          </ActivityErrorBoundary>
        </div>
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
