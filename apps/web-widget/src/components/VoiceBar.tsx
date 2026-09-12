import { useEffect, useRef, useState } from 'react';
import { LiveRegion } from './LiveRegion.js';
import { buildAnnouncementState } from '../utils/announcementState.js';
import {
  degradedMessage,
  errorMessage,
  unavailableMessageFromError,
} from '../utils/degradation.js';
import { defaultSessionContext, type SessionContext } from '../utils/sessionContext.js';
import {
  isVoiceResult,
  readStructuredContent,
  type Persona,
  type VoiceResult,
} from '../utils/toolResult.js';
import {
  createVoiceCapture,
  isVoiceCaptureAvailable,
  type VoiceCaptureSession,
} from '../utils/voiceCapture.js';
import { isSpeechPlaybackAvailable, speakText, stopSpeaking } from '../utils/voicePlayback.js';

type CaptureState = 'idle' | 'listening' | 'unsupported';

const permissionBlockedMessage =
  'Microphone access is blocked. You can still type your question.';
const retryVoiceInputMessage =
  'Voice input stopped. You can try again or type your question.';
const permissionErrorPattern = /not-allowed|permission|service-not-allowed/i;

const voiceCaptureErrorMessage = (message: string): string =>
  permissionErrorPattern.test(message) ? permissionBlockedMessage : retryVoiceInputMessage;

const personas: Array<{ key: Persona; label: string }> = [
  { key: 'robot', label: 'Robot Buddy' },
  { key: 'fairy', label: 'Fairy Friend' },
  { key: 'explorer', label: 'Explorer Pal' },
];

interface VoiceBarProps {
  sessionContext?: SessionContext;
  active?: boolean;
}

export const VoiceBar = ({ sessionContext = defaultSessionContext, active = true }: VoiceBarProps) => {
  const [persona, setPersona] = useState<Persona>('robot');
  const [text, setText] = useState('Tell me a cheerful space fact!');
  const [captureState, setCaptureState] = useState<CaptureState>(() =>
    isVoiceCaptureAvailable() ? 'idle' : 'unsupported',
  );
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<VoiceResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [captureMessage, setCaptureMessage] = useState<string | undefined>();
  const [unavailable, setUnavailable] = useState<string | undefined>();
  const captureSessionRef = useRef<VoiceCaptureSession | undefined>();
  const requestVersionRef = useRef(0);
  const captureVersionRef = useRef(0);
  const blockedMessage = response?.blocked
    ? (response.message ?? 'Kidbot paused this request.')
    : undefined;
  const announcement = buildAnnouncementState({
    loading,
    loadingMessage: 'Kidbot is thinking.',
    errorMessage: error,
    urgentMessage: unavailable ?? blockedMessage,
    readyMessage:
      captureState === 'listening'
        ? 'Listening...'
        : response?.text
          ? `${response.persona ?? 'Kidbot'} reply ready.`
          : '',
  });

  useEffect(() => {
    if (!active) {
      setLoading(false);
      setCaptureState(isVoiceCaptureAvailable() ? 'idle' : 'unsupported');
      setCaptureMessage(undefined);
    }
    return () => {
      requestVersionRef.current += 1;
      captureVersionRef.current += 1;
      const capture = captureSessionRef.current;
      captureSessionRef.current = undefined;
      capture?.stop();
      stopSpeaking();
    };
  }, [active, sessionContext.ageBand, sessionContext.sessionId]);

  const handleVoiceInput = () => {
    if (!active || captureState === 'unsupported') {
      return;
    }
    if (captureState === 'listening') {
      captureVersionRef.current += 1;
      captureSessionRef.current?.stop();
      captureSessionRef.current = undefined;
      setCaptureState('idle');
      setCaptureMessage(undefined);
      return;
    }

    const captureVersion = ++captureVersionRef.current;
    const session = createVoiceCapture({
      onEnd: () => {
        if (captureVersion !== captureVersionRef.current) return;
        captureSessionRef.current = undefined;
        setCaptureState('idle');
      },
      onError: (message) => {
        if (captureVersion !== captureVersionRef.current) return;
        setError(voiceCaptureErrorMessage(message));
        setCaptureMessage(undefined);
        setCaptureState('idle');
      },
      onStart: () => {
        if (captureVersion !== captureVersionRef.current) return;
        setCaptureMessage('Listening...');
        setCaptureState('listening');
      },
      onText: (transcript) => {
        if (captureVersion !== captureVersionRef.current) return;
        setText(transcript);
        setCaptureMessage(undefined);
      },
    });
    if (!session) {
      setCaptureState('unsupported');
      setCaptureMessage(undefined);
      return;
    }

    setError(undefined);
    setCaptureMessage(undefined);
    captureSessionRef.current = session;
    try {
      session.start();
    } catch (err) {
      captureSessionRef.current = undefined;
      setCaptureState('idle');
      setCaptureMessage(undefined);
      setError(voiceCaptureErrorMessage(errorMessage(err)));
    }
  };

  const voiceInputLabel =
    captureState === 'unsupported'
      ? 'Voice Input Unavailable'
      : captureState === 'listening'
        ? 'Stop Voice Input'
        : 'Start Voice Input';

  const handleSpeak = async () => {
    if (!active) return;
    if (!text.trim()) {
      setError('Please share what you would like to talk about.');
      return;
    }

    const requestVersion = ++requestVersionRef.current;
    setLoading(true);
    setError(undefined);
    setUnavailable(undefined);
    setResponse(undefined);
    try {
      const result = readStructuredContent(await window.openai?.callTool?.('voice_chat', {
        ...sessionContext,
        text,
        persona,
      }), isVoiceResult);
      if (requestVersion !== requestVersionRef.current) return;
      const unavailableMessage = degradedMessage(result);
      if (unavailableMessage) {
        setUnavailable(unavailableMessage);
        return;
      }
      setResponse(result);
      if (!result.blocked && result.text) {
        speakText(result.text);
      }
    } catch (err) {
      if (requestVersion !== requestVersionRef.current) return;
      setResponse(undefined);
      const unavailableMessage = unavailableMessageFromError(err);
      if (unavailableMessage) {
        setUnavailable(unavailableMessage);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false);
    }
  };

  return (
    <section className="panel voice-bar" aria-busy={loading}>
      <h2>Voice Playground</h2>
      <LiveRegion message={announcement.message} isAlert={announcement.isAlert} />
      <div className="control-row">
        <label htmlFor="persona">Persona</label>
        <select
          id="persona"
          value={persona}
          onChange={(event) => setPersona(event.target.value as Persona)}
        >
          {personas.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="locked-age">Age: {sessionContext.ageBand}</span>
      </div>
      <label htmlFor="voice-question">Your question or story idea</label>
      <textarea
        id="voice-question"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Ask a question or share a topic"
        rows={3}
      />
      <button
        type="button"
        onClick={handleVoiceInput}
        disabled={captureState === 'unsupported'}
      >
        {voiceInputLabel}
      </button>
      <button type="button" onClick={handleSpeak} disabled={loading}>
        {loading ? 'Thinking...' : 'Speak'}
      </button>
      {captureMessage && <p className="capture-status">{captureMessage}</p>}
      {error && <p className="error">{error}</p>}
      {unavailable && <p className="degraded">{unavailable}</p>}
      {response && (
        <div className="response">
          {response.blocked ? (
            <p className="blocked">{blockedMessage}</p>
          ) : (
            <>
              <p>{response.text}</p>
              <button type="button" disabled={!active || !isSpeechPlaybackAvailable()} onClick={() => response.text && speakText(response.text)}>
                Replay
              </button>
              {!isSpeechPlaybackAvailable() && <p>Audio playback is unavailable. You can read the reply above.</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
};
