interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: {
    readonly transcript: string;
  };
}

interface SpeechRecognitionEventLike {
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  readonly error?: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export interface VoiceCaptureOptions {
  onEnd?: () => void;
  onError?: (message: string) => void;
  onStart?: () => void;
  onText?: (text: string) => void;
}

export interface VoiceCaptureSession {
  start: () => void;
  stop: () => void;
}

const getSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
};

export const isVoiceCaptureAvailable = (): boolean =>
  typeof getSpeechRecognitionConstructor() !== 'undefined';

export const createVoiceCapture = (
  options: VoiceCaptureOptions,
): VoiceCaptureSession | undefined => {
  const SpeechRecognition = getSpeechRecognitionConstructor();
  if (!SpeechRecognition) {
    return undefined;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  recognition.onstart = () => options.onStart?.();
  recognition.onend = () => options.onEnd?.();
  recognition.onerror = (event) => {
    options.onError?.(event.error ?? 'Voice input stopped.');
  };
  recognition.onresult = (event) => {
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript?.trim();
      if (result?.isFinal && transcript) {
        options.onText?.(transcript);
      }
    }
  };

  return {
    start: () => recognition.start(),
    stop: () => recognition.stop(),
  };
};
