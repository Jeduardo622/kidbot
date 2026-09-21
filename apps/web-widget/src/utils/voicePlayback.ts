import type { Persona } from './toolResult.js';

export interface PersonaVoicePreset {
  /** Display label for the persona chip. */
  label: string;
  /** Emoji avatar for the persona chip. */
  avatar: string;
  /** Short kid-facing description of how this voice sounds. */
  description: string;
  rate: number;
  pitch: number;
}

/**
 * Persona presets for browser speech synthesis. These are the only
 * client-side effect a persona has until Realtime voice lands; the server
 * also uses the persona to shape the reply text.
 */
export const personaVoicePresets: Record<Persona, PersonaVoicePreset> = {
  robot: { label: 'Robot Buddy', avatar: '🤖', description: 'steady and beepy', rate: 1.05, pitch: 0.8 },
  fairy: { label: 'Fairy Friend', avatar: '🧚', description: 'light and sparkly', rate: 1.1, pitch: 1.5 },
  explorer: { label: 'Explorer Pal', avatar: '🧭', description: 'bold and curious', rate: 1.0, pitch: 1.0 },
};

export const isSpeechPlaybackAvailable = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.speechSynthesis !== 'undefined' &&
  typeof window.SpeechSynthesisUtterance !== 'undefined';

export const stopSpeaking = (): void => {
  if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') {
    return;
  }
  window.speechSynthesis.cancel();
};

export interface SpeakOptions {
  persona?: Persona;
  /** Called when playback finishes, is cancelled, or fails. */
  onEnd?: () => void;
}

/**
 * Speak text with the persona's voice preset. Returns true when playback was
 * started, so callers can show a Stop control; `onEnd` always fires once
 * playback is over for any reason.
 */
export const speakText = (text: string, options: SpeakOptions = {}): boolean => {
  if (!text.trim() || !isSpeechPlaybackAvailable()) {
    return false;
  }
  const preset = personaVoicePresets[options.persona ?? 'robot'];
  const utterance = new window.SpeechSynthesisUtterance(text);
  utterance.rate = preset.rate;
  utterance.pitch = preset.pitch;
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    options.onEnd?.();
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  stopSpeaking();
  window.speechSynthesis.speak(utterance);
  return true;
};
