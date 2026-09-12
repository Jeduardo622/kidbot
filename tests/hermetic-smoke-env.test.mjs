import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { createHermeticServiceContext } from '../scripts/hermetic-service-env.mjs';

test('synthetic service context excludes inherited credentials and disables dotenv discovery', async () => {
  const context = await createHermeticServiceContext({
    processEnv: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      OPENAI_API_KEY: 'real-key-must-not-leak',
      AGENT_SERVICE_TOKEN: 'real-token-must-not-leak',
      KIDBOT_SUPABASE_SERVICE_ROLE_KEY: 'real-role-key-must-not-leak',
    },
    overrides: {
      NODE_ENV: 'test',
      KIDBOT_STUB_PROVIDER: '1',
    },
  });
  try {
    assert.equal(context.env.OPENAI_API_KEY, undefined);
    assert.equal(context.env.AGENT_SERVICE_TOKEN, undefined);
    assert.equal(context.env.KIDBOT_SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.equal(context.env.NODE_ENV, 'test');
    assert.equal(context.env.KIDBOT_STUB_PROVIDER, '1');
    assert.equal(context.env.DOTENV_CONFIG_QUIET, 'true');
    assert.match(context.env.DOTENV_CONFIG_PATH, /kidbot-no-env$/i);
    await assert.rejects(access(context.env.DOTENV_CONFIG_PATH));
  } finally {
    const cwd = context.cwd;
    await context.cleanup();
    await assert.rejects(access(cwd));
  }
});

test('test-posture smokes explicitly start the agent service export', async () => {
  const launcher = await readFile(new URL('../scripts/start-service-export.mjs', import.meta.url), 'utf8');
  assert.match(launcher, /serviceModule\.start\(\)/);

  for (const file of ['smoke-secured-posture.mjs', 'smoke-parent-store.mjs']) {
    const smoke = await readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8');
    assert.match(smoke, /start-service-export\.mjs/);
  }
});
