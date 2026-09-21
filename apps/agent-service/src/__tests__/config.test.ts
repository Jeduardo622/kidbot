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
    expect(config.requestTimeoutMs).toBe(30_000);
    expect(config.storyRequestTimeoutMs).toBe(180_000);
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

  it('rejects explicit stub mode in production', () => {
    expect(() =>
      parseAgentServiceConfig({
        NODE_ENV: 'production',
        AGENT_SERVICE_TOKEN: token,
        KIDBOT_STUB_PROVIDER: '1',
      }),
    ).toThrow(/KIDBOT_STUB_PROVIDER=1 is not allowed in production/i);
  });

  it('parses bounded route-level request deadlines', () => {
    const config = parseAgentServiceConfig({
      NODE_ENV: 'test',
      AGENT_SERVICE_TOKEN: token,
      AGENT_REQUEST_TIMEOUT_MS: '25000',
      AGENT_STORY_REQUEST_TIMEOUT_MS: '150000',
    });
    expect(config.requestTimeoutMs).toBe(25_000);
    expect(config.storyRequestTimeoutMs).toBe(150_000);
    expect(() => parseAgentServiceConfig({
      NODE_ENV: 'test',
      AGENT_SERVICE_TOKEN: token,
      AGENT_STORY_REQUEST_TIMEOUT_MS: '600001',
    })).toThrow(/AGENT_STORY_REQUEST_TIMEOUT_MS must not exceed 600000/i);
    expect(() => parseAgentServiceConfig({
      NODE_ENV: 'test',
      AGENT_SERVICE_TOKEN: token,
      AGENT_REQUEST_TIMEOUT_MS: '40000',
      AGENT_STORY_REQUEST_TIMEOUT_MS: '30000',
    })).toThrow(/AGENT_STORY_REQUEST_TIMEOUT_MS must be at least AGENT_REQUEST_TIMEOUT_MS/i);
  });

  it('allows stub mode only in test or explicit local fallback posture', () => {
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
