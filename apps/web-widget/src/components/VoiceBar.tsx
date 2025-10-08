import { useEffect, useState } from 'react';

type Persona = 'robot' | 'fairy' | 'explorer';
type AgeBand = '4-6' | '7-9' | '10-12';

interface VoiceResult {
  blocked: boolean;
  message?: string;
  persona?: Persona;
  text?: string;
  ssml?: string;
}

const personas: Array<{ key: Persona; label: string }> = [
  { key: 'robot', label: 'Robot Buddy' },
  { key: 'fairy', label: 'Fairy Friend' },
  { key: 'explorer', label: 'Explorer Pal' }
];

const ageBands: Array<{ key: AgeBand; label: string }> = [
  { key: '4-6', label: 'Ages 4-6' },
  { key: '7-9', label: 'Ages 7-9' },
  { key: '10-12', label: 'Ages 10-12' }
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
    try {
      const result = (await window.openai?.callTool?.('voice_chat', { text, persona, ageBand })) as VoiceResult | undefined;
      if (!result) {
        throw new Error('Widget bridge unavailable.');
      }
      setResponse(result);
      if (!result.blocked && result.text) {
        speakText(result.text);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel voice-bar">
      <h2>Voice Playground</h2>
      <div className="control-row">
        <label htmlFor="persona">Persona</label>
        <select id="persona" value={persona} onChange={(event) => setPersona(event.target.value as Persona)}>
          {personas.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
        <label htmlFor="ageBand">Age</label>
        <select id="ageBand" value={ageBand} onChange={(event) => setAgeBand(event.target.value as AgeBand)}>
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
      {response && (
        <div className="response">
          {response.blocked ? (
            <p className="blocked">{response.message ?? 'KidBot paused this request.'}</p>
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
