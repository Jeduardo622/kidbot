export interface ModerationResult {
  blocked: boolean;
  message?: string;
}

export type Mode = 'fallback' | 'dist';
