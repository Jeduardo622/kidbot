import { useEffect, useRef, useState } from 'react';
import { LiveRegion } from './LiveRegion.js';
import { buildAnnouncementState } from '../utils/announcementState.js';
import {
  degradedMessage,
  errorMessage,
  unavailableMessageFromError,
} from '../utils/degradation.js';
import { defaultSessionContext, type SessionContext } from '../utils/sessionContext.js';
import { readStructuredContent, type ToolResultRecord } from '../utils/toolResult.js';
import {
  createVoiceCapture,
  isVoiceCaptureAvailable,
  type VoiceCaptureSession,
} from '../utils/voiceCapture.js';
import { speakText } from '../utils/voicePlayback.js';

type Persona = 'robot' | 'fairy' | 'explorer';
type CaptureState = 'idle' | 'listening' | 'unsupported';

const permissionBlockedMessage =
  'Microphone access is blocked. You can still type your question.';
const retryVoiceInputMessage =
  'Voice input stopped. You can try again or type your question.';
const permissionErrorPattern = /not-allowed|permission|service-not-allowed/i;

const voiceCaptureErrorMessage = (message: string): string =>
  permissionErrorPattern.test(message) ? permissionBlockedMessage : retryVoiceInputMessage;

interface VoiceResult extends ToolResultRecord {
  blocked: boolean;
  degraded?: boolean;
  message?: string;
  persona?: Persona;
  text?: string;
  ssml?: string;
}

const personas: Array<{ key: Persona; label: string }> = [
  { key: 'robot', label: 'Robot Buddy' },
  { key: 'fairy', label: 'Fairy Friend' },
  { key: 'explorer', label: 'Explorer Pal' },
];

interface VoiceBarProps {
  sessionContext?: SessionContext;
}

export const VoiceBar = ({ sessionContext = defaultSessionContext }: VoiceBarProps) => {
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

  useEffect(
    () => () => {
      captureSessionRef.current?.stop();
    },
    [],
  );

  const handleVoiceInput = () => {
    if (captureState === 'unsupported') {
      return;
    }
    if (captureState === 'listening') {
      captureSessionRef.current?.stop();
      captureSessionRef.current = undefined;
      setCaptureState('idle');
      return;
    }

    const session = createVoiceCapture({
      onEnd: () => {
        captureSessionRef.current = undefined;
        setCaptureState('idle');
      },
      onError: (message) => {
        setError(voiceCaptureErrorMessage(message));
        setCaptureMessage(undefined);
        setCaptureState('idle');
      },
      onStart: () => {
        setCaptureMessage('Listening...');
        setCaptureState('listening');
      },
      onText: (transcript) => {
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
    if (!text.trim()) {
      setError('Please share what you would like to talk about.');
      return;
    }

    setLoading(true);
    setError(undefined);
    setUnavailable(undefined);
    setResponse(undefined);
    try {
      const result = readStructuredContent<VoiceResult>(await window.openai?.callTool?.('voice_chat', {
        ...sessionContext,
        text,
        persona,
      }));
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
      setResponse(undefined);
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
      <textarea
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
              <button type="button" onClick={() => response.text && speakText(response.text)}>
                Replay
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
};
