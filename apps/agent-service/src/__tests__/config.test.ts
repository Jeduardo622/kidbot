import { describe, expect, it } from 'vitest';
import { parseAgentServiceConfig, parseTrustProxy } from '../config.js';

const token = 'a'.repeat(40);

describe('agent-service provider mode', () => {
  it('reports openai mode when a provider key is present', () => {
    const config = parseAgentServiceConfig({
      NODE_ENV: 'production',
      AGENT_SERVICE_TOKEN: token,
      OPENAI_API_KEY: 'sk-test-key',
    });
    expect(config.providerMode).toBe('openai');
  });

  it('refuses to start in production without a provider key', () => {
    expect(() =>
      parseAgentServiceConfig({ NODE_ENV: 'production', AGENT_SERVICE_TOKEN: token }),
    ).toThrow(/OPENAI_API_KEY is required/);
  });

  it('refuses to start in development without a provider key', () => {
    expect(() =>
      parseAgentServiceConfig({ NODE_ENV: 'development', AGENT_SERVICE_TOKEN: token }),
    ).toThrow(/OPENAI_API_KEY is required/);
  });

  it('allows stub mode only with an explicit opt-in', () => {
    expect(
      parseAgentServiceConfig({
        NODE_ENV: 'production',
        AGENT_SERVICE_TOKEN: token,
        KIDBOT_STUB_PROVIDER: '1',
      }).providerMode,
    ).toBe('stub');
    expect(
      parseAgentServiceConfig({ NODE_ENV: 'test', AGENT_SERVICE_TOKEN: token }).providerMode,
    ).toBe('stub');
    expect(
      parseAgentServiceConfig({ FALLBACK_WIDGET: '1', KIDBOT_LOCAL_DEV: '1' }).providerMode,
    ).toBe('stub');
  });
});

describe('trust proxy', () => {
  it('defaults on in production and off elsewhere', () => {
    expect(parseTrustProxy(undefined, 'production')).toBe(true);
    expect(parseTrustProxy(undefined, 'development')).toBe(false);
    expect(parseTrustProxy(undefined, undefined)).toBe(false);
  });

  it('honors an explicit override and rejects garbage', () => {
    expect(parseTrustProxy('0', 'production')).toBe(false);
    expect(parseTrustProxy('1', 'test')).toBe(true);
    expect(() => parseTrustProxy('yes', 'test')).toThrow(/KIDBOT_TRUST_PROXY/);
  });
});
