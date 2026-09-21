import { useEffect, useRef, useState } from 'react';
import { LiveRegion } from './LiveRegion.js';
import { buildAnnouncementState } from '../utils/announcementState.js';
import { errorMessage } from '../utils/degradation.js';
import { defaultSessionContext, type SessionContext } from '../utils/sessionContext.js';
import { isVoiceResult, type Persona, type VoiceResult } from '../utils/toolResult.js';
import { useToolCall } from '../utils/useToolCall.js';
import {
  createVoiceCapture,
  isVoiceCaptureAvailable,
  type VoiceCaptureSession,
} from '../utils/voiceCapture.js';
import {
  isSpeechPlaybackAvailable,
  personaVoicePresets,
  speakText,
  stopSpeaking,
} from '../utils/voicePlayback.js';

type CaptureState = 'idle' | 'listening' | 'unsupported';

export interface TranscriptTurn {
  role: 'child' | 'kidbot';
  text: string;
}

/** Turns replayed to the server for context; matches the tool schema cap. */
const HISTORY_TURNS = 6;
/** Turns kept on screen. */
const TRANSCRIPT_TURNS = 12;
const TEXT_MAX = 280;

const permissionBlockedMessage =
  'Microphone access is blocked. You can still type your question.';
const retryVoiceInputMessage =
  'Voice input stopped. You can try again or type your question.';
const unsupportedMicMessage =
  'Talking needs a browser with speech recognition, like Chrome or Edge. You can type instead.';
const permissionErrorPattern = /not-allowed|permission|service-not-allowed/i;

const voiceCaptureErrorMessage = (message: string): string =>
  permissionErrorPattern.test(message) ? permissionBlockedMessage : retryVoiceInputMessage;

const personas: Persona[] = ['robot', 'fairy', 'explorer'];

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
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [lastReply, setLastReply] = useState<VoiceResult | undefined>();
  const [blocked, setBlocked] = useState<string | undefined>();
  const [captureMessage, setCaptureMessage] = useState<string | undefined>();
  const [captureError, setCaptureError] = useState<string | undefined>();
  const [speaking, setSpeaking] = useState(false);
  const tool = useToolCall<VoiceResult>('voice_chat', isVoiceResult, {
    blockedFallback: 'Kidbot paused this request.',
  });
  const captureSessionRef = useRef<VoiceCaptureSession | undefined>();
  const captureVersionRef = useRef(0);
  const preset = personaVoicePresets[persona];
  const announcement = buildAnnouncementState({
    loading: tool.loading,
    loadingMessage: 'Kidbot is thinking.',
    errorMessage: tool.error ?? captureError,
    urgentMessage: tool.unavailable ?? blocked,
    readyMessage:
      captureState === 'listening'
        ? 'Listening...'
        : lastReply?.text
          ? `${lastReply.persona ?? 'Kidbot'} reply ready.`
          : '',
  });

  const { cancel } = tool;
  useEffect(() => {
    if (!active) {
      cancel();
      setCaptureState(isVoiceCaptureAvailable() ? 'idle' : 'unsupported');
      setCaptureMessage(undefined);
    }
    return () => {
      captureVersionRef.current += 1;
      const capture = captureSessionRef.current;
      captureSessionRef.current = undefined;
      capture?.stop();
      stopSpeaking();
      setSpeaking(false);
    };
  }, [active, cancel, sessionContext.ageBand, sessionContext.sessionId]);

  const speak = (reply: string) => {
    const started = speakText(reply, { persona, onEnd: () => setSpeaking(false) });
    setSpeaking(started);
  };

  const stop = () => {
    stopSpeaking();
    setSpeaking(false);
  };

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
        setCaptureError(voiceCaptureErrorMessage(message));
        setCaptureMessage(undefined);
        setCaptureState('idle');
      },
      onStart: () => {
        if (captureVersion !== captureVersionRef.current) return;
        setCaptureMessage('Listening...');
        setCaptureState('listening');
      },
      onText: (spoken) => {
        if (captureVersion !== captureVersionRef.current) return;
        setText(spoken);
        setCaptureMessage(undefined);
      },
    });
    if (!session) {
      setCaptureState('unsupported');
      setCaptureMessage(undefined);
      return;
    }

    setCaptureError(undefined);
    setCaptureMessage(undefined);
    captureSessionRef.current = session;
    try {
      session.start();
    } catch (err) {
      captureSessionRef.current = undefined;
      setCaptureState('idle');
      setCaptureMessage(undefined);
      setCaptureError(voiceCaptureErrorMessage(errorMessage(err)));
    }
  };

  const voiceInputLabel =
    captureState === 'unsupported'
      ? 'Voice Input Unavailable'
      : captureState === 'listening'
        ? 'Stop Voice Input'
        : 'Start Voice Input';

  const handleAsk = async () => {
    if (!active) return;
    const question = text.trim();
    if (!question) {
      setCaptureError('Please share what you would like to talk about.');
      return;
    }

    if (speaking) stop();
    setCaptureError(undefined);
    setBlocked(undefined);
    setLastReply(undefined);
    const boundedQuestion = question.slice(0, TEXT_MAX);
    // Replayed turns must satisfy the schema cap even when a reply or a
    // dictated question ran long.
    const history = transcript
      .slice(-HISTORY_TURNS)
      .map((turn) => ({ role: turn.role, text: turn.text.slice(0, TEXT_MAX) }));
    const outcome = await tool.run({
      ...sessionContext,
      text: boundedQuestion,
      persona,
      ...(history.length > 0 ? { history } : {}),
    });
    if (outcome.kind === 'ok') {
      const reply = outcome.result;
      setLastReply(reply);
      if (reply.text) {
        const replyText = reply.text;
        const turns: TranscriptTurn[] = [
          { role: 'child', text: boundedQuestion },
          { role: 'kidbot', text: replyText },
        ];
        setTranscript((prev) => [...prev, ...turns].slice(-TRANSCRIPT_TURNS));
        setText('');
        speak(replyText);
      }
    } else if (outcome.kind === 'blocked') {
      setBlocked(outcome.message);
    }
  };

  const clearChat = () => {
    if (speaking) stop();
    setTranscript([]);
    setLastReply(undefined);
    setBlocked(undefined);
  };

  return (
    <section className="panel voice-bar" aria-busy={tool.loading}>
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
            <option key={option} value={option}>
              {personaVoicePresets[option].label}
            </option>
          ))}
        </select>
        <span className={`persona-chip persona-${persona}`} aria-hidden="true">
          <span className="persona-avatar">{preset.avatar}</span> {preset.description}
        </span>
        <span className="locked-age">Age: {sessionContext.ageBand}</span>
      </div>
      {transcript.length > 0 && (
        <ol className="transcript" aria-label="Conversation">
          {transcript.map((turn, index) => (
            <li key={index} className={`turn turn-${turn.role}`}>
              <span className="turn-avatar" aria-hidden="true">
                {turn.role === 'child' ? '🙂' : preset.avatar}
              </span>
              <span className="turn-role sr-only">{turn.role === 'child' ? 'You' : 'Kidbot'}:</span>
              <p>{turn.text}</p>
            </li>
          ))}
        </ol>
      )}
      <label htmlFor="voice-question">Your question or story idea</label>
      <textarea
        id="voice-question"
        value={text}
        maxLength={TEXT_MAX}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void handleAsk();
          }
        }}
        placeholder="Ask a question or share a topic"
        rows={2}
      />
      <div className="control-row voice-actions">
        <button
          type="button"
          onClick={handleVoiceInput}
          disabled={captureState === 'unsupported'}
        >
          {voiceInputLabel}
        </button>
        <button type="button" className="primary" onClick={() => void handleAsk()} disabled={tool.loading}>
          {tool.loading ? 'Thinking...' : 'Ask'}
        </button>
        {speaking && (
          <button type="button" onClick={stop}>
            Stop
          </button>
        )}
        {transcript.length > 0 && (
          <button type="button" className="subtle" onClick={clearChat} disabled={tool.loading}>
            Clear chat
          </button>
        )}
      </div>
      {captureState === 'unsupported' && <p className="hint">{unsupportedMicMessage}</p>}
      {captureMessage && <p className="capture-status">{captureMessage}</p>}
      {captureError && <p className="error">{captureError}</p>}
      {tool.error && <p className="error">{tool.error}</p>}
      {tool.unavailable && <p className="degraded">{tool.unavailable}</p>}
      {blocked && <p className="blocked">{blocked}</p>}
      {lastReply?.text && (
        <div className="response">
          <button
            type="button"
            disabled={!active || !isSpeechPlaybackAvailable()}
            onClick={() => lastReply.text && speak(lastReply.text)}
          >
            Replay
          </button>
          {!isSpeechPlaybackAvailable() && (
            <p>Audio playback is unavailable. You can read the reply above.</p>
          )}
        </div>
      )}
    </section>
  );
};
