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

export const speakText = (text: string): void => {
  if (!text.trim() || !isSpeechPlaybackAvailable()) {
    return;
  }
  const utterance = new window.SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  stopSpeaking();
  window.speechSynthesis.speak(utterance);
};
