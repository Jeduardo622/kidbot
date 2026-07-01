import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { installDomGlobals } from '../scripts/smoke-production-widget-story-panels.tsx';

test('production widget story panels smoke is wired as a package script', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(
    packageJson.scripts['smoke:production-widget-story-panels'],
    'tsx ./scripts/smoke-production-widget-story-panels.tsx',
  );
});

test('production widget story panels workflow uses protected remote MCP URL secret', async () => {
  const workflow = await readFile('.github/workflows/production-widget-story-panels-smoke.yml', 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /secrets\.KIDBOT_REMOTE_MCP_URL/);
  assert.match(workflow, /pnpm run smoke:production-widget-story-panels/);
});

test('production widget story panels smoke supports getter-only global navigator', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const windowLike = {
    document: {},
    navigator: { userAgent: 'kidbot-smoke' },
    HTMLElement: class HTMLElement {},
    HTMLImageElement: class HTMLImageElement {},
    MutationObserver: class MutationObserver {},
    getComputedStyle: () => ({}),
  };

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    get() {
      return { userAgent: 'node-built-in' };
    },
  });

  try {
    assert.doesNotThrow(() => {
      installDomGlobals(windowLike);
    });
    assert.equal(globalThis.navigator, windowLike.navigator);
  } finally {
    for (const key of ['window', 'document', 'HTMLElement', 'HTMLImageElement', 'MutationObserver', 'getComputedStyle']) {
      delete globalThis[key];
    }
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor);
    } else {
      delete globalThis.navigator;
    }
  }
});
