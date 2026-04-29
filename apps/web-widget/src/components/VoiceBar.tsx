import { useEffect, useState } from 'react';
import { LiveRegion } from './LiveRegion.js';
import { buildAnnouncementState } from '../utils/announcementState.js';
import {
  degradedMessage,
  errorMessage,
  unavailableMessageFromError,
} from '../utils/degradation.js';

type Persona = 'robot' | 'fairy' | 'explorer';
type AgeBand = '4-6' | '7-9' | '10-12';

interface VoiceResult {
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

const ageBands: Array<{ key: AgeBand; label: string }> = [
  { key: '4-6', label: 'Ages 4-6' },
  { key: '7-9', label: 'Ages 7-9' },
  { key: '10-12', label: 'Ages 10-12' },
];

const speakText = (text: string) => {
  if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
};

export const VoiceBar = () => {
  const [persona, setPersona] = useState<Persona>('robot');
  const [ageBand, setAgeBand] = useState<AgeBand>('7-9');
  const [text, setText] = useState('Tell me a cheerful space fact!');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<VoiceResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [unavailable, setUnavailable] = useState<string | undefined>();
  const blockedMessage = response?.blocked
    ? (response.message ?? 'Kidbot paused this request.')
    : undefined;
  const announcement = buildAnnouncementState({
    loading,
    loadingMessage: 'Kidbot is thinking.',
    errorMessage: error,
    urgentMessage: unavailable ?? blockedMessage,
    readyMessage: response?.text ? `${response.persona ?? 'Kidbot'} reply ready.` : '',
  });

  useEffect(() => {
    window.openai?.setWidgetState?.({ tab: 'voice', persona, ageBand, text });
  }, [persona, ageBand, text]);

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
      const result = (await window.openai?.callTool?.('voice_chat', { text, persona, ageBand })) as
        | VoiceResult
        | undefined;
      if (!result) {
        throw new Error('Widget bridge unavailable.');
      }
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
        <label htmlFor="ageBand">Age</label>
        <select
          id="ageBand"
          value={ageBand}
          onChange={(event) => setAgeBand(event.target.value as AgeBand)}
        >
          {ageBands.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Ask a question or share a topic"
        rows={3}
      />
      <button type="button" onClick={handleSpeak} disabled={loading}>
        {loading ? 'Thinking...' : 'Speak'}
      </button>
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
