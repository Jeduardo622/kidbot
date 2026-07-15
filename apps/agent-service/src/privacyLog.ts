import { createHmac } from 'node:crypto';

export const createLogSubject = (
  secret: string | undefined,
  kind: 'session' | 'profile',
  value: string | undefined,
) =>
  secret && value
    ? createHmac('sha256', secret).update(`${kind}:${value}`).digest('base64url').slice(0, 24)
    : undefined;
