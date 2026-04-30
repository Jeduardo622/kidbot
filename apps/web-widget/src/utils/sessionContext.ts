export type AgeBand = '4-6' | '7-9' | '10-12';

export interface SessionContext {
  ageBand: AgeBand;
  profileId: string;
  sessionId: string;
}

export const defaultSessionContext: SessionContext = {
  ageBand: '7-9',
  profileId: 'local-default',
  sessionId: 'kb_session_localdefault',
};

export const ageBandOptions: Array<{ key: AgeBand; label: string }> = [
  { key: '4-6', label: 'Ages 4-6' },
  { key: '7-9', label: 'Ages 7-9' },
  { key: '10-12', label: 'Ages 10-12' },
];

export const isAgeBand = (value: unknown): value is AgeBand =>
  value === '4-6' || value === '7-9' || value === '10-12';

export const createSessionId = () => {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && 'randomUUID' in cryptoApi) {
    return `kb_session_${cryptoApi.randomUUID().replace(/-/g, '')}`;
  }
  return `kb_session_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
};
