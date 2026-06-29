import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyImageUrl,
  mergeProviderSmokeEnv,
  runProviderPreflightCiCheck,
  validateProviderSmokeEnv,
} from '../scripts/smoke-provider-preflight.mjs';

const longToken = 'service-token-abcdefghijklmnopqrstuvwxyz0123456789';
const serviceRole = 'service-role-abcdefghijklmnopqrstuvwxyz0123456789';
const openAiKey = 'test-openai-key-abcdefghijklmnopqrstuvwxyz0123456789';

test('provider smoke env merges matching root and app secrets without exposing them', () => {
  const env = mergeProviderSmokeEnv({
    processEnv: {},
    rootEnv: {
      OPENAI_API_KEY: openAiKey,
      AGENT_SERVICE_TOKEN: longToken,
      KIDBOT_IMAGE_STORAGE_MODE: 'supabase',
      KIDBOT_SUPABASE_URL: 'https://project-ref.supabase.co',
      KIDBOT_SUPABASE_SERVICE_ROLE_KEY: serviceRole,
      KIDBOT_SUPABASE_IMAGE_BUCKET: 'kidbot-images',
      KIDBOT_SUPABASE_IMAGE_PREFIX: 'story-panels',
    },
    appEnv: {
      OPENAI_API_KEY: openAiKey,
    },
  });

  assert.equal(env.OPENAI_API_KEY, openAiKey);
  assert.equal(
    env.KIDBOT_IMAGE_PUBLIC_BASE_URL,
    'https://project-ref.supabase.co/storage/v1/object/public/kidbot-images',
  );
  assert.equal(env.PROVIDER_TIMEOUT_MS, '120000');
});

test('provider smoke env rejects mismatched OpenAI keys without leaking either value', () => {
  assert.throws(
    () =>
      mergeProviderSmokeEnv({
        processEnv: {},
        rootEnv: {
          OPENAI_API_KEY: 'test-root-openai-key-abcdefghijklmnopqrstuvwxyz',
        },
        appEnv: {
          OPENAI_API_KEY: 'test-app-openai-key-abcdefghijklmnopqrstuvwxyz',
        },
      }),
    (error) =>
      error instanceof Error &&
      /OPENAI_API_KEY mismatch/i.test(error.message) &&
      !error.message.includes('root-secret') &&
      !error.message.includes('app-secret'),
  );
});

test('provider smoke env rejects local public base in Supabase storage mode', () => {
  assert.throws(
    () =>
      validateProviderSmokeEnv({
        OPENAI_API_KEY: openAiKey,
        AGENT_SERVICE_TOKEN: longToken,
        KIDBOT_IMAGE_STORAGE_MODE: 'supabase',
        KIDBOT_IMAGE_PUBLIC_BASE_URL: '/generated-images',
        KIDBOT_SUPABASE_URL: 'https://project-ref.supabase.co',
        KIDBOT_SUPABASE_SERVICE_ROLE_KEY: serviceRole,
        KIDBOT_SUPABASE_IMAGE_BUCKET: 'kidbot-images',
      }),
    /KIDBOT_IMAGE_PUBLIC_BASE_URL must point at Supabase Storage public objects/i,
  );
});

test('image URL classifier distinguishes supported storage URL shapes', () => {
  assert.equal(
    classifyImageUrl('https://project-ref.supabase.co/storage/v1/object/public/kidbot-images/story-panels/image.png'),
    'supabase-public-url',
  );
  assert.equal(classifyImageUrl('/generated-images/image.png'), 'local-url');
  assert.equal(classifyImageUrl('data:image/png;base64,abc'), 'data-url');
  assert.equal(classifyImageUrl('https://assets.example.test/image.png'), 'other-url');
});

test('CI provider preflight validates non-live storage shapes without real secrets', () => {
  const result = runProviderPreflightCiCheck();

  assert.equal(result.ok, true);
  assert.equal(result.live, false);
  assert.deepEqual(
    result.checks.map((check) => ({
      mode: check.mode,
      expectedImageUrlShape: check.expectedImageUrlShape,
      imageUrlShape: check.imageUrlShape,
    })),
    [
      {
        mode: 'local',
        expectedImageUrlShape: 'local-url',
        imageUrlShape: 'local-url',
      },
      {
        mode: 'data-url',
        expectedImageUrlShape: 'data-url',
        imageUrlShape: 'data-url',
      },
      {
        mode: 'supabase',
        expectedImageUrlShape: 'supabase-public-url',
        imageUrlShape: 'supabase-public-url',
      },
    ],
  );
  assert.equal(JSON.stringify(result).includes(openAiKey), false);
  assert.equal(JSON.stringify(result).includes(serviceRole), false);
});
